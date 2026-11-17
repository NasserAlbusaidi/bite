import type { Order, PaymentMethod, PaymentState } from "@bite/contracts";
import {
	type LedgerEntry,
	type Minor,
	type PaymentSummary,
	summarizePayments,
} from "@bite/core";
import type { SqlExecutor } from "../db/driver.js";

/** One row of the tablet's own payments ledger. */
export type LocalPayment = {
	id: string;
	orderId: string;
	outboxId: string;
	/** Negative = refund. */
	amount: number;
	tip: number;
	tendered: number | null;
	method: PaymentMethod;
	sessionId: string | null;
	reversesPaymentId: string | null;
	reason: string | null;
	memberId: string;
	businessDate: string;
	createdAt: string;
};

type Row = {
	id: string;
	order_id: string;
	outbox_id: string;
	amount: number;
	tip: number;
	tendered: number | null;
	method: string;
	session_id: string | null;
	reverses_payment_id: string | null;
	reason: string | null;
	member_id: string;
	business_date: string;
	created_at: string;
};

export async function recordPayment(tx: SqlExecutor, p: LocalPayment) {
	await tx.run(
		`INSERT INTO payments (id, order_id, outbox_id, amount, tip, tendered, method, session_id,
		   reverses_payment_id, reason, member_id, business_date, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			p.id,
			p.orderId,
			p.outboxId,
			p.amount,
			p.tip,
			p.tendered,
			p.method,
			p.sessionId,
			p.reversesPaymentId,
			p.reason,
			p.memberId,
			p.businessDate,
			p.createdAt,
		],
	);
}

/**
 * Rows the server has accepted or may still accept. A row whose own mutation
 * was rejected never happened server side, so it must not count toward
 * refunds or the drawer.
 */
const LIVE = `LEFT JOIN outbox o ON o.id = p.outbox_id
	WHERE (o.status IS NULL OR o.status != 'rejected')`;

function fromRow(r: Row): LocalPayment {
	return {
		id: r.id,
		orderId: r.order_id,
		outboxId: r.outbox_id,
		amount: r.amount,
		tip: r.tip,
		tendered: r.tendered,
		method: r.method as PaymentMethod,
		sessionId: r.session_id,
		reversesPaymentId: r.reverses_payment_id,
		reason: r.reason,
		memberId: r.member_id,
		businessDate: r.business_date,
		createdAt: r.created_at,
	};
}

export async function orderPayments(
	db: SqlExecutor,
	orderId: string,
): Promise<LocalPayment[]> {
	const rows = await db.all<Row>(
		`SELECT p.* FROM payments p ${LIVE} AND p.order_id = ? ORDER BY p.created_at, p.id`,
		[orderId],
	);
	return rows.map(fromRow);
}

export async function sessionPayments(
	db: SqlExecutor,
	sessionId: string,
): Promise<LocalPayment[]> {
	const rows = await db.all<Row>(
		`SELECT p.* FROM payments p ${LIVE} AND p.session_id = ? ORDER BY p.created_at, p.id`,
		[sessionId],
	);
	return rows.map(fromRow);
}

/** One payment or refund as the till shows it, whichever side it came from. */
export type LedgerRow = {
	id: string;
	/** Negative = refund. */
	amount: number;
	method: PaymentMethod;
	state: PaymentState;
	reversesPaymentId: string | null;
	reason: string | null;
	createdAt: string;
	/** Recorded on this tablet and not yet seen in a pulled copy. */
	local: boolean;
};

/**
 * The order's ledger: the server's rows (pulled copies carry them) plus this
 * tablet's rows the server hasn't echoed back yet. A local-only copy
 * (version 0) was built on this tablet, so only the local table counts:
 * that is where a rejected payment drops out.
 */
export function mergeLedger(
	order: Order,
	version: number,
	local: readonly LocalPayment[],
): LedgerRow[] {
	const rows: LedgerRow[] =
		version > 0
			? order.payments.map((p) => ({
					id: p.id,
					amount: p.amount,
					method: p.method,
					state: p.state,
					reversesPaymentId: p.reversesPaymentId,
					reason: p.reason,
					createdAt: p.createdAt,
					local: false,
				}))
			: [];
	const seen = new Set(rows.map((r) => r.id));
	for (const p of local) {
		if (seen.has(p.id)) continue;
		rows.push({
			id: p.id,
			amount: p.amount,
			method: p.method,
			state: "succeeded",
			reversesPaymentId: p.reversesPaymentId,
			reason: p.reason,
			createdAt: p.createdAt,
			local: true,
		});
	}
	return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function toLedger(rows: readonly LedgerRow[]): LedgerEntry[] {
	return rows.map((p) => ({
		id: p.id,
		amount: p.amount as Minor,
		method: p.method,
		state: p.state,
		reversesPaymentId: p.reversesPaymentId,
	}));
}

export function summarize(
	total: number,
	rows: readonly LedgerRow[],
): PaymentSummary {
	return summarizePayments(total as Minor, toLedger(rows));
}
