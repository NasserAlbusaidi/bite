import type {
	AddPayment,
	Order,
	RefundPayment,
	SetFulfillment,
	VoidLine,
} from "@bite/contracts";
import {
	businessDate,
	checkFulfillmentTransition,
	checkTender,
	type Minor,
	type PaymentSummary,
	planRefund,
	refundableAmount,
	summarizePayments,
} from "@bite/core";
import type { SqlDriver, SqlExecutor } from "../db/driver.js";
import { enqueue } from "../sync/outbox.js";
import { newId } from "./ids.js";
import {
	type LedgerRow,
	type LocalPayment,
	mergeLedger,
	orderPayments,
	recordPayment,
	summarize,
	toLedger,
} from "./ledger.js";
import type { TenderInput } from "./sale.js";

export type OrderListItem = {
	order: Order;
	/** Something queued for this order was rejected by the server. */
	problem: boolean;
	/** Changes still waiting to sync. */
	pending: boolean;
};

/** Orders for a business day, newest first. `search` matches the ticket number or customer name. */
export async function listOrders(
	db: SqlExecutor,
	day: string,
	search = "",
): Promise<OrderListItem[]> {
	const like = `%${search.trim().toUpperCase()}%`;
	const rows = await db.all<{
		doc: string;
		problems: number;
		pending: number;
	}>(
		`SELECT o.doc,
		   (SELECT COUNT(*) FROM outbox x WHERE x.entity_id = o.id AND x.status IN ('rejected','blocked')) AS problems,
		   (SELECT COUNT(*) FROM outbox x WHERE x.entity_id = o.id AND x.status = 'pending') AS pending
		 FROM orders o
		 WHERE o.business_date = ?
		   AND (? = '%%' OR UPPER(o.ticket_number) LIKE ? OR UPPER(COALESCE(json_extract(o.doc, '$.customerName'), '')) LIKE ?)
		 ORDER BY o.placed_at DESC`,
		[day, like, like, like],
	);
	return rows.map((r) => ({
		order: JSON.parse(r.doc) as Order,
		problem: r.problems > 0,
		pending: r.pending > 0,
	}));
}

export type OrderDetail = {
	order: Order;
	/** Server rows plus this tablet's not yet echoed back. Empty for an unpaid order. */
	payments: LedgerRow[];
	summary: PaymentSummary;
	/** What can still be refunded. */
	refundable: Minor;
};

export async function loadOrder(
	db: SqlExecutor,
	orderId: string,
): Promise<OrderDetail | null> {
	const [row] = await db.all<{ doc: string; version: number }>(
		"SELECT doc, version FROM orders WHERE id = ?",
		[orderId],
	);
	if (!row) return null;
	const order = JSON.parse(row.doc) as Order;
	const payments = mergeLedger(
		order,
		row.version,
		await orderPayments(db, orderId),
	);
	const ledger = toLedger(payments);
	const refundable = ledger
		.filter((e) => e.amount > 0)
		.reduce((s, e) => s + refundableAmount(e.id, ledger), 0) as Minor;
	return {
		order,
		payments,
		summary: summarize(order.total, payments),
		refundable,
	};
}

/** The amount a guest paid for one line: tax included either way. */
export function lineGross(order: Order, lineId: string): Minor {
	const l = order.lines.find((x) => x.id === lineId);
	if (!l) throw new RangeError("No such line");
	return (
		order.pricesIncludeTax ? l.lineTotal : l.lineTotal + l.lineTax
	) as Minor;
}

/** Same arithmetic as the server's voidLine: totals are sums over the open lines. */
function withLineVoided(
	order: Order,
	lineId: string,
	reason: string,
	at: string,
): Order {
	const lines = order.lines.map((l) =>
		l.id === lineId ? { ...l, voidedAt: at, voidReason: reason } : l,
	);
	const open = lines.filter((l) => l.voidedAt === null);
	const subtotal = open.reduce((s, l) => s + l.lineTotal, 0);
	const discountTotal = open.reduce((s, l) => s + l.lineDiscount, 0);
	const taxTotal = open.reduce((s, l) => s + l.lineTax, 0);
	const total = order.pricesIncludeTax ? subtotal : subtotal + taxTotal;
	return { ...order, lines, subtotal, discountTotal, taxTotal, total };
}

