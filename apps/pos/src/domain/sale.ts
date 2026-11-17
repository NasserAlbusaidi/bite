import type {
	AddPayment,
	CreatePosOrder,
	Order,
	PaymentMethod,
} from "@bite/contracts";
import {
	type BasisPoints,
	businessDate,
	type CartLine,
	checkTender,
	type LedgerEntry,
	localClock,
	type Minor,
	type PricedOrder,
	type PricingError,
	priceCart,
	summarizePayments,
} from "@bite/core";
import type { SqlDriver } from "../db/driver.js";
import { enqueue } from "../sync/outbox.js";
import { newId } from "./ids.js";
import type { PricedMenu } from "./menu.js";
import { nextTicketNumber } from "./tickets.js";

/** A cart line as the till holds it: ids only, plus its own id for the order line. */
export type TillLine = CartLine & { lineId: string };

export type Quote =
	| { ok: true; priced: PricedOrder; at: number }
	| { ok: false; errors: readonly PricingError[] };

/** Price the till's cart with exactly the core call the server will check against. */
export function quote(
	menu: PricedMenu,
	lines: readonly TillLine[],
	at: number,
): Quote {
	if (lines.length === 0)
		return { ok: false, errors: [{ code: "empty_cart" } as PricingError] };
	const loc = menu.snapshot.location;
	const res = priceCart(lines, menu.catalog, {
		settings: {
			pricesIncludeTax: loc.pricesIncludeTax,
			taxBps: loc.taxBps as BasisPoints,
			locationId: loc.locationId,
		},
		promotions: menu.promotions,
		at: localClock(at, loc.timezone),
	});
	return res.ok
		? { ok: true, priced: res.value, at }
		: { ok: false, errors: res.errors };
}

export type TenderInput = {
	method: Extract<PaymentMethod, "cash" | "card" | "other">;
	amount: Minor;
	/** Cash only. */
	tendered?: Minor;
};

export type SaleInput = {
	menu: PricedMenu;
	lines: readonly TillLine[];
	/** Must be the `at` the cart was quoted with, so promotions match the server's re-check. */
	at: number;
	type: "dine_in" | "takeaway";
	note?: string;
	customerName?: string;
	ticketPrefix: string;
	memberId: string;
	tenders: TenderInput[];
	cashSessionId: string | null;
};

export type SaleResult =
	| { ok: true; order: Order; change: Minor; payments: AddPayment[] }
	| { ok: false; error: string };

/**
 * Commit a counter sale: one local transaction that allocates the ticket,
 * stores the order, and queues order.create plus every payment. Either all of
 * it lands on the tablet or none of it does.
 */
