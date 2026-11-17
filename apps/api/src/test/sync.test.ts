import type {
	CreatePosOrder,
	SyncMutation,
	SyncMutationResult,
} from "@bite/contracts";
import { bps, localClock, minor, priceLines } from "@bite/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	bearer,
	type Harness,
	json,
	ownerUrl,
	setupHarness,
	type Tenant,
	uuidv7,
} from "./harness.js";

const DAY = "2026-11-17";
const PLACED = "2026-11-17T10:00:00Z";
let ticket = 0;

/** Build an order exactly like the tablet would: snapshot + core pricing. */
function posOrder(
	t: Tenant,
	qty = 2,
	opts: { prefix?: string; promotionId?: string; listPrice?: number } = {},
): CreatePosOrder {
	const listUnitPrice = opts.listPrice ?? 1500;
	const r = priceLines(
		[
			{
				productId: t.prod,
				categoryId: t.cat,
				name: { en: "Latte" },
				quantity: qty,
				listUnitPrice: minor(listUnitPrice),
				taxBps: bps(500),
				modifiers: [],
			},
		],
		{
			settings: { pricesIncludeTax: true, taxBps: bps(500) },
			promotions: [],
			at: localClock(Date.parse(PLACED), "Asia/Muscat"),
		},
	);
	if (!r.ok) throw new Error("test pricing failed");
	const o = r.value;
	return {
		id: uuidv7(),
		ticketNumber: `${opts.prefix ?? "A"}-${++ticket}`,
		businessDate: DAY,
		source: "counter",
		type: "takeaway",
		placedAt: PLACED,
		pricesIncludeTax: true,
		lines: [
			{
				id: uuidv7(),
				productId: t.prod,
				quantity: qty,
				modifierOptionIds: [],
				name: { en: "Latte" },
				listUnitPrice,
				promotionId: opts.promotionId ?? null,
				modifiers: [],
				taxBps: 500,
			},
		],
		expectedTotals: {
			subtotal: o.subtotal,
			discountTotal: o.discountTotal,
			taxTotal: o.taxTotal,
			total: o.total,
		},
	};
}

