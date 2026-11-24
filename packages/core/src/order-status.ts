import type { Minor } from "./money.js";

/** Mirrors the db enums. */
export const FULFILLMENT_STATUSES = [
	"pending",
	"preparing",
	"ready",
	"completed",
	"cancelled",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const PAYMENT_STATUSES = [
	"unpaid",
	"partially_paid",
	"paid",
	"partially_refunded",
	"refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Allowed fulfillment moves. Forward skips are allowed (a counter sale can go
 * pending → completed in one tap); the only backward move is ready →
 * preparing (KDS recall). completed and cancelled are terminal.
 */
const FULFILLMENT_EDGES: Readonly<
	Record<FulfillmentStatus, readonly FulfillmentStatus[]>
> = {
	pending: ["preparing", "ready", "completed", "cancelled"],
	preparing: ["ready", "completed", "cancelled"],
	ready: ["preparing", "completed", "cancelled"],
	completed: [],
	cancelled: [],
};

export function fulfillmentTransitions(
	from: FulfillmentStatus,
): readonly FulfillmentStatus[] {
	return FULFILLMENT_EDGES[from];
}

/** Graph check only, ignores payment. Use checkFulfillmentTransition for the real rule. */
export function canTransition(
	from: FulfillmentStatus,
	to: FulfillmentStatus,
): boolean {
	return FULFILLMENT_EDGES[from].includes(to);
}

export interface FulfillmentPolicy {
	/**
	 * Kitchen only starts on paid orders. This is the legacy behaviour (the KDS
	 * only showed paid orders), so it is the default. Turn off for dine-in
	 * pay-at-the-end locations.
	 */
	readonly kitchenRequiresPayment: boolean;
}

export const DEFAULT_FULFILLMENT_POLICY: FulfillmentPolicy = {
	kitchenRequiresPayment: true,
};

/**
 * Which policy applies to one order. A tab is a dine-in order a member of
 * staff rang up for a table, to be paid at the end: the kitchen starts it
 * unpaid. Guest QR and group orders, takeaway and counter orders without a
 * table keep the default (paid first), so nobody can send food out from a
 * phone without paying. Completing still needs the bill settled.
 */
export function isTab(o: {
	source: string;
	type: string;
	tableLabel?: string | null | undefined;
}): boolean {
	return o.source === "counter" && o.type === "dine_in" && !!o.tableLabel;
}

export function fulfillmentPolicyFor(o: {
	source: string;
	type: string;
	tableLabel?: string | null | undefined;
}): FulfillmentPolicy {
	return isTab(o)
		? { kitchenRequiresPayment: false }
		: DEFAULT_FULFILLMENT_POLICY;
}

export type TransitionError =
	| "not_allowed" // not an edge in the graph
	| "unpaid" // needs paid (completed, or kitchen start under kitchenRequiresPayment)
	| "refund_first"; // cancelling an order that still holds money

const SETTLED: readonly PaymentStatus[] = [
	"paid",
	"partially_refunded",
	"refunded",
];
const NO_MONEY_HELD: readonly PaymentStatus[] = ["unpaid", "refunded"];

/**
 * The full rule for moving an order's fulfillment status.
 * - completed needs the bill settled (paid, or paid then refunded).
 * - cancelled needs no money held: refund every payment first. Matches
 *   legacy `canCancelWithoutPaymentReversal`.
 * - preparing/ready/completed from pending need payment when the policy says so.
 */
export function checkFulfillmentTransition(
	from: FulfillmentStatus,
	to: FulfillmentStatus,
	paymentStatus: PaymentStatus,
	policy: FulfillmentPolicy = DEFAULT_FULFILLMENT_POLICY,
): { ok: true } | { ok: false; error: TransitionError } {
	if (!canTransition(from, to)) return { ok: false, error: "not_allowed" };
	if (to === "cancelled") {
		return NO_MONEY_HELD.includes(paymentStatus)
			? { ok: true }
			: { ok: false, error: "refund_first" };
	}
	if (to === "completed" && !SETTLED.includes(paymentStatus))
		return { ok: false, error: "unpaid" };
	if (
		from === "pending" &&
		policy.kitchenRequiresPayment &&
		!SETTLED.includes(paymentStatus)
	) {
		return { ok: false, error: "unpaid" };
	}
	return { ok: true };
}

/**
 * Payment status is DERIVED from the ledger, never set by hand.
 * `paid` = Σ succeeded positive payments, `refunded` = Σ |succeeded refunds|
 * (both >= 0, tips excluded). A zero-total order counts as paid.
 */
export function paymentStatusFor(
	total: Minor,
	paid: Minor,
	refunded: Minor,
): PaymentStatus {
	if (total < 0 || paid < 0 || refunded < 0)
		throw new RangeError("Amounts must be >= 0");
	if (refunded > paid) throw new RangeError("Refunded more than was paid");
	const net = paid - refunded;
	if (refunded > 0) return net === 0 ? "refunded" : "partially_refunded";
	if (net >= total) return "paid";
	return net === 0 ? "unpaid" : "partially_paid";
}