async function saveLocal(tx: SqlExecutor, order: Order) {
	// The version stays: a pulled copy that includes these changes replaces it.
	await tx.run(
		"UPDATE orders SET payment_status = ?, fulfillment_status = ?, doc = ? WHERE id = ?",
		[
			order.paymentStatus,
			order.fulfillmentStatus,
			JSON.stringify(order),
			order.id,
		],
	);
}

/** baseVersion only when the tablet is acting on the server's own state (see moveTicket). */
async function baseVersionFor(
	tx: SqlExecutor,
	orderId: string,
): Promise<{ baseVersion: number } | Record<string, never>> {
	const [row] = await tx.all<{ version: number; queued: number }>(
		`SELECT version, (SELECT COUNT(*) FROM outbox WHERE entity_id = ? AND status != 'applied') AS queued
		 FROM orders WHERE id = ?`,
		[orderId, orderId],
	);
	return row && row.version > 0 && row.queued === 0
		? { baseVersion: row.version }
		: {};
}

export type Place = { timeZone: string; dayCutoffMinutes: number };

export type RefundError =
	| "not_found"
	| "nothing_paid"
	| "refund_too_large"
	| "no_cash_session"
	| "order_closed"
	| "line_voided";

export type RefundInput = {
	orderId: string;
	/** Positive. */
	amount: Minor;
	reason: string;
	/** The manager who approved it. The server only accepts refunds from managers. */
	managerId: string;
	/** The drawer open on this tablet. Cash refunds come out of it. */
	cashSessionId: string | null;
	/** Also void this line (refunding an item on an open order). */
	voidLineId?: string;
	place: Place;
	at?: number;
};

/**
 * Refund money on an order, back to the methods it was paid with (newest
 * payment first, via core planRefund). One order.refund per payment touched,
 * plus order.voidLine when refunding an item on an order still open. The
 * server refuses to void a paid line before the refund, so the order matters.
 */
export async function refund(
	db: SqlDriver,
	input: RefundInput,
): Promise<{ ok: true; parts: number } | { ok: false; error: RefundError }> {
	const at = input.at ?? Date.now();
	const iso = new Date(at).toISOString();
	const day = businessDate(
		at,
		input.place.timeZone,
		input.place.dayCutoffMinutes,
	);
	return db.transaction(async (tx) => {
		const d = await loadOrder(tx, input.orderId);
		if (!d) return { ok: false as const, error: "not_found" as const };
		if (d.payments.length === 0)
			return { ok: false as const, error: "nothing_paid" as const };
		if (input.voidLineId) {
			const line = d.order.lines.find((l) => l.id === input.voidLineId);
			if (!line || line.voidedAt !== null)
				return { ok: false as const, error: "line_voided" as const };
			if (
				d.order.fulfillmentStatus === "completed" ||
				d.order.fulfillmentStatus === "cancelled"
			)
				return { ok: false as const, error: "order_closed" as const };
		}
		const parts = planRefund(input.amount, toLedger(d.payments));
		if (!parts)
			return { ok: false as const, error: "refund_too_large" as const };
		if (parts.some((p) => p.method === "cash") && !input.cashSessionId)
			return { ok: false as const, error: "no_cash_session" as const };

		const all = [...d.payments];
		for (const part of parts) {
			const isCash = part.method === "cash";
			const payload: RefundPayment = {
				id: newId(),
				reversesPaymentId: part.reversesPaymentId,
				amount: -part.amount,
				reason: input.reason,
				businessDate: day,
				...(isCash &&
					input.cashSessionId && { cashSessionId: input.cashSessionId }),
			};
			const m = await enqueue(tx, {
				kind: "order.refund",
				entityId: input.orderId,
				memberId: input.managerId,
				payload,
				now: new Date(at),
			});
			const row: LocalPayment = {
				id: payload.id,
				orderId: input.orderId,
				outboxId: m.id,
				amount: part.amount,
				tip: 0,
				tendered: null,
				method: part.method,
				sessionId: input.cashSessionId,
				reversesPaymentId: part.reversesPaymentId,
				reason: input.reason,
				memberId: input.managerId,
				businessDate: day,
				createdAt: iso,
			};
			await recordPayment(tx, row);
			all.push({
				id: row.id,
				amount: row.amount,
				method: row.method,
				state: "succeeded",
				reversesPaymentId: row.reversesPaymentId,
				reason: row.reason,
				createdAt: row.createdAt,
				local: true,
			});
		}

		let order = d.order;
		if (input.voidLineId) {
			const payload: VoidLine = {
				orderId: input.orderId,
				lineId: input.voidLineId,
				reason: input.reason,
			};
			await enqueue(tx, {
				kind: "order.voidLine",
				entityId: input.orderId,
				memberId: input.managerId,
				payload,
				now: new Date(at),
			});
			order = withLineVoided(order, input.voidLineId, input.reason, iso);
		}
		const s = summarize(order.total, all);
		order = { ...order, paymentStatus: s.status, paidTotal: s.net };
		await saveLocal(tx, order);
		return { ok: true as const, parts: parts.length };
	});
}

