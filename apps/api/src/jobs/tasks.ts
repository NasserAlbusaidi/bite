import { type Db, schema } from "@bite/db";
import { and, eq, inArray, lt, sql } from "@bite/db/orm";

const { groupCarts, orders, syncMutations } = schema;

/**
 * Cross-tenant housekeeping. These run as bite_system (BYPASSRLS), never
 * from a request. Each one is a single idempotent statement, so a job that
 * runs twice or overlaps with itself does no harm.
 */

/**
 * Unpaid guest/group orders that nobody paid for in time are cancelled, so
 * they stop cluttering the POS. Only pending + unpaid: once the kitchen has
 * it or any money moved, a human decides. Bumps version, so tablets hear it.
 */
export async function expireGuestOrders(db: Db, now: Date): Promise<number> {
	const rows = await db
		.update(orders)
		.set({
			fulfillmentStatus: "cancelled",
			cancelledAt: now,
			cancelReason: "expired: not paid in time",
			version: sql`${orders.version} + 1`,
		})
		.where(
			and(
				inArray(orders.source, ["guest", "group"]),
				eq(orders.paymentStatus, "unpaid"),
				eq(orders.fulfillmentStatus, "pending"),
				lt(orders.expiresAt, now),
			),
		)
		.returning({ id: orders.id });
	return rows.length;
}

export async function expireGroupCarts(db: Db, now: Date): Promise<number> {
	const rows = await db
		.update(groupCarts)
		.set({ status: "expired", version: sql`${groupCarts.version} + 1` })
		.where(
			and(
				inArray(groupCarts.status, ["open", "locked"]),
				lt(groupCarts.expiresAt, now),
			),
		)
		.returning({ id: groupCarts.id });
	return rows.length;
}

/**
 * Idempotency records only matter while a tablet might still replay its
 * outbox. 30 days covers a tablet left in a drawer over a holiday.
 */
export async function pruneSyncMutations(
	db: Db,
	now: Date,
	keepDays = 30,
): Promise<number> {
	const cutoff = new Date(now.getTime() - keepDays * 86_400_000);
	const rows = await db
		.delete(syncMutations)
		.where(lt(syncMutations.createdAt, cutoff))
		.returning({ id: syncMutations.id });
	return rows.length;
}
