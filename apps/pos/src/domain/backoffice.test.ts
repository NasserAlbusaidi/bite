import {
	type Order,
	RefundPayment,
	SyncMutation,
	VoidLine,
} from "@bite/contracts";
import type { Minor } from "@bite/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { SqlDriver } from "../db/driver.js";
import { migrate } from "../db/migrations.js";
import { openSqlJs } from "../db/sqljs-driver.js";
import { listOutbox } from "../sync/outbox.js";
import {
	dismissProblem,
	listProblems,
	retryProblem,
} from "../sync/problems.js";
import { syncCounts } from "../sync/status.js";
import { menuFixture, O_OAT, P_CROISSANT, P_FLAT } from "../test/fixtures.js";
import {
	addCashMovement,
	adoptCashSession,
	closeCashSession,
	openCashSession,
	openSession,
	sessionReport,
} from "./cash.js";
import { newId } from "./ids.js";
import { orderPayments } from "./ledger.js";
import { prepareMenu } from "./menu.js";
import {
	cancelOrder,
	lineGross,
	listOrders,
	listToPay,
	loadOrder,
	payOrder,
	refund,
	voidUnpaidLine,
} from "./orders.js";
import { commitSale, type TenderInput, upsertOrders } from "./sale.js";

const CASHIER = "0190f000-0000-7000-8000-0000000000aa";
const MANAGER = "0190f000-0000-7000-8000-0000000000cc";
const AT = Date.parse("2026-11-17T08:00:00Z");
const PLACE = { timeZone: "Asia/Muscat", dayCutoffMinutes: 240 };

let db: SqlDriver;
beforeEach(async () => {
	db = await openSqlJs();
	await migrate(db);
});

async function drawer(float = 10_000) {
	return openCashSession(db, {
		openingFloat: float,
		memberId: CASHIER,
		at: AT,
		...PLACE,
	});
}

/** Flat white with oat (2.100) + croissant (1.125 after 10% off) = 3.225, inclusive VAT. */
async function sale(tenders: TenderInput[], sessionId: string | null) {
	const res = await commitSale(db, {
		menu: prepareMenu(menuFixture()),
		lines: [
			{
				lineId: newId(),
				productId: P_FLAT,
				quantity: 1,
				modifierOptionIds: [O_OAT],
			},
			{
				lineId: newId(),
				productId: P_CROISSANT,
				quantity: 1,
				modifierOptionIds: [],
			},
		],
		at: AT,
		type: "takeaway",
		ticketPrefix: "A",
		memberId: CASHIER,
		tenders,
		cashSessionId: sessionId,
	});
	if (!res.ok) throw new Error(res.error);
	return res;
}

