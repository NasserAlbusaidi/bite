import { beforeEach, describe, expect, it } from "vitest";
import type { SqlDriver } from "../db/driver.js";
import { migrate } from "../db/migrations.js";
import { openSqlJs } from "../db/sqljs-driver.js";
import type {
	MutationResult,
	PushRequest,
	PushResponse,
} from "./contracts-stub.js";
import { enqueue, listOutbox } from "./outbox.js";
import { Replayer } from "./replayer.js";
import type { SyncTransport } from "./transport.js";

const MEMBER = "0190f000-0000-7000-8000-000000000001";

/** Fake server: dedupes by id, rejects anything in `reject`, blocks the rest of that entity. */
function fakeServer(opts: { reject?: Set<string>; down?: () => boolean } = {}) {
	const seen = new Map<string, MutationResult>();
	const calls: PushRequest[] = [];
	const transport: SyncTransport = {
		async push(req): Promise<PushResponse> {
			calls.push(structuredClone(req));
			if (opts.down?.()) throw new TypeError("Failed to fetch");
			const failed = new Set<string>();
			const results = req.mutations.map((m): MutationResult => {
				const prior = seen.get(m.id);
				if (prior) return { ...prior, status: "duplicate" };
				if (failed.has(m.entityId))
					return { id: m.id, entityId: m.entityId, status: "blocked" };
				if (opts.reject?.has(m.id)) {
					failed.add(m.entityId);
					return {
						id: m.id,
						entityId: m.entityId,
						status: "rejected",
						error: { code: "unprocessable", message: "nope" },
					};
				}
				const r: MutationResult = {
					id: m.id,
					entityId: m.entityId,
					status: "applied",
					entityVersion: 1,
				};
				seen.set(m.id, r);
				return r;
			});
			return { results };
		},
	};
	return { transport, calls, seen };
}

let db: SqlDriver;
let now = 1_000_000;

beforeEach(async () => {
	db = await openSqlJs();
	await migrate(db);
	now = 1_000_000;
});

async function q(
	kind: "order.create" | "order.addPayment" | "order.setFulfillment",
	entityId: string,
	id?: string,
) {
	return db.transaction((tx) =>
		enqueue(tx, {
			kind,
			entityId,
			memberId: MEMBER,
			payload: { n: 1 },
			...(id && { id }),
		}),
	);
}