/**
 * Void a line nobody paid for yet (a QR order waiting at the counter, say).
 * A paid line has to be refunded instead: the server rejects the void.
 */
export async function voidUnpaidLine(
	db: SqlDriver,
	input: {
		orderId: string;
		lineId: string;
		reason: string;
		memberId: string;
		at?: number;
	},
): Promise<{ ok: true } | { ok: false; error: string }> {
	const at = input.at ?? Date.now();
	return db.transaction(async (tx) => {
		const d = await loadOrder(tx, input.orderId);
		if (!d) return { ok: false as const, error: "not_found" };
		const o = d.order;
		if (
			o.fulfillmentStatus === "completed" ||
			o.fulfillmentStatus === "cancelled"
		)
			return { ok: false as const, error: "order_closed" };
		const line = o.lines.find((l) => l.id === input.lineId);
		if (!line || line.voidedAt !== null)
			return { ok: false as const, error: "line_voided" };
		const after = withLineVoided(
			o,
			input.lineId,
			input.reason,
			new Date(at).toISOString(),
		);
		const net = d.summary.net;
		if (net > after.total) return { ok: false as const, error: "refund_first" };
		const payload: VoidLine = {
			orderId: o.id,
			lineId: input.lineId,
			reason: input.reason,
		};
		await enqueue(tx, {
			kind: "order.voidLine",
			entityId: o.id,
			memberId: input.memberId,
			payload,
			...(await baseVersionFor(tx, o.id)),
			now: new Date(at),
		});
		const s = summarize(after.total, d.payments);
		await saveLocal(tx, {
			...after,
			paymentStatus: s.status,
			paidTotal: s.net,
		});
		return { ok: true as const };
	});
}

export type ToPayItem = {
	order: Order;
	/** What is still owed, counting this tablet's payments the server hasn't echoed yet. */
	due: Minor;
};

/**
 * Orders waiting for money at the counter: QR and group orders mostly, plus
 * anything left part paid. Oldest first, because that guest has waited
 * longest. Any business day: an unpaid order from before the cutoff is still
 * standing at the till.
 */
export async function listToPay(db: SqlExecutor): Promise<ToPayItem[]> {
	const rows = await db.all<{ id: string }>(
		`SELECT id FROM orders
		 WHERE payment_status IN ('unpaid', 'partially_paid')
		   AND fulfillment_status NOT IN ('completed', 'cancelled')
		 ORDER BY placed_at ASC`,
	);
	const out: ToPayItem[] = [];
	for (const r of rows) {
		const d = await loadOrder(db, r.id);
		// The column can lag a payment queued on this tablet; the ledger doesn't.
		if (d && d.summary.balanceDue > 0)
			out.push({ order: d.order, due: d.summary.balanceDue });
	}
	return out;
}

export type PayOrderError =
	| "not_found"
	| "order_cancelled"
	| "nothing_due"
	| "no_cash_session"
	| "amount_not_positive"
	| "overpayment"
	| "tendered_not_cash"
	| "tendered_too_low";

export type PayOrderResult =
	| {
			ok: true;
			order: Order;
			/** Change across every cash tender. */
			change: Minor;
			payments: AddPayment[];
			/** Nothing left to pay after these tenders. */
			settled: boolean;
	  }
	| { ok: false; error: PayOrderError };

/**
 * Take money on an order that already exists: a QR order paid at the counter,
 * or the rest of a part-paid bill. One order.addPayment per tender, each
 * checked with core against the running balance exactly as the server will.
 * No baseVersion: the server skips it for payments (overpayment is the guard).
 */