describe("refunds", () => {
	it("refunds an item from the newest payment, then voids it, and keeps totals in step with the server", async () => {
		const s = await drawer();
		const { order, payments } = await sale(
			[
				{ method: "card", amount: 2_000 as Minor },
				{ method: "cash", amount: 1_225 as Minor, tendered: 2_000 as Minor },
			],
			s.id,
		);
		const croissant = order.lines[1];
		if (!croissant) throw new Error("no line");
		const gross = lineGross(order, croissant.id);
		expect(gross).toBe(1_125);

		const res = await refund(db, {
			orderId: order.id,
			amount: gross,
			reason: "Burnt",
			managerId: MANAGER,
			cashSessionId: s.id,
			voidLineId: croissant.id,
			place: PLACE,
			at: AT + 60_000,
		});
		expect(res).toEqual({ ok: true, parts: 1 });

		const queued = (await listOutbox(db)).filter(
			(m) => m.entityId === order.id,
		);
		expect(queued.map((m) => m.kind)).toEqual([
			"order.create",
			"order.addPayment",
			"order.addPayment",
			"order.refund",
			"order.voidLine",
		]);
		const [, , , r, v] = queued;
		// Wire-valid, under the manager, against the cash payment (the newest).
		expect(SyncMutation.safeParse(r).success).toBe(true);
		expect(SyncMutation.safeParse(v).success).toBe(true);
		const rp = RefundPayment.parse(r?.payload);
		expect(rp).toMatchObject({
			amount: 1_125,
			reversesPaymentId: payments[1]?.id,
			cashSessionId: s.id,
			businessDate: "2026-11-17",
		});
		expect(r?.memberId).toBe(MANAGER);
		expect(VoidLine.parse(v?.payload).lineId).toBe(croissant.id);
		expect(v?.baseVersion).toBeUndefined();

		const after = await loadOrder(db, order.id);
		expect(after?.order.total).toBe(2_100);
		expect(after?.order.paymentStatus).toBe("partially_refunded");
		expect(after?.order.paidTotal).toBe(2_100);
		expect(after?.order.lines[1]?.voidedAt).not.toBeNull();
		expect(after?.refundable).toBe(2_100);
	});

	it("spreads a big refund over several payments, newest first", async () => {
		const s = await drawer();
		const { order } = await sale(
			[
				{ method: "card", amount: 2_000 as Minor },
				{ method: "cash", amount: 1_225 as Minor },
			],
			s.id,
		);
		const res = await refund(db, {
			orderId: order.id,
			amount: 3_225 as Minor,
			reason: "Wrong order",
			managerId: MANAGER,
			cashSessionId: s.id,
			place: PLACE,
		});
		expect(res).toEqual({ ok: true, parts: 2 });
		const d = await loadOrder(db, order.id);
		expect(d?.order.paymentStatus).toBe("refunded");
		expect(d?.refundable).toBe(0);
		const card = (await orderPayments(db, order.id)).find(
			(p) => p.amount < 0 && p.method === "card",
		);
		expect(card?.amount).toBe(-2_000);
	});

	it("refuses what the server would refuse", async () => {
		const s = await drawer();
		const { order } = await sale(
			[{ method: "cash", amount: 3_225 as Minor }],
			s.id,
		);
		const base = {
			orderId: order.id,
			reason: "x",
			managerId: MANAGER,
			place: PLACE,
		};
		expect(
			await refund(db, {
				...base,
				amount: 3_226 as Minor,
				cashSessionId: s.id,
			}),
		).toEqual({ ok: false, error: "refund_too_large" });
		expect(
			await refund(db, { ...base, amount: 100 as Minor, cashSessionId: null }),
		).toEqual({ ok: false, error: "no_cash_session" });
		const line = order.lines[0];
		if (!line) throw new Error("no line");
		expect(
			await voidUnpaidLine(db, {
				orderId: order.id,
				lineId: line.id,
				reason: "x",
				memberId: CASHIER,
			}),
		).toEqual({ ok: false, error: "refund_first" });
	});

	it("leaves out payments the server rejected", async () => {
		const s = await drawer();
		const { order, payments } = await sale(
			[{ method: "cash", amount: 3_225 as Minor }],
			s.id,
		);
		await db.run(
			"UPDATE outbox SET status = 'rejected' WHERE kind = 'order.addPayment'",
		);
		expect(await orderPayments(db, order.id)).toEqual([]);
		expect(payments).toHaveLength(1);
		expect((await loadOrder(db, order.id))?.payments).toEqual([]);
	});

	it("refunds an order paid on another device, and doesn't double count once the server echoes it", async () => {
		const s = await drawer();
		const { order } = await sale(
			[{ method: "card", amount: 3_225 as Minor }],
			null,
		);
		// Pretend a pull brought the server copy: a QR order paid by card elsewhere.
		const OTHER = "0190f000-0000-7000-8000-0000000000dd";
		const pulled = {
			...order,
			id: newId(),
			ticketNumber: "Q-7",
			source: "guest" as const,
			version: 3,
			payments: [
				{
					...order.payments[0],
					id: OTHER,
					orderId: "x",
					method: "thawani" as const,
				},
			],
		} as typeof order;
		await upsertOrders(db, [pulled]);
		const res = await refund(db, {
			orderId: pulled.id,
			amount: 1_000 as Minor,
			reason: "Cold",
			managerId: MANAGER,
			cashSessionId: s.id,
			place: PLACE,
		});
		expect(res).toEqual({ ok: true, parts: 1 });
		const r = (await listOutbox(db)).find((m) => m.kind === "order.refund");
		const rp = RefundPayment.parse(r?.payload);
		expect(rp.reversesPaymentId).toBe(OTHER);
		// Not cash, so no drawer on the wire.
		expect(rp.cashSessionId).toBeUndefined();

		const local = await loadOrder(db, pulled.id);
		expect(local?.refundable).toBe(2_225);
		expect(local?.payments.map((p) => p.local)).toEqual([false, true]);

		// The next pull includes the refund row: still one refund, not two.
		await upsertOrders(db, [
			{
				...pulled,
				version: 4,
				paymentStatus: "partially_refunded",
				payments: [
					...pulled.payments,
					{
						...pulled.payments[0],
						id: rp.id,
						amount: -1_000,
						reversesPaymentId: OTHER,
						reason: "Cold",
						createdAt: new Date().toISOString(),
					},
				],
			} as typeof order,
		]);
		const echoed = await loadOrder(db, pulled.id);
		expect(echoed?.payments).toHaveLength(2);
		expect(echoed?.payments.every((p) => !p.local)).toBe(true);
		expect(echoed?.refundable).toBe(2_225);
	});

	it("lists the day's orders and finds them by ticket", async () => {
		const s = await drawer();
		await sale([{ method: "cash", amount: 3_225 as Minor }], s.id);
		await sale([{ method: "card", amount: 3_225 as Minor }], s.id);
		const all = await listOrders(db, "2026-11-17");
		expect(all.map((o) => o.order.ticketNumber).sort()).toEqual([
			"A-001",
			"A-002",
		]);
		expect(all.every((o) => o.pending)).toBe(true);
		const one = await listOrders(db, "2026-11-17", "a-002");
		expect(one.map((o) => o.order.ticketNumber)).toEqual(["A-002"]);
	});
});