export async function commitSale(
	db: SqlDriver,
	input: SaleInput,
): Promise<SaleResult> {
	const q = quote(input.menu, input.lines, input.at);
	if (!q.ok)
		return { ok: false, error: q.errors.map((e) => e.code).join(", ") };
	const priced = q.priced;
	const loc = input.menu.snapshot.location;

	// Validate tenders with core before touching the DB.
	const ledger: LedgerEntry[] = [];
	let change = 0 as Minor;
	for (const [i, t] of input.tenders.entries()) {
		const check = checkTender(summarizePayments(priced.total, ledger), {
			amount: t.amount,
			method: t.method,
			...(t.tendered !== undefined && { tendered: t.tendered }),
		});
		if (!check.ok) return { ok: false, error: check.error };
		change = (change + check.change) as Minor;
		ledger.push({
			id: String(i),
			amount: t.amount,
			method: t.method,
			state: "succeeded",
		});
	}
	if (input.tenders.some((t) => t.method === "cash") && !input.cashSessionId) {
		return { ok: false, error: "no_cash_session" };
	}

	const orderId = newId();
	const day = businessDate(input.at, loc.timezone, loc.dayCutoffMinutes);
	const placedAt = new Date(input.at).toISOString();

	return db.transaction(async (tx) => {
		const ticketNumber = await nextTicketNumber(tx, input.ticketPrefix, day);
		const create: CreatePosOrder = {
			id: orderId,
			ticketNumber,
			businessDate: day,
			source: "counter",
			type: input.type,
			...(input.customerName && { customerName: input.customerName }),
			...(input.note && { note: input.note }),
			placedAt,
			pricesIncludeTax: priced.pricesIncludeTax,
			lines: priced.lines.map((l, i) => {
				const src = input.lines[i];
				if (!src || !l.productId)
					throw new Error("priced line without a source line");
				return {
					id: src.lineId,
					productId: l.productId,
					quantity: l.quantity,
					modifierOptionIds: l.modifiers.map((m) => m.optionId),
					...(l.note && { note: l.note }),
					name: l.name,
					listUnitPrice: l.listUnitPrice,
					promotionId: l.promotionId,
					modifiers: l.modifiers.map((m) => ({ ...m })),
					taxBps: l.taxBps,
				};
			}),
			expectedTotals: {
				subtotal: priced.subtotal,
				discountTotal: priced.discountTotal,
				taxTotal: priced.taxTotal,
				total: priced.total,
			},
		};
		await enqueue(tx, {
			kind: "order.create",
			entityId: orderId,
			memberId: input.memberId,
			payload: create,
			now: new Date(input.at),
		});

		const payments: AddPayment[] = [];
		for (const t of input.tenders) {
			const p: AddPayment = {
				id: newId(),
				orderId,
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
			await enqueue(tx, {
				kind: "order.addPayment",
				entityId: orderId,
				memberId: input.memberId,
				payload: p,
				now: new Date(input.at),
			});
		}

		const paid = payments.reduce((s, p) => s + p.amount, 0);
		const order: Order = {
			id: orderId,
			locationId: loc.locationId,
			deviceId: null,
			ticketNumber,
			businessDate: day,
			source: "counter",
			type: input.type,
			paymentStatus:
				paid >= priced.total ? "paid" : paid > 0 ? "partially_paid" : "unpaid",
			fulfillmentStatus: "pending",
			customerName: input.customerName ?? null,
			note: input.note ?? null,
			pricesIncludeTax: priced.pricesIncludeTax,
			subtotal: priced.subtotal,
			discountTotal: priced.discountTotal,
			taxTotal: priced.taxTotal,
			total: priced.total,
			paidTotal: paid,
			placedAt,
			readyAt: null,
			completedAt: null,
			cancelledAt: null,
			cancelReason: null,
			version: 1,
			updatedAt: placedAt,
			lines: priced.lines.map((l, i) => ({
				id: input.lines[i]?.lineId ?? newId(),
				productId: l.productId,
				name: l.name,
				quantity: l.quantity,
				unitPrice: l.unitPrice,
				listUnitPrice: l.listUnitPrice,
				promotionId: l.promotionId,
				modifiers: l.modifiers.map((m) => ({ ...m })),
				taxBps: l.taxBps,
				lineTotal: l.lineTotal,
				lineDiscount: l.lineDiscount,
				lineTax: l.lineTax,
				note: l.note,
				voidedAt: null,
				voidReason: null,
			})),
		};
		// version 0 = ours, not yet confirmed by a pull. A pulled copy always wins.
		await tx.run(
			`INSERT INTO orders (id, ticket_number, business_date, fulfillment_status, payment_status, placed_at, version, doc)
			 VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
			[
				orderId,
				ticketNumber,
				day,
				order.fulfillmentStatus,
				order.paymentStatus,
				placedAt,
				JSON.stringify(order),
			],
		);
		return { ok: true as const, order, change, payments };
	});
}

/** Upsert a server copy. Higher version wins; local-only (0) always loses to the server. */
export async function upsertOrders(db: SqlDriver, orders: readonly Order[]) {
	if (orders.length === 0) return;
	await db.transaction(async (tx) => {
		for (const o of orders) {
			await tx.run(
				`INSERT INTO orders (id, ticket_number, business_date, fulfillment_status, payment_status, placed_at, version, doc)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT (id) DO UPDATE SET
				   ticket_number = excluded.ticket_number, business_date = excluded.business_date,
				   fulfillment_status = excluded.fulfillment_status, payment_status = excluded.payment_status,
				   placed_at = excluded.placed_at, version = excluded.version, doc = excluded.doc
				 WHERE excluded.version > orders.version`,
				[
					o.id,
					o.ticketNumber,
					o.businessDate,
					o.fulfillmentStatus,
					o.paymentStatus,
					o.placedAt,
					o.version,
					JSON.stringify(o),
				],
			);
		}
	});
}
