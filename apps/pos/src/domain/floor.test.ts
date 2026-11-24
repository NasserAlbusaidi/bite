import type { Floor, Order } from "@bite/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import type { SqlDriver } from "../db/driver.js";
import { migrate } from "../db/migrations.js";
import { openSqlJs } from "../db/sqljs-driver.js";
import { listOutbox } from "../sync/outbox.js";
import {
	assignServer,
	atTable,
	HOLD_HOURS,
	loadFloor,
	moveTable,
	needsCheck,
	saveFloor,
	statusOf,
	type TableState,
	tableStates,
} from "./floor.js";
import { kitchenOrders, moveTicket } from "./kitchen.js";
import { upsertOrders } from "./sale.js";

const M = "0190f000-0000-7000-8000-0000000000aa";
const id = (n: number) =>
	`0190f000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const AREA = id(800);

function order(n: number, over: Partial<Order> = {}): Order {
	return {
		id: id(n),
		locationId: id(900),
		deviceId: null,
		ticketNumber: `Q-${n}`,
		businessDate: "2026-11-24",
		source: "guest",
		type: "dine_in",
		tableLabel: "1",
		paymentStatus: "paid",
		fulfillmentStatus: "pending",
		customerName: null,
		note: null,
		pricesIncludeTax: true,
		subtotal: 1000,
		discountTotal: 0,
		taxTotal: 48,
		total: 1000,
		paidTotal: 1000,
		placedAt: `2026-11-24T10:0${n % 10}:00Z`,
		readyAt: null,
		completedAt: null,
		cancelledAt: null,
		cancelReason: null,
		version: 3,
		updatedAt: "2026-11-24T10:00:00Z",
		lines: [],
		payments: [
			{
				id: id(500 + n),
				orderId: id(n),
				amount: 1000,
				tendered: null,
				tip: 0,
				method: "card",
				state: "succeeded",
				reversesPaymentId: null,
				reason: null,
				businessDate: "2026-11-24",
				createdAt: "2026-11-24T10:00:00Z",
			},
		],
		...over,
	};
}
const unpaid: Partial<Order> = {
	paymentStatus: "unpaid",
	paidTotal: 0,
	payments: [],
};

const floor: Floor = {
	areas: [{ id: AREA, name: "Inside", sortOrder: 0 }],
	tables: ["1", "2", "3"].map((label, i) => ({
		id: id(700 + i),
		areaId: AREA,
		label,
		seats: 4,
		shape: "square" as const,
		x: i * 5,
		y: 1,
		w: 4,
		h: 3,
		serverMemberId: null,
		version: 1,
	})),
};

const NOW = Date.parse("2026-11-24T10:30:00Z");
let db: SqlDriver;
beforeEach(async () => {
	db = await openSqlJs();
	await migrate(db);
	await saveFloor(db, floor);
});

describe("floor", () => {
	it("colours tables by their most urgent order", async () => {
		await upsertOrders(db, [
			order(1, { tableLabel: "1", fulfillmentStatus: "preparing" }),
			order(2, { tableLabel: "1", fulfillmentStatus: "ready" }),
			order(3, { tableLabel: "2", ...unpaid }),
			// Paid and served: guests are still sitting there.
			order(4, { tableLabel: "3", fulfillmentStatus: "completed" }),
			order(5, { tableLabel: "99" }),
		]);
		const s = await tableStates(db, floor, NOW);
		expect(s.tables.map((x) => x.status)).toEqual(["ready", "to_pay", "paid"]);
		expect(s.tables[1]?.due).toBe(1000);
		expect(s.unplaced).toHaveLength(1);
	});

	it("a staff tab cooking unpaid is cooking, not to pay", () => {
		const tab = order(1, {
			source: "counter",
			fulfillmentStatus: "preparing",
			...unpaid,
		});
		const row = (o: Order) => ({ order: o, due: 1000 as never, served: false });
		expect(statusOf([row(tab)])).toBe("cooking");
		expect(statusOf([row({ ...tab, fulfillmentStatus: "pending" })])).toBe(
			"ordered",
		);
		expect(statusOf([])).toBe("free");
	});

	it("moves a table's orders and queues one order.setTable each", async () => {
		await upsertOrders(db, [order(1), order(2)]);
		const r = await moveTable(db, {
			orderIds: [id(1), id(2)],
			to: "3",
			memberId: M,
		});
		expect(r).toEqual({ ok: true, moved: 2 });
		const s = await tableStates(db, floor, NOW);
		expect(s.tables.find((x) => x.table.label === "3")?.orders).toHaveLength(2);
		const out = await listOutbox(db);
		expect(out.map((m) => m.kind)).toEqual([
			"order.setTable",
			"order.setTable",
		]);
	});

	it("shows a server assignment before it syncs", async () => {
		await assignServer(db, { tableId: id(700), serverId: M, memberId: M });
		const f = await loadFloor(db);
		expect(f?.tables[0]?.serverMemberId).toBe(M);
	});

	it("kitchen cooks tabs unpaid but not guest orders", async () => {
		await upsertOrders(db, [
			order(1, { source: "counter", ...unpaid }),
			order(2, { ...unpaid }),
		]);
		expect((await kitchenOrders(db)).map((o) => o.id)).toEqual([id(1)]);
		expect(
			await moveTicket(db, { orderId: id(1), to: "preparing", memberId: M }),
		).toEqual({ ok: true });
		expect(
			await moveTicket(db, { orderId: id(2), to: "preparing", memberId: M }),
		).toEqual({ ok: false, error: "unpaid" });
		// Ready tabs leave the kitchen screen; the floor shows them.
		await moveTicket(db, { orderId: id(1), to: "ready", memberId: M });
		expect(await kitchenOrders(db)).toHaveLength(0);
	});
	it("holds the table from served to paid until staff clear it", async () => {
		await upsertOrders(db, [
			order(1, {
				source: "counter",
				fulfillmentStatus: "ready",
				...unpaid,
			}),
		]);
		const at = async (when = NOW) =>
			(await tableStates(db, floor, when)).tables[0];
		expect((await at())?.status).toBe("ready");
		// Served unpaid: eating, the bill stays open, the pass lets go.
		expect(
			await atTable(db, {
				orderIds: [id(1)],
				step: "served",
				memberId: M,
				at: NOW,
			}),
		).toEqual({ ok: true });
		const eating = await at();
		expect(eating?.status).toBe("eating");
		expect(eating?.due).toBe(1000);
		expect(await kitchenOrders(db)).toHaveLength(0);
		// A while later: worth checking on them.
		expect(needsCheck(eating as TableState, NOW + 5 * 60_000)).toBe(false);
		expect(needsCheck(eating as TableState, NOW + 25 * 60_000)).toBe(true);
		// Can't clear an unpaid table; nothing changes.
		expect(
			await atTable(db, { orderIds: [id(1)], step: "cleared", memberId: M }),
		).toEqual({ ok: false, error: "unpaid" });
		expect((await at())?.status).toBe("eating");
	});

	it("a paid table stays until cleared, then frees", async () => {
		await upsertOrders(db, [order(1, { fulfillmentStatus: "ready" })]);
		await atTable(db, { orderIds: [id(1)], step: "served", memberId: M });
		const s = (await tableStates(db, floor, NOW)).tables[0];
		expect(s?.status).toBe("paid");
		expect(s?.orders[0]?.order.fulfillmentStatus).toBe("completed");
		expect(
			await atTable(db, { orderIds: [id(1)], step: "cleared", memberId: M }),
		).toEqual({ ok: true });
		expect((await tableStates(db, floor, NOW)).tables[0]?.status).toBe("free");
		expect((await listOutbox(db)).map((m) => m.payload)).toEqual([
			{ orderId: id(1), step: "served" },
			{ orderId: id(1), step: "cleared" },
		]);
	});

	it("an old served table nobody cleared lets go on its own", async () => {
		await upsertOrders(db, [order(1, { fulfillmentStatus: "completed" })]);
		const later = NOW + (HOLD_HOURS + 1) * 3_600_000;
		expect((await tableStates(db, floor, later)).tables[0]?.status).toBe(
			"free",
		);
	});
});
