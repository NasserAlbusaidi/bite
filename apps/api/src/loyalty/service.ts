import type { GuestPastOrder, LoyaltyProgram } from "@bite/contracts";
import {
	type LoyaltyProgram as CoreProgram,
	DEFAULT_LOYALTY_PROGRAM,
	minor,
	normalizePhone,
	pointsEarned,
	redeem,
	summarizePayments,
} from "@bite/core";
import { schema, type Tx } from "@bite/db";
import { and, desc, eq, inArray, sql } from "@bite/db/orm";
import { ApiError } from "../lib/errors.js";
import { newSecret, sha256 } from "../lib/tokens.js";

const {
	customers,
	customerDevices,
	loyaltyLedger,
	loyaltyPrograms,
	orders,
	orderLines,
	payments,
} = schema;

type CustomerRow = typeof customers.$inferSelect;

export async function loadProgram(
	tx: Tx,
	orgId: string,
): Promise<LoyaltyProgram> {
	const [p] = await tx
		.select()
		.from(loyaltyPrograms)
		.where(eq(loyaltyPrograms.orgId, orgId));
	if (!p) return { ...DEFAULT_LOYALTY_PROGRAM, rewards: [] };
	return {
		enabled: p.enabled,
		pointsPerRial: p.pointsPerRial,
		rewards: p.rewards.map((r) => ({
			id: r.id,
			name: r.name.ar ? { en: r.name.en, ar: r.name.ar } : { en: r.name.en },
			points: r.points,
			value: r.value,
		})),
	};
}

const toCore = (p: LoyaltyProgram): CoreProgram => ({
	...p,
	rewards: p.rewards.map((r) => ({ ...r, value: minor(r.value) })),
});

export async function saveProgram(
	tx: Tx,
	orgId: string,
	p: LoyaltyProgram,
): Promise<void> {
	await tx
		.insert(loyaltyPrograms)
		.values({ orgId, ...p, rewards: p.rewards })
		.onConflictDoUpdate({
			target: loyaltyPrograms.orgId,
			set: {
				enabled: p.enabled,
				pointsPerRial: p.pointsPerRial,
				rewards: p.rewards,
				updatedAt: new Date(),
			},
		});
}

/**
 * Find or create the org's customer for a typed phone number. Returns null
 * when the number isn't one. A name fills in a blank one; it never
 * overwrites (a guest typing "Ali" doesn't rename the regular "Ali Hassan").
 */
export async function upsertCustomer(
	tx: Tx,
	orgId: string,
	rawPhone: string,
	name?: string | null,
): Promise<{ customer: CustomerRow; created: boolean } | null> {
	const phone = normalizePhone(rawPhone);
	if (!phone) return null;
	const clean = name?.trim() || null;
	const [inserted] = await tx
		.insert(customers)
		.values({ orgId, phone, name: clean })
		.onConflictDoNothing({ target: [customers.orgId, customers.phone] })
		.returning();
	if (inserted) return { customer: inserted, created: true };
	const [existing] = await tx
		.update(customers)
		.set({ name: sql`coalesce(${customers.name}, ${clean})` })
		.where(and(eq(customers.orgId, orgId), eq(customers.phone, phone)))
		.returning();
	if (!existing) throw new ApiError("internal", "customer vanished");
	return { customer: existing, created: false };
}

/** The customer behind a guest-menu token, or null. */
export async function customerForToken(
	tx: Tx,
	orgId: string,
	token: string | undefined,
): Promise<CustomerRow | null> {
	if (!token || token.length < 20 || token.length > 200) return null;
	const [d] = await tx
		.update(customerDevices)
		.set({ lastSeenAt: new Date() })
		.where(
			and(
				eq(customerDevices.orgId, orgId),
				eq(customerDevices.tokenHash, sha256(token)),
			),
		)
		.returning({ customerId: customerDevices.customerId });
	if (!d) return null;
	const [c] = await tx
		.select()
		.from(customers)
		.where(eq(customers.id, d.customerId));
	return c ?? null;
}