export async function payOrder(
	db: SqlDriver,
	input: {
		orderId: string;
		tenders: readonly TenderInput[];
		memberId: string;
		/** The drawer open on this tablet. Cash goes into it. */
		cashSessionId: string | null;
		place: Place;
		at?: number;
	},
): Promise<PayOrderResult> {
	const at = input.at ?? Date.now();
	const iso = new Date(at).toISOString();
	const day = businessDate(
		at,
		input.place.timeZone,
		input.place.dayCutoffMinutes,
	);
	return db.transaction(async (tx) => {
		const d = await loadOrder(tx, input.orderId);
		if (!d) return { ok: false as const, error: "not_found" as const };
		if (d.order.fulfillmentStatus === "cancelled")
			return { ok: false as const, error: "order_cancelled" as const };
		if (d.summary.chargeable <= 0 || input.tenders.length === 0)
			return { ok: false as const, error: "nothing_due" as const };
		if (input.tenders.some((t) => t.method === "cash") && !input.cashSessionId)
			return { ok: false as const, error: "no_cash_session" as const };

		// Validate every tender before writing anything.
		const ledger = toLedger(d.payments);
		let change = 0;
		const payments: AddPayment[] = [];
		for (const t of input.tenders) {
			const check = checkTender(
				summarizePayments(d.order.total as Minor, ledger),
				{
					amount: t.amount,
					method: t.method,
					...(t.tendered !== undefined && { tendered: t.tendered }),
				},
			);
			if (!check.ok) return { ok: false as const, error: check.error };
			change += check.change;
			const p = {
				id: newId(),
				orderId: input.orderId,
				amount: t.amount,
				tip: 0,
				method: t.method,
				businessDate: day,
				...(t.method === "cash" && {
					cashSessionId: input.cashSessionId ?? undefined,
					tendered: t.tendered ?? t.amount,
				}),
			} as AddPayment;
			payments.push(p);
			ledger.push({
				id: p.id,
				amount: t.amount,
				method: t.method,
				state: "succeeded",
				reversesPaymentId: null,
			});
		}

		for (const p of payments) {
			const m = await enqueue(tx, {
				kind: "order.addPayment",
				entityId: input.orderId,
				memberId: input.memberId,
				payload: p,
				now: new Date(at),
			});
			await recordPayment(tx, {
				id: p.id,
				orderId: input.orderId,
				outboxId: m.id,
				amount: p.amount,
				tip: p.tip,
				tendered: p.tendered ?? null,
				method: p.method,
				// Every method, like a counter sale: the X/Z report counts card too.
				sessionId: input.cashSessionId,
				reversesPaymentId: null,
				reason: null,
				memberId: input.memberId,
				businessDate: day,
				createdAt: iso,
			});
		}

		const s = summarizePayments(d.order.total as Minor, ledger);
		const order: Order = {
			...d.order,
			paymentStatus: s.status,
			paidTotal: s.net,
		};
		await saveLocal(tx, order);
		return {
			ok: true as const,
			order,
			change: change as Minor,
			payments,
			settled: s.balanceDue === 0,
		};
	});
}

/**
 * Cancel a whole order nobody holds money for: a QR order the guest walked
 * away from, or one already refunded in full. An order with money on it must
 * be refunded first (core and the server both say "refund_first").
 */
export async function cancelOrder(
	db: SqlDriver,
	input: { orderId: string; reason: string; memberId: string; at?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
	const at = input.at ?? Date.now();
	return db.transaction(async (tx) => {
		const d = await loadOrder(tx, input.orderId);
		if (!d) return { ok: false as const, error: "not_found" };
		const check = checkFulfillmentTransition(
			d.order.fulfillmentStatus,
			"cancelled",
			d.summary.status,
		);
		if (!check.ok) return { ok: false as const, error: check.error };
		const payload: SetFulfillment = {
			orderId: input.orderId,
			to: "cancelled",
			reason: input.reason,
		};
		await enqueue(tx, {
			kind: "order.setFulfillment",
			entityId: input.orderId,
			memberId: input.memberId,
			payload,
			...(await baseVersionFor(tx, input.orderId)),
			now: new Date(at),
		});
		await saveLocal(tx, {
			...d.order,
			fulfillmentStatus: "cancelled",
			cancelledAt: new Date(at).toISOString(),
			cancelReason: input.reason,
		});
		return { ok: true as const };
	});
}
