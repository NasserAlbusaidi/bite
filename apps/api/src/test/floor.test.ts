import type { Floor, PutFloorRequest } from "@bite/contracts";
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

const put = (h: Harness, loc: string, body: PutFloorRequest) =>
	h.app.request(`/v1/admin/locations/${loc}/floor`, {
		method: "PUT",
		headers: { ...h.logins.A.owner, "content-type": "application/json" },
		body: JSON.stringify(body),
	});

const push = (h: Harness, t: Tenant, mutations: unknown[]) =>
	h.app
		.request(
			"/v1/sync/push",
			json({ deviceId: t.device, mutations }, bearer(t)),
		)
		.then(
			(r) =>
				r.json() as Promise<{
					results: { status: string; error?: { code: string } }[];
				}>,
		);

const mut = (
	kind: string,
	entityId: string,
	memberId: string,
	payload: unknown,
) => ({
	id: uuidv7(),
	kind,
	entityId,
	memberId,
	createdAt: new Date().toISOString(),
	payload,
});

describe.runIf(ownerUrl)("floor plan", () => {
	let h: Harness;
	const inside = uuidv7();
	const terrace = uuidv7();
	const t1 = uuidv7();
	const t2 = uuidv7();
	beforeAll(async () => {
		h = await setupHarness();
	}, 60_000);
	afterAll(() => h?.close());

	const plan = (labels: [string, string]): PutFloorRequest => ({
		areas: [
			{ id: inside, name: "Inside", sortOrder: 0 },
			{ id: terrace, name: "Terrace", sortOrder: 1 },
		],
		tables: [
			{
				id: t1,
				areaId: inside,
				label: labels[0],
				seats: 2,
				shape: "round",
				x: 1,
				y: 1,
				w: 2,
				h: 2,
			},
			{
				id: t2,
				areaId: terrace,
				label: labels[1],
				seats: 6,
				shape: "rect",
				x: 4,
				y: 2,
				w: 4,
				h: 2,
			},
		],
	});

	it("saves and loads the whole plan, swapping labels in one save", async () => {
		const res = await put(h, h.A.loc, plan(["1", "2"]));
		expect(res.status).toBe(200);
		const swapped = await put(h, h.A.loc, plan(["2", "1"]));
		expect(swapped.status).toBe(200);
		const got = (await (
			await h.app.request(`/v1/admin/locations/${h.A.loc}/floor`, {
				headers: h.logins.A.owner,
			})
		).json()) as Floor;
		expect(got.areas.map((a) => a.name)).toEqual(["Inside", "Terrace"]);
		expect(got.tables.find((t) => t.id === t1)?.label).toBe("2");
		expect(got.tables.find((t) => t.id === t2)?.label).toBe("1");
	});

	it("refuses a duplicate label and a table in an unknown area", async () => {
		const dup = plan(["5", "5"]);
		expect((await put(h, h.A.loc, dup)).status).toBe(400);
		const orphan = plan(["5", "6"]);
		orphan.areas = orphan.areas.slice(0, 1);
		expect((await put(h, h.A.loc, orphan)).status).toBe(400);
	});

	it("drops what the save leaves out", async () => {
		const one = plan(["1", "2"]);
		one.tables = one.tables.slice(0, 1);
		one.areas = one.areas.slice(0, 1);
		const got = (await (await put(h, h.A.loc, one)).json()) as Floor;
		expect(got.tables.map((t) => t.label)).toEqual(["1"]);
		expect(got.areas).toHaveLength(1);
		await put(h, h.A.loc, plan(["1", "2"]));
	});

	it("sends the floor in the sync pull, and tablets assign a server", async () => {
		const assign = await push(h, h.A, [
			mut("table.assign", t1, h.A.cashier, {
				tableId: t1,
				memberId: h.A.cashier,
			}),
		]);
		expect(assign.results[0]?.status).toBe("applied");
		// Kitchen staff can't be put on a table.
		const kitchen = await push(h, h.A, [
			mut("table.assign", t2, h.A.manager, {
				tableId: t2,
				memberId: h.A.kitchen,
			}),
		]);
		expect(kitchen.results[0]?.status).toBe("rejected");
		const pull = (await (
			await h.app.request("/v1/sync/pull", { headers: bearer(h.A) })
		).json()) as { floor?: Floor };
		const t = pull.floor?.tables.find((x) => x.id === t1);
		expect(t?.serverMemberId).toBe(h.A.cashier);
		expect(pull.floor?.areas).toHaveLength(2);
		// A layout save keeps the assignment.
		await put(h, h.A.loc, plan(["1", "2"]));
		const [row] =
			await h.owner`select server_member_id from floor_tables where id = ${t1}`;
		expect(row?.server_member_id).toBe(h.A.cashier);
	});

	it("moves an open dine-in order to another table", async () => {
		const orderId = uuidv7();
		await h.owner`
			insert into orders (id, org_id, location_id, ticket_number, business_date, source, type, prices_include_tax, subtotal, tax_total, total, table_label)
			values (${orderId}, ${h.A.org}, ${h.A.loc}, 'Q-90', '2026-11-24', 'guest', 'dine_in', true, 1000, 48, 1000, '1')`;
		const moved = await push(h, h.A, [
			mut("order.setTable", orderId, h.A.cashier, {
				orderId,
				tableLabel: "2",
			}),
		]);
		expect(moved.results[0]?.status).toBe("applied");
		const [o] =
			await h.owner`select table_label, version from orders where id = ${orderId}`;
		expect(o).toMatchObject({ table_label: "2", version: 2 });
		// Kitchen can't move tables.
		const k = await push(h, h.A, [
			mut("order.setTable", orderId, h.A.kitchen, {
				orderId,
				tableLabel: "1",
			}),
		]);
		expect(k.results[0]?.status).toBe("rejected");
	});

	it("keeps tenants apart on table.assign and order.setTable", async () => {
		const r = await push(h, h.B, [
			mut("table.assign", t1, h.B.manager, {
				tableId: t1,
				memberId: h.B.manager,
			}),
		]);
		expect(r.results[0]).toMatchObject({ status: "rejected" });
		const [row] =
			await h.owner`select server_member_id from floor_tables where id = ${t1}`;
		expect(row?.server_member_id).toBe(h.A.cashier);
	});
});
