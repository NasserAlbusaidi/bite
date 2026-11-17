import type { Order } from "@bite/contracts";
import { schema, type Tx } from "@bite/db";
import { asc, eq, inArray } from "@bite/db/orm";

const { orders, orderLines, payments } = schema;
type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toOrderDto(
	o: OrderRow,
	lines: LineRow[],
	pays: PaymentRow[],
): Order {
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
		payments: pays.map((p) => ({
			id: p.id,
			orderId: p.orderId,
			amount: p.amount,
			tendered: p.tendered,
			tip: p.tip,
			method: p.method,
			state: p.state,
			reversesPaymentId: p.reversesPaymentId,
			reason: p.reason,
			businessDate: p.businessDate,
			createdAt: p.createdAt.toISOString(),
		})),
	};
}

function groupBy<T>(rows: T[], key: (r: T) => string) {
	const m = new Map<string, T[]>();
	for (const r of rows) {
		const k = key(r);
		const list = m.get(k);
		if (list) list.push(r);
		else m.set(k, [r]);
	}
	return m;
}

/** Load orders with their lines, preserving the input order. */
export async function loadOrderDtos(
	tx: Tx,
	rows: OrderRow[],
): Promise<Order[]> {
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const [lines, pays] = await Promise.all([
		tx
			.select()
			.from(orderLines)
			.where(inArray(orderLines.orderId, ids))
			.orderBy(asc(orderLines.sortOrder), asc(orderLines.id)),
		tx
			.select()
			.from(payments)
			.where(inArray(payments.orderId, ids))
			// uuidv7 ids sort by creation time; id breaks createdAt ties.
			.orderBy(asc(payments.createdAt), asc(payments.id)),
	]);
	const linesBy = groupBy(lines, (l) => l.orderId);
	const paysBy = groupBy(pays, (p) => p.orderId);
	return rows.map((o) =>
		toOrderDto(o, linesBy.get(o.id) ?? [], paysBy.get(o.id) ?? []),
	);
}

export async function loadOrderDto(tx: Tx, id: string): Promise<Order | null> {
	const [o] = await tx.select().from(orders).where(eq(orders.id, id));
	if (!o) return null;
	const [dto] = await loadOrderDtos(tx, [o]);
	return dto ?? null;
}