describe("outbox", () => {
	it("generates UUIDv7 ids in creation order", async () => {
		const a = await q("order.create", "o1");
		const b = await q("order.create", "o2");
		expect(a.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(a.id < b.id).toBe(true);
	});

	it("rolls the outbox row back with the local write", async () => {
		await expect(
			db.transaction(async (tx) => {
				await enqueue(tx, {
					kind: "order.create",
					entityId: "o1",
					memberId: MEMBER,
					payload: {},
				});
				throw new Error("local insert failed");
			}),
		).rejects.toThrow("local insert failed");
		expect(await listOutbox(db)).toHaveLength(0);
	});
});

describe("replayer", () => {
	it("pushes in FIFO order and marks everything applied", async () => {
		const s = fakeServer();
		await q("order.create", "o1");
		await q("order.addPayment", "o1");
		await q("order.create", "o2");
		const r = new Replayer({
			db,
			transport: s.transport,
			deviceId: "d1",
			now: () => now,
		});
		const sum = await r.flush();
		expect(sum).toMatchObject({
			applied: 3,
			rejected: 0,
			blocked: 0,
			remaining: 0,
			error: null,
		});
		expect(s.calls[0]?.mutations.map((m) => [m.kind, m.entityId])).toEqual([
			["order.create", "o1"],
			["order.addPayment", "o1"],
			["order.create", "o2"],
		]);
		expect(s.calls[0]?.mutations[0]?.memberId).toBe(MEMBER);
	});

	it("is idempotent when the response is lost: replay gets duplicate, still applied once", async () => {
		const s = fakeServer();
		let loseResponse = true;
		const lossy: SyncTransport = {
			async push(req) {
				const res = await s.transport.push(req);
				if (loseResponse) {
					loseResponse = false;
					throw new TypeError("connection reset");
				}
				return res;
			},
		};
		await q("order.create", "o1");
		const r = new Replayer({
			db,
			transport: lossy,
			deviceId: "d1",
			now: () => now,
			backoffMs: () => 1000,
		});
		const first = await r.flush();
		expect(first.applied).toBe(0);
		expect(first.remaining).toBe(1);
		now += 1000;
		const second = await r.flush();
		expect(second.applied).toBe(1);
		expect(s.seen.size).toBe(1);
		expect(s.calls[1]?.mutations[0]?.id).toBe(s.calls[0]?.mutations[0]?.id);
	});

	it("keeps everything when offline and backs off exponentially", async () => {
		let down = true;
		const s = fakeServer({ down: () => down });
		await q("order.create", "o1");
		const r = new Replayer({
			db,
			transport: s.transport,
			deviceId: "d1",
			now: () => now,
		});
		const sum = await r.flush();
		expect(sum.error).toBeInstanceOf(TypeError);
		const [row] = await listOutbox(db);
		expect(row).toMatchObject({
			status: "pending",
			attempts: 1,
			nextAttemptAt: now + 2000,
		});

		// Not due yet: no network call at all.
		await r.flush();
		expect(s.calls).toHaveLength(1);

		now += 2000;
		await r.flush();
		const [row2] = await listOutbox(db);
		expect(row2).toMatchObject({ attempts: 2, nextAttemptAt: now + 4000 });

		down = false;
		now += 4000;
		expect((await r.flush()).applied).toBe(1);
	});

	it("parks a rejected mutation and everything after it for the same order, other orders flow", async () => {
		const create = await q("order.create", "o1");
		const s = fakeServer({ reject: new Set([create.id]) });
		await q("order.addPayment", "o1");
		await q("order.create", "o2");
		const r = new Replayer({
			db,
			transport: s.transport,
			deviceId: "d1",
			now: () => now,
		});
		const sum = await r.flush();
		expect(sum).toMatchObject({
			applied: 1,
			rejected: 1,
			blocked: 1,
			remaining: 0,
		});

		const left = await listOutbox(db);
		expect(left.map((i) => [i.entityId, i.kind, i.status])).toEqual([
			["o1", "order.create", "rejected"],
			["o1", "order.addPayment", "blocked"],
		]);
		expect(left[0]?.lastError).toContain("unprocessable");

		// Queued later for the same order: parked locally, never sent.
		await q("order.setFulfillment", "o1");
		const before = s.calls.length;
		const again = await r.flush();
		expect(again.blocked).toBe(1);
		expect(s.calls).toHaveLength(before);
	});

	it("treats a result missing from the response as transient", async () => {
		const partial: SyncTransport = {
			async push(req) {
				const m = req.mutations[0];
				if (!m) return { results: [] };
				return {
					results: [{ id: m.id, entityId: m.entityId, status: "applied" }],
				};
			},
		};
		await q("order.create", "o1");
		await q("order.create", "o2");
		const r = new Replayer({
			db,
			transport: partial,
			deviceId: "d1",
			now: () => now,
		});
		const sum = await r.flush();
		expect(sum.applied).toBe(1);
		expect(sum.remaining).toBe(1);
		expect(sum.error).toBeInstanceOf(Error);
	});

	it("sends in batches and drains a large backlog", async () => {
		const s = fakeServer();
		for (let i = 0; i < 7; i++) await q("order.create", `o${i}`);
		const r = new Replayer({
			db,
			transport: s.transport,
			deviceId: "d1",
			batchSize: 3,
			now: () => now,
		});
		const sum = await r.flush();
		expect(sum.applied).toBe(7);
		expect(s.calls.map((c) => c.mutations.length)).toEqual([3, 3, 1]);
	});

	it("shares one run between concurrent flush calls", async () => {
		const s = fakeServer();
		await q("order.create", "o1");
		const r = new Replayer({
			db,
			transport: s.transport,
			deviceId: "d1",
			now: () => now,
		});
		const [a, b] = await Promise.all([r.flush(), r.flush()]);
		expect(a).toBe(b);
		expect(s.calls).toHaveLength(1);
	});
});
