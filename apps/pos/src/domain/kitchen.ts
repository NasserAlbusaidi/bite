import type { FulfillmentStatus, Order, SetFulfillment } from "@bite/contracts";
import { checkFulfillmentTransition } from "@bite/core";
import type { SqlDriver } from "../db/driver.js";
import { enqueue } from "../sync/outbox.js";

/** What the kitchen sees: paid orders not yet completed, oldest first (FIFO). */
export async function kitchenOrders(db: SqlDriver): Promise<Order[]> {
	const rows = await db.all<{ doc: string }>(
		`SELECT doc FROM orders
		 WHERE fulfillment_status IN ('pending', 'preparing', 'ready')
		   AND payment_status IN ('paid', 'partially_refunded')
		 ORDER BY placed_at`,
	);
	return rows.map((r) => JSON.parse(r.doc) as Order);
}

/** The one-tap move for a ticket in each column. */
export function nextStatus(s: FulfillmentStatus): FulfillmentStatus | null {
	return s === "pending"
		? "preparing"
		: s === "preparing"
			? "ready"
			: s === "ready"
				? "completed"
				: null;
}

/**
 * Move a ticket. Updates the local copy at once (the kitchen must not wait on
 * the network) and queues order.setFulfillment.
 *
 * baseVersion is sent only when nothing else for this order is still queued:
 * then the tablet is acting on the server's state and a stale view must
 * conflict. With edits queued, the version is unknowable, so it's omitted.
 */
export async function moveTicket(
	db: SqlDriver,
	input: {
		orderId: string;
		to: FulfillmentStatus;
		memberId: string;
		reason?: string;
		now?: number;
	},
): Promise<{ ok: true } | { ok: false; error: string }> {
	return db.transaction(async (tx) => {
		const [row] = await tx.all<{ doc: string; version: number }>(
			"SELECT doc, version FROM orders WHERE id = ?",
			[input.orderId],
		);
		if (!row) return { ok: false as const, error: "not_found" };
		const order = JSON.parse(row.doc) as Order;
		const check = checkFulfillmentTransition(
			order.fulfillmentStatus,
			input.to,
			order.paymentStatus,
		);
		if (!check.ok) return { ok: false as const, error: check.error };

		const [queued] = await tx.all<{ n: number }>(
			"SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ? AND status != 'applied'",
			[input.orderId],
		);
		const at = new Date(input.now ?? Date.now()).toISOString();
		const updated: Order = {
			...order,
			fulfillmentStatus: input.to,
			...(input.to === "ready" && { readyAt: at }),
			...(input.to === "completed" && { completedAt: at }),
			...(input.to === "preparing" &&
				order.fulfillmentStatus === "ready" && { readyAt: null }),
		};
		await tx.run(
			"UPDATE orders SET fulfillment_status = ?, doc = ? WHERE id = ?",
			[input.to, JSON.stringify(updated), input.orderId],
		);
		const payload: SetFulfillment = {
			orderId: input.orderId,
			to: input.to,
			...(input.reason && { reason: input.reason }),
		};
		await enqueue(tx, {
			kind: "order.setFulfillment",
			entityId: input.orderId,
			memberId: input.memberId,
			payload,
			...((queued?.n ?? 0) === 0 &&
				row.version > 0 && { baseVersion: row.version }),
			...(input.now !== undefined && { now: new Date(input.now) }),
		});
		return { ok: true as const };
	});
}
