import type { Order } from "@bite/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import type { SqlDriver } from "../db/driver.js";
import { migrate } from "../db/migrations.js";
import { openSqlJs } from "../db/sqljs-driver.js";
import { listOutbox } from "../sync/outbox.js";
import { kitchenOrders, moveTicket, nextStatus } from "./kitchen.js";
import { upsertOrders } from "./sale.js";

const M = "0190f000-0000-7000-8000-0000000000aa";
const id = (n: number) =>
	`0190f000-0000-7000-8000-${String(n).padStart(12, "0")}`;

function order(n: number, over: Partial<Order> = {}): Order {
	return {
		id: id(n),
		locationId: id(900),
		deviceId: null,
		ticketNumber: `Q-${n}`,
		businessDate: "2026-11-17",
		source: "guest",
		type: "takeaway",
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
		placedAt: `2026-11-17T10:0${n}:00Z`,
		readyAt: null,
		completedAt: null,
		cancelledAt: null,
		cancelReason: null,
		version: 3,
		updatedAt: "2026-11-17T10:00:00Z",
		lines: [],
		...over,
	};
}

let db: SqlDriver;
beforeEach(async () => {
	db = await openSqlJs();
	await migrate(db);
});

describe("kitchen", () => {
	it("shows paid open orders oldest first, hides unpaid and finished", async () => {
		await upsertOrders(db, [
			order(3),
			order(1),
			order(2, { paymentStatus: "unpaid" }),
			order(4, { fulfillmentStatus: "completed" }),
			order(5, { fulfillmentStatus: "cancelled" }),
		]);
		expect((await kitchenOrders(db)).map((o) => o.ticketNumber)).toEqual([
			"Q-1",
			"Q-3",
		]);
	});

	it("bumps locally at once; first move sends baseVersion, chained moves don't", async () => {
		await upsertOrders(db, [order(1)]);
		expect(
			await moveTicket(db, {
				orderId: id(1),
				to: nextStatus("pending") ?? "preparing",
				memberId: M,
			}),
		).toEqual({ ok: true });
		expect(
			await moveTicket(db, { orderId: id(1), to: "ready", memberId: M }),
		).toEqual({ ok: true });
		const [o] = await kitchenOrders(db);
		expect(o?.fulfillmentStatus).toBe("ready");
		expect(o?.readyAt).not.toBeNull();
		const q = await listOutbox(db);
		expect(q.map((m) => [m.kind, m.baseVersion])).toEqual([
			["order.setFulfillment", 3],
			["order.setFulfillment", undefined],
		]);
	});

	it("refuses illegal moves with core's rules and queues nothing", async () => {
		await upsertOrders(db, [
			order(1, { paymentStatus: "unpaid" }),
			order(2, { fulfillmentStatus: "ready" }),
		]);
		expect(
			await moveTicket(db, { orderId: id(1), to: "preparing", memberId: M }),
		).toEqual({ ok: false, error: "unpaid" });
		expect(
			await moveTicket(db, { orderId: id(2), to: "pending", memberId: M }),
		).toMatchObject({ ok: false });
		expect(await listOutbox(db)).toHaveLength(0);
	});

	it("recall: ready back to preparing clears readyAt", async () => {
		await upsertOrders(db, [
			order(1, { fulfillmentStatus: "ready", readyAt: "2026-11-17T10:05:00Z" }),
		]);
		expect(
			await moveTicket(db, { orderId: id(1), to: "preparing", memberId: M }),
		).toEqual({ ok: true });
		const [o] = await kitchenOrders(db);
		expect(o).toMatchObject({ fulfillmentStatus: "preparing", readyAt: null });
	});
});
