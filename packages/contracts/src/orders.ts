import { z } from "zod";
import {
	Bps,
	BusinessDate,
	FulfillmentStatus,
	Id,
	Instant,
	LocalizedText,
	NonNegMinor,
	OrderSource,
	OrderType,
	PaymentStatus,
	Version,
} from "./common.js";
import { Payment } from "./payments.js";

/** Client input for one line. Prices are never accepted from guests. */
export const OrderLineInput = z.object({
	/** Client-generated UUIDv7. */
	id: Id,
	productId: Id,
	quantity: z.int().min(1).max(999),
	modifierOptionIds: z.array(Id).max(50).default([]),
	note: z.string().max(500).optional(),
});

/**
 * Where a dine-in order goes: "7", "T12", "Terrace 3". Printed on the table
 * QR (`?table=7`) or typed at the till. Free text, trimmed, 1-20 chars.
 */
export const TableLabel = z.string().trim().min(1).max(20);

/**
 * Guest/QR order. Always priced server-side from the live menu.
 * Idempotency-Key header is required.
 */
export const CreateGuestOrderRequest = z.object({
	locationSlug: z.string().min(1),
	type: OrderType,
	customerName: z.string().max(80).optional(),
	customerPhone: z.string().max(20).optional(),
	tableLabel: TableLabel.optional(),
	note: z.string().max(500).optional(),
	lines: z.array(OrderLineInput).min(1).max(100),
	/** Spend points on this loyalty reward. Needs the guest token header. */
	rewardId: z.string().min(1).max(40).optional(),
});

/**
 * Tablet order (via sync push, kind "order.create"). The tablet may have been
 * offline with a stale menu, and the customer already saw/paid its price. So
 * the server accepts the tablet's *menu inputs* (list unit price, promotion,
 * modifier deltas, tax rate) as snapshotted, and recomputes every derived
 * amount with @bite/core. Client totals are a checksum: a mismatch is
 * rejected, which catches tablet pricing bugs instead of booking them.
 */
export const PosLineInput = OrderLineInput.extend({
	name: LocalizedText,
	listUnitPrice: NonNegMinor,
	promotionId: Id.nullable(),
	modifiers: z.array(
		z.object({
			groupId: Id,
			optionId: Id,
			name: LocalizedText,
			priceDelta: z.int(),
		}),
	),
	taxBps: Bps,
});

export const CreatePosOrder = z.object({
	/** Client-generated UUIDv7. */
	id: Id,
	ticketNumber: z.string().regex(/^[A-Z]{1,2}-\d{1,6}$/),
	businessDate: BusinessDate,
	source: OrderSource.exclude(["guest", "group"]),
	type: OrderType,
	customerName: z.string().max(80).optional(),
	customerPhone: z.string().max(20).optional(),
	tableLabel: TableLabel.optional(),
	note: z.string().max(500).optional(),
	placedAt: Instant,
	pricesIncludeTax: z.boolean(),
	lines: z.array(PosLineInput).min(1).max(200),
	expectedTotals: z.object({
		subtotal: NonNegMinor,
		discountTotal: NonNegMinor,
		taxTotal: NonNegMinor,
		total: NonNegMinor,
	}),
});

export const OrderLine = z.object({
	id: Id,
	productId: Id.nullable(),
	name: LocalizedText,
	quantity: z.int(),
	unitPrice: NonNegMinor,
	listUnitPrice: NonNegMinor,
	promotionId: Id.nullable(),
	modifiers: z.array(
		z.object({
			groupId: Id,
			optionId: Id,
			name: LocalizedText,
			priceDelta: z.int(),
		}),
	),
	taxBps: Bps,
	lineTotal: NonNegMinor,
	lineDiscount: NonNegMinor,
	lineTax: NonNegMinor,
	note: z.string().nullable(),
	voidedAt: Instant.nullable(),
	voidReason: z.string().nullable(),
});