describe.runIf(ownerUrl)("sync push/pull", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
		await h.owner`update locations set tax_bps = 500`;
	});
	afterAll(() => h?.close());

	let mutSeq = 0;
	const mut = (
		t: Tenant,
		kind: SyncMutation["kind"],
		entityId: string,
		payload: unknown,
		extra: Partial<SyncMutation> = {},
	) =>
		({
			id: uuidv7(),
			kind,
			entityId,
			memberId: t.cashier,
			createdAt: new Date(
				Date.UTC(2026, 10, 17, 10, 0, mutSeq++),
			).toISOString(),
			payload,
			...extra,
		}) as SyncMutation;

	async function push(
		t: Tenant,
		mutations: SyncMutation[],
	): Promise<SyncMutationResult[]> {
		const res = await h.app.request(
			"/v1/sync/push",
			json({ deviceId: t.device, mutations }, bearer(t)),
		);
		if (res.status !== 200)
			throw new Error(`push ${res.status}: ${await res.text()}`);
		return ((await res.json()) as { results: SyncMutationResult[] }).results;
	}
	async function pull(t: Tenant, q = "") {
		const res = await h.app.request(`/v1/sync/pull${q}`, {
			headers: bearer(t),
		});
		expect(res.status).toBe(200);
		return (await res.json()) as {
			cursor: string;
			hasMore: boolean;
			menuVersion: string;
			menu?: unknown;
			orders: {
				id: string;
				version: number;
				paymentStatus: string;
				fulfillmentStatus: string;
				total: number;
				paidTotal: number;
			}[];
		};
	}
	const getOrder = async (t: Tenant, id: string) =>
		(await (
			await h.app.request(`/v1/orders/${id}`, { headers: bearer(t) })
		).json()) as {
			version: number;
			total: number;
			taxTotal: number;
			paidTotal: number;
			paymentStatus: string;
			fulfillmentStatus: string;
			lines: { id: string; voidedAt: string | null }[];
		};

	let session: string;
	beforeAll(async () => {
		session = uuidv7();
		const [r] = await push(h.A, [
			mut(h.A, "cash.open", session, {
				id: session,
				businessDate: DAY,
				openingFloat: 20_000,
			}),
		]);
		expect(r?.status).toBe("applied");
	});

	it("creates an order priced exactly like core, and replays as duplicate", async () => {
		const o = posOrder(h.A);
		const m = mut(h.A, "order.create", o.id, o);
		const [r1] = await push(h.A, [m]);
		expect(r1).toMatchObject({
			status: "applied",
			entityId: o.id,
			entityVersion: 1,
		});
		const [r2] = await push(h.A, [m]);
		expect(r2).toMatchObject({ status: "duplicate", entityVersion: 1 });
		const order = await getOrder(h.A, o.id);
		// 2 x 1.500 inclusive of 5% VAT: total 3.000, tax 0.143 (per line, half away from zero)
		expect(order).toMatchObject({
			total: 3000,
			taxTotal: 143,
			paymentStatus: "unpaid",
			version: 1,
		});
	});

	it("rejects an id reused for a different mutation", async () => {
		const o = posOrder(h.A);
		const m = mut(h.A, "order.create", o.id, o);
		await push(h.A, [m]);
		const [r] = await push(h.A, [
			{ ...m, payload: { ...o, note: "changed" } } as SyncMutation,
		]);
		expect(r).toMatchObject({
			status: "rejected",
			error: { code: "idempotency_mismatch" },
		});
	});

	it("rejects tampered totals, records the rejection, and blocks the chain", async () => {
		const bad = posOrder(h.A);
		bad.expectedTotals.total -= 1;
		const good = posOrder(h.A);
		const create = mut(h.A, "order.create", bad.id, bad);
		const pay = mut(h.A, "order.addPayment", bad.id, {
			id: uuidv7(),
			orderId: bad.id,
			amount: 2999,
			method: "card",
			businessDate: DAY,
		});
		const other = mut(h.A, "order.create", good.id, good);
		const [r1, r2, r3] = await push(h.A, [create, pay, other]);
		expect(r1).toMatchObject({
			status: "rejected",
			error: { details: { reason: "totals_mismatch" } },
		});
		expect(r2?.status).toBe("blocked");
		expect(r3?.status).toBe("applied");
		// Rejection is final and replays as-is; blocked was not recorded.
		const [again] = await push(h.A, [create]);
		expect(again?.status).toBe("rejected");
		const rows =
			await h.owner`select 1 from sync_mutations where id = ${pay.id}`;
		expect(rows.length).toBe(0);
	});

	it("rejects a ticket that isn't this device's prefix", async () => {
		const o = posOrder(h.A, 1, { prefix: "Z" });
		const [r] = await push(h.A, [mut(h.A, "order.create", o.id, o)]);
		expect(r).toMatchObject({
			status: "rejected",
			error: { details: { reason: "ticket_prefix" } },
		});
	});

	it("rejects a list price the tablet made up only if totals don't add up", async () => {
		// Snapshotted prices are kept (Nasser 2026-11-17): a stale 1.400 price is fine if consistent.
		const o = posOrder(h.A, 1, { listPrice: 1400 });
		const [r] = await push(h.A, [mut(h.A, "order.create", o.id, o)]);
		expect(r?.status).toBe("applied");
		expect((await getOrder(h.A, o.id)).total).toBe(1400);
	});

	it("takes a split bill (cash + card), refuses overpayment, then completes", async () => {
		const o = posOrder(h.A);
		const [c] = await push(h.A, [mut(h.A, "order.create", o.id, o)]);
		expect(c?.status).toBe("applied");
		const cash = mut(h.A, "order.addPayment", o.id, {
			id: uuidv7(),
			orderId: o.id,
			amount: 1000,
			tendered: 5000,
			method: "cash",
			cashSessionId: session,
			businessDate: DAY,
		});
		const over = mut(h.A, "order.addPayment", o.id, {
			id: uuidv7(),
			orderId: o.id,
			amount: 2500,
			method: "card",
			businessDate: DAY,
		});
		const [r1, r2] = await push(h.A, [cash, over]);
		expect(r1?.status).toBe("applied");
		expect(r2).toMatchObject({
			status: "rejected",
			error: { details: { reason: "overpayment" } },
		});
		expect(await getOrder(h.A, o.id)).toMatchObject({
			paidTotal: 1000,
			paymentStatus: "partially_paid",
		});

		const card = mut(h.A, "order.addPayment", o.id, {
			id: uuidv7(),
			orderId: o.id,
			amount: 2000,
			method: "card",
			businessDate: DAY,
		});
		const done = mut(h.A, "order.setFulfillment", o.id, {
			orderId: o.id,
			to: "completed",
		});
		const [r3, r4] = await push(h.A, [card, done]);
		expect(r3?.status).toBe("applied");
		expect(r4?.status).toBe("applied");
		expect(await getOrder(h.A, o.id)).toMatchObject({
			paidTotal: 3000,
			paymentStatus: "paid",
			fulfillmentStatus: "completed",
		});
	});

	it("needs an open cash session on this device for cash", async () => {
		const o = posOrder(h.A, 1);
		await push(h.A, [mut(h.A, "order.create", o.id, o)]);
		const [r] = await push(h.A, [
			mut(h.A, "order.addPayment", o.id, {
				id: uuidv7(),
				orderId: o.id,
				amount: 1500,
				method: "cash",
				cashSessionId: uuidv7(),
				businessDate: DAY,
			}),
		]);
		expect(r).toMatchObject({
			status: "rejected",
			error: { details: { reason: "cash_session_not_open" } },
		});
	});

	it("lets only a manager refund, and derives partially_refunded", async () => {
		const o = posOrder(h.A, 1);
		const payId = uuidv7();
		await push(h.A, [
			mut(h.A, "order.create", o.id, o),
			mut(h.A, "order.addPayment", o.id, {
				id: payId,
				orderId: o.id,
				amount: 1500,
				method: "card",
				businessDate: DAY,
			}),
		]);
		const refund = {
			id: uuidv7(),
			reversesPaymentId: payId,
			amount: 500,
			reason: "cold",
			businessDate: DAY,
		};
		const [byCashier] = await push(h.A, [
			mut(h.A, "order.refund", o.id, refund),
		]);
		expect(byCashier).toMatchObject({
			status: "rejected",
			error: { code: "forbidden" },
		});
		const [byManager] = await push(h.A, [
			mut(
				h.A,
				"order.refund",
				o.id,
				{ ...refund, id: uuidv7() },
				{ memberId: h.A.manager },
			),
		]);
		expect(byManager?.status).toBe("applied");
		expect(await getOrder(h.A, o.id)).toMatchObject({
			paidTotal: 1000,
			paymentStatus: "partially_refunded",
		});
		const [tooMuch] = await push(h.A, [
			mut(
				h.A,
				"order.refund",
				o.id,
				{ ...refund, id: uuidv7(), amount: 1001 },
				{ memberId: h.A.manager },
			),
		]);
		expect(tooMuch).toMatchObject({
			status: "rejected",
			error: { details: { reason: "refund_too_large" } },
		});
	});

	it("answers a stale baseVersion with conflict, unrecorded and retryable", async () => {
		const o = posOrder(h.A, 1);
		await push(h.A, [
			mut(h.A, "order.create", o.id, o),
			mut(h.A, "order.addPayment", o.id, {
				id: uuidv7(),
				orderId: o.id,
				amount: 1500,
				method: "card",
				businessDate: DAY,
			}),
		]);
		const bump = mut(
			h.A,
			"order.setFulfillment",
			o.id,
			{ orderId: o.id, to: "preparing" },
			{ baseVersion: 1 },
		);
		const [r] = await push(h.A, [bump]);
		expect(r).toMatchObject({ status: "conflict", entityVersion: 2 });
		const [retry] = await push(h.A, [
			{ ...bump, baseVersion: 2 } as SyncMutation,
		]);
		expect(retry).toMatchObject({ status: "applied", entityVersion: 3 });
	});

	it("enforces the fulfillment rules from core", async () => {
		const o = posOrder(h.A, 1);
		const [, r] = await push(h.A, [
			mut(h.A, "order.create", o.id, o),
			mut(h.A, "order.setFulfillment", o.id, {
				orderId: o.id,
				to: "completed",
			}),
		]);
		expect(r).toMatchObject({
			status: "rejected",
			error: { details: { reason: "unpaid" } },
		});
	});

	it("voids a line and re-sums the totals", async () => {
		const o = posOrder(h.A, 1);
		const [first] = o.lines;
		if (!first) throw new Error("no line");
		const second = { ...structuredClone(first), id: uuidv7() };
		o.lines.push(second);
		const single = posOrder(h.A, 1).expectedTotals;
		o.expectedTotals = {
			subtotal: single.subtotal * 2,
			discountTotal: 0,
			taxTotal: single.taxTotal * 2,
			total: single.total * 2,
		};
		const [c, v] = await push(h.A, [
			mut(h.A, "order.create", o.id, o),
			mut(h.A, "order.voidLine", o.id, {
				orderId: o.id,
				lineId: second.id,
				reason: "mistake",
			}),
		]);
		expect(c?.status).toBe("applied");
		expect(v?.status).toBe("applied");
		expect(await getOrder(h.A, o.id)).toMatchObject({
			total: single.total,
			taxTotal: single.taxTotal,
			version: 2,
		});
	});

	it("closes the drawer with the expected cash", async () => {
		const s = uuidv7();
		// The A device already has an open session; close it first then open s.
		const movement = mut(h.A, "cash.movement", session, {
			id: uuidv7(),
			cashSessionId: session,
			kind: "pay_out",
			amount: 300,
			reason: "milk",
		});
		const close = mut(h.A, "cash.close", session, {
			cashSessionId: session,
			countedCash: 20_700,
		});
		const [m, c] = await push(h.A, [movement, close]);
		expect(m?.status).toBe("applied");
		expect(c?.status).toBe("applied");
		const [row] =
			await h.owner`select expected_cash, counted_cash, status from cash_sessions where id = ${session}`;
		// float 20.000 + cash payment 1.000 - pay out 0.300
		expect(row).toMatchObject({
			expected_cash: "20700",
			counted_cash: "20700",
			status: "closed",
		});
		const [reopen] = await push(h.A, [
			mut(h.A, "cash.open", s, { id: s, businessDate: DAY, openingFloat: 0 }),
		]);
		expect(reopen?.status).toBe("applied");
	});

	it("rejects mutations by staff of another location", async () => {
		const o = posOrder(h.A, 1);
		const [r] = await push(h.A, [
			mut(h.A, "order.create", o.id, o, { memberId: h.A.otherLocStaff }),
		]);
		expect(r).toMatchObject({
			status: "rejected",
			error: { code: "forbidden" },
		});
	});

	it("pulls changes with a gap-free cursor and skips an unchanged menu", async () => {
		const first = await pull(h.A);
		expect(first.orders.length).toBeGreaterThan(0);
		expect(first.menu).toBeDefined();
		const quiet = await pull(
			h.A,
			`?cursor=${first.cursor}&menuVersion=${first.menuVersion}`,
		);
		expect(quiet.menu).toBeUndefined();
		expect(quiet.orders).toEqual([]);

		const o = posOrder(h.A, 1);
		await push(h.A, [mut(h.A, "order.create", o.id, o)]);
		const after = await pull(
			h.A,
			`?cursor=${quiet.cursor}&menuVersion=${first.menuVersion}`,
		);
		expect(after.orders.map((x) => x.id)).toEqual([o.id]);
	});

	it("rejects a push whose deviceId doesn't match the token", async () => {
		const res = await h.app.request(
			"/v1/sync/push",
			json(
				{
					deviceId: h.B.device,
					mutations: [mut(h.A, "cash.open", uuidv7(), {})],
				},
				bearer(h.A),
			),
		);
		expect(res.status).toBe(400);
	});
});
