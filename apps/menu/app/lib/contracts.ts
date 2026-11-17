/**
 * TEMPORARY MIRROR of the parts of `@bite/contracts` the guest menu uses
 * (PR #2, not merged yet). When #2 lands this file becomes a re-export from
 * `@bite/contracts` and the mirror goes away. Group cart contracts come with
 * the group cart PR.
 *
 * Money is integer minor units (baisa). Nothing here is a float.
 */
import { z } from "zod";

// ---- mirrored from packages/contracts (PR #2) ------------------------------

const Id = z.uuid();
const Minor = z.int().refine(Number.isSafeInteger, "not a safe integer");
const NonNegMinor = Minor.refine((n) => n >= 0, "must be >= 0");
const Bps = z.int().min(0).max(10_000);
const Instant = z.iso.datetime({ offset: true });

export const LocalizedText = z.object({
	en: z.string().min(1),
	ar: z.string().min(1).optional(),
});
export type LocalizedText = z.infer<typeof LocalizedText>;

export const OrderType = z.enum(["dine_in", "takeaway"]);
export const PaymentStatus = z.enum([
	"unpaid",
	"partially_paid",
	"paid",
	"partially_refunded",
	"refunded",
]);
export const FulfillmentStatus = z.enum([
	"pending",
	"preparing",
	"ready",
	"completed",
	"cancelled",
]);

export const LocationPricing = z.object({
	locationId: Id,
	currencyCode: z.string().length(3),
	currencyDecimals: z.int().min(0).max(4),
	pricesIncludeTax: z.boolean(),
	taxBps: Bps,
	timezone: z.string(),
	dayCutoffMinutes: z.int().min(0).max(1439),
});

export const MenuCategory = z.object({
	id: Id,
	parentId: Id.nullable(),
	name: LocalizedText,
	sortOrder: z.int(),
});
export type MenuCategory = z.infer<typeof MenuCategory>;

export const MenuModifierOption = z.object({
	id: Id,
	name: LocalizedText,
	priceDelta: Minor,
	sortOrder: z.int(),
	isAvailable: z.boolean(),
});
export type MenuModifierOption = z.infer<typeof MenuModifierOption>;

export const MenuModifierGroup = z.object({
	id: Id,
	name: LocalizedText,
	minSelect: z.int().min(0),
	maxSelect: z.int().min(1),
	options: z.array(MenuModifierOption),
});
export type MenuModifierGroup = z.infer<typeof MenuModifierGroup>;

export const MenuProduct = z.object({
	id: Id,
	categoryId: Id,
	name: LocalizedText,
	description: LocalizedText.nullable(),
	price: NonNegMinor,
	taxBps: Bps.nullable(),
	imageUrl: z.string().nullable(),
	isAvailable: z.boolean(),
	sortOrder: z.int(),
	modifierGroupIds: z.array(Id),
});
export type MenuProduct = z.infer<typeof MenuProduct>;

export const MenuPromotion = z.object({
	id: Id,
	name: z.string(),
	kind: z.enum(["percent", "fixed"]),
	value: z.int().min(1),
	productId: Id.nullable(),
	categoryId: Id.nullable(),
	startsAt: Instant.nullable(),
	endsAt: Instant.nullable(),
	dailyStart: z.string().nullable(),
	dailyEnd: z.string().nullable(),
	daysOfWeek: z.array(z.int().min(0).max(6)).nullable(),
	priority: z.int(),
});

export const MenuSnapshot = z.object({
	location: LocationPricing,
	menuVersion: z.string(),
	generatedAt: Instant,
	categories: z.array(MenuCategory),
	products: z.array(MenuProduct),
	modifierGroups: z.array(MenuModifierGroup),
	promotions: z.array(MenuPromotion),
});
export type MenuSnapshot = z.infer<typeof MenuSnapshot>;

export const OrderLineInput = z.object({
	id: Id,
	productId: Id,
	quantity: z.int().min(1).max(999),
	modifierOptionIds: z.array(Id).max(50).default([]),
	note: z.string().max(500).optional(),
});
export type OrderLineInput = z.input<typeof OrderLineInput>;

export const CreateGuestOrderRequest = z.object({
	locationSlug: z.string().min(1),
	type: OrderType,
	customerName: z.string().max(80).optional(),
	customerPhone: z.string().max(20).optional(),
	note: z.string().max(500).optional(),
	lines: z.array(OrderLineInput).min(1).max(100),
});
export type CreateGuestOrderRequest = z.input<typeof CreateGuestOrderRequest>;

const OrderLine = z.object({
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

export const GuestOrderView = z.object({
	ticketNumber: z.string(),
	type: OrderType,
	paymentStatus: PaymentStatus,
	fulfillmentStatus: FulfillmentStatus,
	subtotal: NonNegMinor,
	discountTotal: NonNegMinor,
	taxTotal: NonNegMinor,
	total: NonNegMinor,
	placedAt: Instant,
	readyAt: Instant.nullable(),
	lines: z.array(OrderLine),
	trackingToken: Id,
});
export type GuestOrderView = z.infer<typeof GuestOrderView>;

export const CreateGuestOrderResponse = z.object({ order: GuestOrderView });

export const ErrorCode = z.enum([
	"bad_request",
	"unauthenticated",
	"forbidden",
	"not_found",
	"conflict",
	"idempotency_mismatch",
	"unprocessable",
	"rate_limited",
	"internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
	error: z.object({
		code: ErrorCode,
		message: z.string(),
		details: z.unknown().optional(),
	}),
});

// ---- mirrored from packages/contracts/src/public.ts (PR #2) ---------------

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export const GuestLocation = z.object({
	slug: z.string(),
	name: z.string(),
	orgName: z.string(),
	/** False when closed, paused by staff, or no open shift. */
	isAcceptingOrders: z.boolean(),
	theme: z.object({
		accent: z.string().optional(),
		logoUrl: z.string().optional(),
	}),
});
export type GuestLocation = z.infer<typeof GuestLocation>;

/** GET /v1/public/locations/:slug/menu */
export const PublicMenuResponse = z.object({
	location: GuestLocation,
	menu: MenuSnapshot,
});
export type PublicMenuResponse = z.infer<typeof PublicMenuResponse>;

export const GuestOrderRejectReason = z.enum([
	"not_accepting_orders",
	"items_unavailable",
	"invalid_modifiers",
	"total_too_high",
	"cart_not_open",
	"cart_empty",
]);
export type GuestOrderRejectReason = z.infer<typeof GuestOrderRejectReason>;

/** error.details on a 422 for guest orders and cart submits. */
export const GuestOrderRejectDetails = z.object({
	reason: GuestOrderRejectReason,
	lineIds: z.array(Id).optional(),
});
export type GuestOrderRejectDetails = z.infer<typeof GuestOrderRejectDetails>;