describe("drawer", () => {
	it("adds up an X report and closes into a Z report with the server's expected-cash formula", async () => {
		const s = await drawer(10_000);
		const { order } = await sale(
			[{ method: "cash", amount: 3_225 as Minor, tendered: 5_000 as Minor }],
			s.id,
		);
		await sale([{ method: "card", amount: 3_225 as Minor }], s.id);
		await refund(db, {
			orderId: order.id,
			amount: 1_125 as Minor,
			reason: "x",
			managerId: MANAGER,
			cashSessionId: s.id,
			place: PLACE,
		});
		expect(
			await addCashMovement(db, {
				sessionId: s.id,
				kind: "pay_out",
				amount: 1_000,
				reason: "Milk run",
				memberId: CASHIER,
			}),
		).toEqual({ ok: true });
		await addCashMovement(db, {
			sessionId: s.id,
			kind: "drop",
			amount: 5_000,
			reason: "Safe",
			memberId: CASHIER,
		});

		const x = await sessionReport(db, s.id);
		// 10.000 + 3.225 - 1.125 - 1.000 - 5.000 (change handed back never counts)
		expect(x?.expectedCash).toBe(6_100);
		expect(x?.byMethod.cash).toEqual({
			sales: 3_225,
			refunds: 1_125,
			count: 1,
		});
		expect(x?.byMethod.card).toEqual({ sales: 3_225, refunds: 0, count: 1 });
		expect(x?.orders).toBe(2);
		expect(x?.variance).toBeNull();
		expect(x?.unsynced).toBeGreaterThan(0);

		const z = await closeCashSession(db, {
			sessionId: s.id,
			countedCash: 6_000,
			memberId: CASHIER,
			at: AT + 3_600_000,
		});
		expect(z.variance).toBe(-100);
		expect(z.session.closedAt).not.toBeNull();
		const close = (await listOutbox(db)).find((m) => m.kind === "cash.close");
		expect(SyncMutation.parse(close).payload).toEqual({
			cashSessionId: s.id,
			countedCash: 6_000,
		});
		await expect(
			closeCashSession(db, {
				sessionId: s.id,
				countedCash: 1,
				memberId: CASHIER,
				at: AT,
			}),
		).rejects.toThrow();
		expect(
			await addCashMovement(db, {
				sessionId: s.id,
				kind: "pay_in",
				amount: 1,
				reason: "late",
				memberId: CASHIER,
			}),
		).toEqual({ ok: false, error: "session_closed" });
	});
});