export const Order = z.object({
	id: Id,
	locationId: Id,
	deviceId: Id.nullable(),
	ticketNumber: z.string(),
	businessDate: BusinessDate,
	source: OrderSource,
	type: OrderType,
	paymentStatus: PaymentStatus,
	fulfillmentStatus: FulfillmentStatus,
	customerName: z.string().nullable(),
	/** Optional so tablet docs stored before tables existed still parse. */
	tableLabel: z.string().nullable().optional(),
	note: z.string().nullable(),
	pricesIncludeTax: z.boolean(),
	subtotal: NonNegMinor,
	discountTotal: NonNegMinor,
	taxTotal: NonNegMinor,
	total: NonNegMinor,
	paidTotal: z.int(),
	placedAt: Instant,
	readyAt: Instant.nullable(),
	completedAt: Instant.nullable(),
	cancelledAt: Instant.nullable(),
	cancelReason: z.string().nullable(),
	/** Food is at the table (a tab can be served before it's paid). */
	servedAt: Instant.nullable().optional(),
	/** Staff cleared the table: the order stops holding it on the floor. */
	tableClearedAt: Instant.nullable().optional(),
	version: Version,
	updatedAt: Instant,
	lines: z.array(OrderLine),
	/**
	 * The full ledger, refunds included (negative rows with reversesPaymentId),
	 * oldest first. Any payment or refund bumps `version`, so pull re-sends it.
	 */
	payments: z.array(Payment),
});
export type Order = z.infer<typeof Order>;

/** Public guest tracking view (by tracking token). No staff/device ids. */
export const GuestOrderView = Order.pick({
	ticketNumber: true,
	type: true,
	tableLabel: true,
	paymentStatus: true,
	fulfillmentStatus: true,
	subtotal: true,
	discountTotal: true,
	taxTotal: true,
	total: true,
	placedAt: true,
	readyAt: true,
	lines: true,
})
	.extend({ trackingToken: Id })
	// Older API builds don't send it; a reward paid part of the bill when set.
	.extend({ paidTotal: Order.shape.paidTotal.optional() });

export const CreateGuestOrderResponse = z.object({
	order: GuestOrderView,
	/**
	 * Set when the order carried a phone and the org runs loyalty. `token` is
	 * only issued to the device that first used a number (or already holds
	 * one); keep it and send it as the guest token header from then on.
	 */
	guest: z
		.object({
			token: z.string().optional(),
			points: z.int(),
			/** Points this order will add once it is paid. */
			pointsPending: z.int(),
			/** Reward taken off this order, if any. */
			redeemed: z
				.object({ rewardId: z.string(), amount: NonNegMinor })
				.optional(),
		})
		.optional(),
});

export const SetFulfillment = z.object({
	orderId: Id,
	to: FulfillmentStatus,
	/** Required when to = cancelled. */
	reason: z.string().max(200).optional(),
});

export const VoidLine = z.object({
	orderId: Id,
	lineId: Id,
	reason: z.string().min(1).max(200),
});

export const ListOrdersQuery = z.object({
	businessDate: BusinessDate.optional(),
	fulfillment: z
		.union([FulfillmentStatus, z.array(FulfillmentStatus)])
		.optional(),
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type OrderLineInput = z.infer<typeof OrderLineInput>;
export type CreateGuestOrderRequest = z.infer<typeof CreateGuestOrderRequest>;
export type PosLineInput = z.infer<typeof PosLineInput>;
export type CreatePosOrder = z.infer<typeof CreatePosOrder>;
export type OrderLine = z.infer<typeof OrderLine>;
export type GuestOrderView = z.infer<typeof GuestOrderView>;
export type CreateGuestOrderResponse = z.infer<typeof CreateGuestOrderResponse>;
export type SetFulfillment = z.infer<typeof SetFulfillment>;
export type VoidLine = z.infer<typeof VoidLine>;
export type ListOrdersQuery = z.infer<typeof ListOrdersQuery>;
