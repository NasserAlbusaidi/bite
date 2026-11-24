import { allocate } from "./allocate.js";
import { divRound, type Minor, minor } from "./money.js";
import { type PaymentStatus, paymentStatusFor } from "./order-status.js";

export type PaymentMethod =
	| "cash"
	| "card"
	| "softpos"
	| "thawani"
	| "stripe"
	| "other"
	| "loyalty";
export type PaymentState = "pending" | "succeeded" | "failed";

/** One row of the append-only payments ledger (the subset core needs). */
export interface LedgerEntry {
	readonly id: string;
	/** Positive = money in, negative = refund. Never zero. Excludes tip. */
	readonly amount: Minor;
	readonly method: PaymentMethod;
	readonly state: PaymentState;
	/** Set on refunds: the payment being reversed. */
	readonly reversesPaymentId?: string | null;
}

export interface PaymentSummary {
	/** Σ succeeded positive amounts. */
	readonly paid: Minor;
	/** Σ |succeeded refunds|. */
	readonly refunded: Minor;
	/** paid − refunded. This is orders.paid_total. */
	readonly net: Minor;
	/** Σ pending positive amounts (in flight at Thawani / terminal). */
	readonly pending: Minor;
	/** What is still owed, ignoring pending: max(0, total − net). */
	readonly balanceDue: Minor;
	/** What can still be charged without risking an overpayment: balanceDue − pending, floored at 0. */
	readonly chargeable: Minor;
	readonly status: PaymentStatus;
}

export function summarizePayments(
	total: Minor,
	entries: readonly LedgerEntry[],
): PaymentSummary {
	let paid = 0;
	let refunded = 0;
	let pending = 0;
	for (const e of entries) {
		if (!Number.isSafeInteger(e.amount) || e.amount === 0) {
			throw new RangeError(`Payment ${e.id} amount must be a non-zero integer`);
		}
		if (e.amount < 0 !== (e.reversesPaymentId != null)) {
			throw new RangeError(
				`Payment ${e.id}: negative amount <=> reversesPaymentId`,
			);
		}
		if (e.state === "succeeded") {
			if (e.amount > 0) paid += e.amount;
			else refunded -= e.amount;
		} else if (e.state === "pending" && e.amount > 0) {
			pending += e.amount;
		}
	}
	const net = paid - refunded;
	const balanceDue = Math.max(0, total - net);
	return {
		paid: minor(paid),
		refunded: minor(refunded),
		net: minor(net),
		pending: minor(pending),
		balanceDue: minor(balanceDue),
		chargeable: minor(Math.max(0, balanceDue - pending)),
		status: paymentStatusFor(total, minor(paid), minor(refunded)),
	};
}

export type TenderError =
	| "amount_not_positive"
	| "overpayment" // more than is chargeable (pending payments count)
	| "tendered_not_cash"
	| "tendered_too_low";

/**
 * Check a new payment (one tender of a possibly split bill) before inserting
 * it. Cash may be over-tendered; the change is returned. Other methods must
 * charge exactly the amount.
 */
export function checkTender(
	summary: PaymentSummary,
	tender: {
		readonly amount: Minor;
		readonly method: PaymentMethod;
		readonly tendered?: Minor | null;
	},
): { ok: true; change: Minor } | { ok: false; error: TenderError } {
	if (!Number.isSafeInteger(tender.amount) || tender.amount <= 0)
		return { ok: false, error: "amount_not_positive" };
	if (tender.amount > summary.chargeable)
		return { ok: false, error: "overpayment" };
	if (tender.tendered != null) {
		if (tender.method !== "cash")
			return { ok: false, error: "tendered_not_cash" };
		if (tender.tendered < tender.amount)
			return { ok: false, error: "tendered_too_low" };
		return { ok: true, change: minor(tender.tendered - tender.amount) };
	}
	return { ok: true, change: minor(0) };
}

/** How much of one payment can still be refunded (pending refunds count as used). */
export function refundableAmount(
	paymentId: string,
	entries: readonly LedgerEntry[],
): Minor {
	const payment = entries.find((e) => e.id === paymentId);
	if (!payment || payment.amount <= 0 || payment.state !== "succeeded")
		return minor(0);
	let reversed = 0;
	for (const e of entries) {
		if (e.reversesPaymentId === paymentId && e.state !== "failed")
			reversed -= e.amount;
	}
	return minor(Math.max(0, payment.amount - reversed));
}

export interface RefundPart {
	readonly reversesPaymentId: string;
	readonly method: PaymentMethod;
	/** Negative, ready to insert as a ledger row. */
	readonly amount: Minor;
}

/**
 * Spread a refund of `amount` (positive) over the order's payments, newest
 * first, each back to its own method. Returns null when more is asked than
 * is refundable.
 */
export function planRefund(
	amount: Minor,
	entries: readonly LedgerEntry[],
): RefundPart[] | null {
	if (!Number.isSafeInteger(amount) || amount <= 0)
		throw new RangeError("Refund amount must be > 0");
	let left: number = amount;
	const parts: RefundPart[] = [];
	const payments = entries.filter(
		(e) => e.amount > 0 && e.state === "succeeded",
	);
	for (let i = payments.length - 1; i >= 0 && left > 0; i--) {
		const p = payments[i];
		if (!p) continue;
		const take = Math.min(left, refundableAmount(p.id, entries));
		if (take <= 0) continue;
		parts.push({
			reversesPaymentId: p.id,
			method: p.method,
			amount: minor(-take),
		});
		left -= take;
	}
	return left === 0 ? parts : null;
}

/**
 * Gross amount to refund for `quantity` more units of a line when
 * `alreadyRefunded` units were refunded before. Cumulative rounding, so
 * refunding a line one unit at a time adds up to exactly lineGross.
 */
export function lineRefundAmount(
	line: { readonly lineGross: Minor; readonly quantity: number },
	quantity: number,
	alreadyRefunded = 0,
): Minor {
	const q = line.quantity;
	if (
		!Number.isSafeInteger(quantity) ||
		quantity < 1 ||
		!Number.isSafeInteger(alreadyRefunded) ||
		alreadyRefunded < 0
	) {
		throw new RangeError("Quantities must be integers, quantity >= 1");
	}
	if (alreadyRefunded + quantity > q)
		throw new RangeError("Refunding more units than the line has");
	return minor(
		divRound(line.lineGross * (alreadyRefunded + quantity), q) -
			divRound(line.lineGross * alreadyRefunded, q),
	);
}

/** Split a bill into n equal-ish tenders; the first ones carry the extra baisa. */
export function splitEqually(amount: Minor, n: number): Minor[] {
	if (!Number.isSafeInteger(n) || n < 1)
		throw new RangeError(`n must be >= 1, got ${n}`);
	return allocate(
		amount,
		Array.from({ length: n }, () => 1),
	);
}

/** Change for a cash tender. */
export function cashChange(amount: Minor, tendered: Minor): Minor {
	if (tendered < amount) throw new RangeError("Tendered less than the amount");
	return minor(tendered - amount);
}