describe("adopting the server's open drawer", () => {
	const SERVER = {
		id: "0190f000-0000-7000-8000-0000000000dd",
		businessDate: "2026-11-17",
		openingFloat: 20_000,
		openedBy: MANAGER,
		openedAt: "2026-11-17T04:00:00.000Z",
		cashSoFar: 7_500,
	};

	it("takes over the drawer a re-paired tablet left open, and counts the cash already in it", async () => {
		expect(await adoptCashSession(db, SERVER, AT)).toBe(true);
		expect(await openSession(db)).toMatchObject({
			id: SERVER.id,
			openingFloat: 20_000,
		});
		// Nothing queued: the session already exists on the server.
		expect(await listOutbox(db)).toEqual([]);
		await sale([{ method: "cash", amount: 3_225 as Minor }], SERVER.id);
		const x = await sessionReport(db, SERVER.id);
		expect(x?.carried).toBe(7_500);
		// float 20.000 + 7.500 already in + 3.225 now: the server's figure too.
		expect(x?.expectedCash).toBe(30_725);
		// Pulling again changes nothing.
		expect(await adoptCashSession(db, SERVER, AT)).toBe(false);
	});

	it("leaves a drawer the server accepted alone, and does nothing without one", async () => {
		expect(await adoptCashSession(db, null, AT)).toBe(false);
		expect(await adoptCashSession(db, undefined, AT)).toBe(false);
		const mine = await drawer();
		await db.run("UPDATE outbox SET status = 'applied'");
		expect(await adoptCashSession(db, SERVER, AT)).toBe(false);
		expect((await openSession(db))?.id).toBe(mine.id);
	});

	it("swaps out a drawer the server refused because one was already open", async () => {
		const mine = await drawer();
		await db.run(
			"UPDATE outbox SET status = 'rejected' WHERE kind = 'cash.open'",
		);
		expect(await adoptCashSession(db, SERVER, AT)).toBe(true);
		expect((await openSession(db))?.id).toBe(SERVER.id);
		const old = await sessionReport(db, mine.id);
		expect(old?.session.closedAt).not.toBeNull();
	});

	it("doesn't reopen a drawer this tablet closed while the close is still on its way", async () => {
		await adoptCashSession(db, SERVER, AT);
		await closeCashSession(db, {
			sessionId: SERVER.id,
			countedCash: 27_500,
			memberId: CASHIER,
			at: AT,
		});
		expect(await adoptCashSession(db, SERVER, AT)).toBe(false);
		expect(await openSession(db)).toBeNull();
	});
});