export async function issueGuestToken(
	tx: Tx,
	orgId: string,
	customerId: string,
): Promise<string> {
	const token = newSecret("bg_");
	await tx
		.insert(customerDevices)
		.values({ orgId, customerId, tokenHash: sha256(token) });
	return token;
}

/** Link an order to a customer and count the visit. */
export async function attachCustomer(
	tx: Tx,
	orderId: string,
	c: CustomerRow,
	at: Date,
): Promise<void> {
	await tx
		.update(orders)
		.set({
			customerId: c.id,
			customerPhone: c.phone,
			customerName: sql`coalesce(${orders.customerName}, ${c.name})`,
		})
		.where(eq(orders.id, orderId));
	await tx
		.update(customers)
		.set({
			visitCount: sql`${customers.visitCount} + 1`,
			lastVisitAt: sql`greatest(${customers.lastVisitAt}, ${at.toISOString()}::timestamptz)`,
		})
		.where(eq(customers.id, c.id));
}

/**
 * Award points once an order is fully paid. Earns on money actually paid
 * (rewards don't earn points). One earn row per order (unique index), so a
 * replayed settle is a no-op.
 */
export async function awardIfPaid(tx: Tx, orderId: string): Promise<number> {
	const [o] = await tx
		.select({
			orgId: orders.orgId,
			customerId: orders.customerId,
			paymentStatus: orders.paymentStatus,
		})
		.from(orders)
		.where(eq(orders.id, orderId));
	if (!o?.customerId || o.paymentStatus !== "paid") return 0;
	const [{ spent } = { spent: 0 }] = await tx
		.select({
			spent: sql<number>`coalesce(sum(${payments.amount}) filter (where ${payments.method} <> 'loyalty' and ${payments.state} = 'succeeded'), 0)::int8`,
		})
		.from(payments)
		.where(eq(payments.orderId, orderId));
	const program = toCore(await loadProgram(tx, o.orgId));
	const points = pointsEarned(program, minor(Number(spent)));
	if (points <= 0) return 0;
	const [row] = await tx
		.insert(loyaltyLedger)
		.values({
			orgId: o.orgId,
			customerId: o.customerId,
			orderId,
			kind: "earn",
			points,
		})
		.onConflictDoNothing()
		.returning({ id: loyaltyLedger.id });
	if (!row) return 0;
	await tx
		.update(customers)
		.set({ points: sql`${customers.points} + ${points}` })
		.where(eq(customers.id, o.customerId));
	return points;
}

/** Points the order will earn when paid, at today's rate. */
export async function pendingPoints(
	tx: Tx,
	orgId: string,
	total: number,
): Promise<number> {
	return pointsEarned(toCore(await loadProgram(tx, orgId)), minor(total));
}

/**
 * Spend a customer's points on a reward against an order: a "loyalty"
 * payment for min(reward value, balance due), a negative ledger row, and the
 * order's paid total recomputed. Locks the customer row so two tills can't
 * spend the same points.
 */
