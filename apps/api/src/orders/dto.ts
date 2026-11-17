import type { Order } from "@bite/contracts";
import { schema, type Tx } from "@bite/db";
import { asc, eq, inArray } from "drizzle-orm";

const { orders, orderLines } = schema;
type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toOrderDto(o: OrderRow, lines: LineRow[]): Order {
	return {
		id: o.id,
		locationId: o.locationId,
		deviceId: o.deviceId,
		ticketNumber: o.ticketNumber,
		businessDate: o.businessDate,
		source: o.source,
		type: o.type,
		paymentStatus: o.paymentStatus,
		fulfillmentStatus: o.fulfillmentStatus,
		customerName: o.customerName,
		note: o.note,
		pricesIncludeTax: o.pricesIncludeTax,
		subtotal: o.subtotal,
		discountTotal: o.discountTotal,
		taxTotal: o.taxTotal,
		total: o.total,
		paidTotal: o.paidTotal,
		placedAt: o.placedAt.toISOString(),
		readyAt: iso(o.readyAt),
		completedAt: iso(o.completedAt),
		cancelledAt: iso(o.cancelledAt),
		cancelReason: o.cancelReason,
		version: o.version,
		updatedAt: o.updatedAt.toISOString(),
		lines: lines.map((l) => ({
			id: l.id,
			productId: l.productId,
			name: l.name,
			quantity: l.quantity,
			unitPrice: l.unitPrice,
			listUnitPrice: l.listUnitPrice,
			promotionId: l.promotionId,
			modifiers: l.modifiers,
			taxBps: l.taxBps,
			lineTotal: l.lineTotal,
			lineDiscount: l.lineDiscount,
			lineTax: l.lineTax,
			note: l.note,
			voidedAt: iso(l.voidedAt),
			voidReason: l.voidReason,
		})),
	};
}

/** Load orders with their lines, preserving the input order. */
export async function loadOrderDtos(
	tx: Tx,
	rows: OrderRow[],
): Promise<Order[]> {
	if (rows.length === 0) return [];
	const lines = await tx
		.select()
		.from(orderLines)
		.where(
			inArray(
				orderLines.orderId,
				rows.map((r) => r.id),
			),
		)
		.orderBy(asc(orderLines.sortOrder), asc(orderLines.id));
	const byOrder = new Map<string, LineRow[]>();
	for (const l of lines) {
		const list = byOrder.get(l.orderId) ?? [];
		list.push(l);
		byOrder.set(l.orderId, list);
	}
	return rows.map((o) => toOrderDto(o, byOrder.get(o.id) ?? []));
}

export async function loadOrderDto(tx: Tx, id: string): Promise<Order | null> {
	const [o] = await tx.select().from(orders).where(eq(orders.id, id));
	if (!o) return null;
	const [dto] = await loadOrderDtos(tx, [o]);
	return dto ?? null;
}
