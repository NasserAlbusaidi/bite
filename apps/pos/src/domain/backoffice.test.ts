import { RefundPayment, SyncMutation, VoidLine } from "@bite/contracts";
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
	closeCashSession,
	openCashSession,
	sessionReport,
} from "./cash.js";
import { newId } from "./ids.js";
import { orderPayments } from "./ledger.js";
import { prepareMenu } from "./menu.js";
import {
	lineGross,
	listOrders,
	loadOrder,
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