export async function redeemReward(
	tx: Tx,
	args: {
		orgId: string;
		orderId: string;
		customerId: string;
		rewardId: string;
		memberId?: string | null;
		deviceId?: string | null;
		now: Date;
	},
): Promise<{ paymentId: string; amount: number; points: number }> {
	const [cust] = await tx
		.select()
		.from(customers)
		.where(eq(customers.id, args.customerId))
		.for("update");
	if (!cust) throw new ApiError("not_found", "no such customer");
	const [o] = await tx
		.select()
		.from(orders)
		.where(eq(orders.id, args.orderId))
		.for("update");
	if (!o) throw new ApiError("not_found", "no such order");
	if (o.fulfillmentStatus === "cancelled")
		throw new ApiError("conflict", "order is cancelled");
	if (o.customerId && o.customerId !== cust.id)
		throw new ApiError("conflict", "order belongs to another guest");
	const ledger = await tx
		.select({
			id: payments.id,
			amount: payments.amount,
			method: payments.method,
			state: payments.state,
			reversesPaymentId: payments.reversesPaymentId,
		})
		.from(payments)
		.where(eq(payments.orderId, o.id));
	if (ledger.some((p) => p.method === "loyalty" && p.amount > 0))
		throw new ApiError("conflict", "a reward is already on this order");
	const before = summarizePayments(
		minor(o.total),
		ledger.map((p) => ({ ...p, amount: minor(p.amount) })),
	);
	const program = toCore(await loadProgram(tx, args.orgId));
	const r = redeem(program, cust.points, args.rewardId, before.chargeable);
	if (!r.ok) throw new ApiError("unprocessable", r.error, { reason: r.error });

	if (!o.customerId) await attachCustomer(tx, o.id, cust, args.now);
	const [pay] = await tx
		.insert(payments)
		.values({
			orgId: args.orgId,
			locationId: o.locationId,
			orderId: o.id,
			amount: r.amount,
			method: "loyalty",
			state: "succeeded",
			provider: "loyalty",
			providerReference: null,
			reason: r.reward.name.en,
			createdBy: args.memberId ?? null,
			deviceId: args.deviceId ?? null,
			businessDate: o.businessDate,
			resolvedAt: args.now,
		})
		.returning({ id: payments.id });
	if (!pay) throw new ApiError("internal", "payment insert returned nothing");
	await tx.insert(loyaltyLedger).values({
		orgId: args.orgId,
		customerId: cust.id,
		orderId: o.id,
		kind: "redeem",
		points: -r.reward.points,
		rewardId: r.reward.id,
		createdBy: args.memberId ?? null,
	});
	await tx
		.update(customers)
		.set({ points: sql`${customers.points} - ${r.reward.points}` })
		.where(eq(customers.id, cust.id));
	const after = summarizePayments(minor(o.total), [
		...ledger.map((p) => ({ ...p, amount: minor(p.amount) })),
		{
			id: pay.id,
			amount: r.amount,
			method: "loyalty",
			state: "succeeded",
		},
	]);
	await tx
		.update(orders)
		.set({
			paidTotal: after.net,
			paymentStatus: after.status,
			version: sql`${orders.version} + 1`,
		})
		.where(eq(orders.id, o.id));
	// The reward finished the bill: the money paid before it earns now.
	if (after.status === "paid") await awardIfPaid(tx, o.id);
	return { paymentId: pay.id, amount: r.amount, points: r.reward.points };
}

/** A guest's last few orders, with what "order again" needs. */
export async function recentOrders(
	tx: Tx,
	customerId: string,
	limit = 5,
): Promise<GuestPastOrder[]> {
	const os = await tx
		.select()
		.from(orders)
		.where(
			and(
				eq(orders.customerId, customerId),
				sql`${orders.fulfillmentStatus} <> 'cancelled'`,
			),
		)
		.orderBy(desc(orders.placedAt))
		.limit(limit);
	if (os.length === 0) return [];
	const lines = await tx
		.select()
		.from(orderLines)
		.where(
			and(
				inArray(
					orderLines.orderId,
					os.map((o) => o.id),
				),
				sql`${orderLines.voidedAt} is null`,
			),
		)
		.orderBy(orderLines.sortOrder);
	return os.map((o) => ({
		ticketNumber: o.ticketNumber,
		placedAt: o.placedAt.toISOString(),
		total: o.total,
		paymentStatus: o.paymentStatus,
		lines: lines
			.filter((l) => l.orderId === o.id)
			.map((l) => ({
				productId: l.productId,
				name: l.name,
				quantity: l.quantity,
				modifierOptionIds: l.modifiers.map((m) => m.optionId),
			})),
	}));
}