describe("sync problems", () => {
	async function park(entityId: string, status: "conflict" | "rejected") {
		const rows = await listOutbox(db);
		const [head, ...rest] = rows.filter((r) => r.entityId === entityId);
		if (!head) throw new Error("nothing queued");
		await db.run(
			"UPDATE outbox SET status = 'rejected', result = ?, last_error = 'x' WHERE id = ?",
			[
				JSON.stringify({
					id: head.id,
					status,
					entityId,
					error: { code: status, message: "nope" },
				}),
				head.id,
			],
		);
		for (const r of rest)
			await db.run("UPDATE outbox SET status = 'blocked' WHERE id = ?", [r.id]);
		return head.id;
	}

	it("re-sends a conflict under a new id with no baseVersion, blocked rows under their own", async () => {
		const { order } = await sale(
			[{ method: "card", amount: 3_225 as Minor }],
			null,
		);
		const oldId = await park(order.id, "conflict");
		const [g] = await listProblems(db);
		expect(g?.ticketNumber).toBe("A-001");
		expect(g?.retryable).toBe(true);
		expect(g?.items.map((i) => i.reason)).toEqual(["conflict", "blocked"]);

		expect(await retryProblem(db, order.id)).toEqual({ ok: true, requeued: 2 });
		const q = (await listOutbox(db)).filter((m) => m.entityId === order.id);
		expect(q.every((m) => m.status === "pending")).toBe(true);
		expect(q[0]?.id).not.toBe(oldId);
		expect(q[0]?.baseVersion).toBeUndefined();
		expect(await listProblems(db)).toEqual([]);
	});

	it("won't re-send a real rejection, and a manager can set it aside", async () => {
		const { order } = await sale(
			[{ method: "card", amount: 3_225 as Minor }],
			null,
		);
		await park(order.id, "rejected");
		expect((await syncCounts(db)).attention).toBe(2);
		expect(await retryProblem(db, order.id)).toEqual({
			ok: false,
			error: "rejected_cannot_retry",
		});
		expect(await dismissProblem(db, order.id)).toEqual({
			dismissed: 1,
			resent: 1,
		});
		expect((await syncCounts(db)).attention).toBe(0);
		expect(await listProblems(db)).toEqual([]);
		// What waited behind it goes out again under its own id.
		const q = (await listOutbox(db)).filter((m) => m.entityId === order.id);
		expect(q.map((m) => m.status)).toEqual(["rejected", "pending"]);
		// Still flagged on the order itself, so nobody mistakes it for a clean sale.
		const [row] = await listOrders(db, "2026-11-17");
		expect(row?.problem).toBe(true);
	});
});

describe("paying an order that already exists (QR order at the counter)", () => {
	/** A guest order as the pull delivers it: unpaid, version 3, no payments. */
	async function guestOrder() {
		const s = await sale([], null);
		const order: Order = {
			...s.order,
			source: "guest",
			customerName: "Aisha",
			version: 3,
			payments: [],
			paymentStatus: "unpaid",
			paidTotal: 0,
		};
		await db.run("DELETE FROM outbox");
		await upsertOrders(db, [order]);
		return order;
	}

	it("lists unpaid open orders oldest first and drops them once paid", async () => {
		const d = await drawer();
		const o = await guestOrder();
		expect((await listToPay(db)).map((x) => [x.order.id, x.due])).toEqual([
			[o.id, 3_225],
		]);
		const res = await payOrder(db, {
			orderId: o.id,
			tenders: [
				{ method: "cash", amount: 3_225 as Minor, tendered: 5_000 as Minor },
			],
			memberId: CASHIER,
			cashSessionId: d.id,
			place: PLACE,
			at: AT + 60_000,
		});
		if (!res.ok) throw new Error(res.error);
		expect(res.change).toBe(1_775);
		expect(res.settled).toBe(true);
		expect(res.order.paymentStatus).toBe("paid");
		expect(await listToPay(db)).toEqual([]);

		const [m] = await listOutbox(db);
		expect(m?.kind).toBe("order.addPayment");
		expect(m?.entityId).toBe(o.id);
		// The server takes payments without a baseVersion.
		expect(m?.baseVersion).toBeUndefined();
		expect(SyncMutation.safeParse(m).success).toBe(true);
		// Cash lands in this tablet's drawer.
		expect((await sessionReport(db, d.id))?.expectedCash).toBe(10_000 + 3_225);
	});

	it("splits a bill: cash share plus card share, change only on cash", async () => {
		const d = await drawer();
		const o = await guestOrder();
		const res = await payOrder(db, {
			orderId: o.id,
			tenders: [
				{ method: "cash", amount: 1_613 as Minor, tendered: 2_000 as Minor },
				{ method: "card", amount: 1_612 as Minor },
			],
			memberId: CASHIER,
			cashSessionId: d.id,
			place: PLACE,
		});
		if (!res.ok) throw new Error(res.error);
		expect(res.change).toBe(387);
		expect(res.payments.map((p) => [p.method, p.amount])).toEqual([
			["cash", 1_613],
			["card", 1_612],
		]);
		expect((await listOutbox(db)).map((m) => m.kind)).toEqual([
			"order.addPayment",
			"order.addPayment",
		]);
		const after = await loadOrder(db, o.id);
		expect(after?.summary.status).toBe("paid");
		expect(after?.refundable).toBe(3_225);
	});

	it("takes a part payment and leaves the rest on the to-pay list", async () => {
		const o = await guestOrder();
		const res = await payOrder(db, {
			orderId: o.id,
			tenders: [{ method: "card", amount: 1_000 as Minor }],
			memberId: CASHIER,
			cashSessionId: null,
			place: PLACE,
		});
		if (!res.ok) throw new Error(res.error);
		expect(res.settled).toBe(false);
		expect(res.order.paymentStatus).toBe("partially_paid");
		expect((await listToPay(db)).map((x) => x.due)).toEqual([2_225]);
	});

	it("refuses to overcharge, cash without a drawer, and a cancelled order, writing nothing", async () => {
		const o = await guestOrder();
		const pay = (tenders: TenderInput[], cashSessionId: string | null = null) =>
			payOrder(db, {
				orderId: o.id,
				tenders,
				memberId: CASHIER,
				cashSessionId,
				place: PLACE,
			});
		expect(
			await pay([
				{ method: "card", amount: 3_000 as Minor },
				{ method: "card", amount: 1_000 as Minor },
			]),
		).toEqual({ ok: false, error: "overpayment" });
		expect(await pay([{ method: "cash", amount: 3_225 as Minor }])).toEqual({
			ok: false,
			error: "no_cash_session",
		});
		expect(await listOutbox(db)).toEqual([]);
		expect(await orderPayments(db, o.id)).toEqual([]);

		const c = await cancelOrder(db, {
			orderId: o.id,
			reason: "Guest left",
			memberId: CASHIER,
		});
		expect(c).toEqual({ ok: true });
		expect(await pay([{ method: "card", amount: 3_225 as Minor }])).toEqual({
			ok: false,
			error: "order_cancelled",
		});
	});
});

describe("cancelling a whole order", () => {
	it("cancels an unpaid order against the server's version and takes it off the to-pay list", async () => {
		const s = await sale([], null);
		await db.run("DELETE FROM outbox");
		await upsertOrders(db, [{ ...s.order, source: "guest", version: 2 }]);
		const res = await cancelOrder(db, {
			orderId: s.order.id,
			reason: "Guest left",
			memberId: CASHIER,
			at: AT + 1_000,
		});
		expect(res).toEqual({ ok: true });
		const [m] = await listOutbox(db);
		expect(m?.kind).toBe("order.setFulfillment");
		expect(m?.baseVersion).toBe(2);
		expect(m?.payload).toEqual({
			orderId: s.order.id,
			to: "cancelled",
			reason: "Guest left",
		});
		expect(SyncMutation.safeParse(m).success).toBe(true);
		const after = await loadOrder(db, s.order.id);
		expect(after?.order.fulfillmentStatus).toBe("cancelled");
		expect(after?.order.cancelReason).toBe("Guest left");
		expect(await listToPay(db)).toEqual([]);
	});

	it("won't cancel while the order still holds money", async () => {
		const d = await drawer();
		const s = await sale(
			[{ method: "cash", amount: 3_225 as Minor, tendered: 3_225 as Minor }],
			d.id,
		);
		expect(
			await cancelOrder(db, {
				orderId: s.order.id,
				reason: "x",
				memberId: MANAGER,
			}),
		).toEqual({ ok: false, error: "refund_first" });
	});
});
