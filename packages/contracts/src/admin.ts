import { z } from "zod";
import { Entitlements } from "./billing.js";
import {
	Bps,
	BusinessDate,
	Cursor,
	DeviceKind,
	FulfillmentStatus,
	Id,
	Instant,
	LocalizedText,
	LocationRole,
	Minor,
	NonNegMinor,
	OrderSource,
	OrgRole,
	PaymentMethod,
	PaymentStatus,
} from "./common.js";

/**
 * Back office, under /v1/admin. Auth: Better Auth session cookie (sign-in
 * under /v1/auth/*). Owners/admins manage the whole org; managers only the
 * locations they manage; cashier/server/kitchen get 403.
 *
 * Conventions: lists return { items, nextCursor? }. PATCH bodies are partial.
 * Archive, never delete, anything orders point at.
 */
export const Page = <T extends z.ZodType>(item: T) =>
	z.object({ items: z.array(item), nextCursor: Cursor.optional() });

// ---------------------------------------------------------------- session

export const AdminLocation = z.object({
	id: Id,
	name: z.string(),
	slug: z.string(),
	isActive: z.boolean(),
});

/** GET /me */
export const AdminMe = z.object({
	member: z.object({
		id: Id,
		displayName: z.string(),
		email: z.email(),
		orgRole: OrgRole,
	}),
	org: z.object({ id: Id, name: z.string(), slug: z.string() }),
	/** Locations this member can manage, with their role there. Owners/admins: all, role manager. */
	locations: z.array(z.object({ location: AdminLocation, role: LocationRole })),
	/** The org's plan: which features are on and what its limits are. */
	entitlements: Entitlements,
	/** A Bite operator's read-only support view of this org (not a member). */
	support: z.boolean().optional(),
});

// ---------------------------------------------------------------- menu (org-level)

/** GET/POST /categories, PATCH /categories/:id, POST /categories/:id/archive */
export const AdminCategory = z.object({
	id: Id,
	parentId: Id.nullable(),
	name: LocalizedText,
	sortOrder: z.int(),
	isActive: z.boolean(),
});
export const CreateCategory = AdminCategory.omit({ id: true }).partial({
	parentId: true,
	sortOrder: true,
	isActive: true,
});
export const UpdateCategory = CreateCategory.partial();

/** GET/POST /products, PATCH /products/:id, POST /products/:id/archive */
export const AdminProduct = z.object({
	id: Id,
	categoryId: Id,
	name: LocalizedText,
	description: LocalizedText.nullable(),
	/** Base price. Gross or net per each location's prices_include_tax. */
	price: NonNegMinor,
	/** Null = location default rate. 0 is a real override. */
	taxBps: Bps.nullable(),
	imageUrl: z.url().nullable(),
	isVisible: z.boolean(),
	sortOrder: z.int(),
	modifierGroupIds: z.array(Id),
	archivedAt: Instant.nullable(),
});
export const CreateProduct = AdminProduct.omit({
	id: true,
	archivedAt: true,
}).partial({
	description: true,
	taxBps: true,
	imageUrl: true,
	isVisible: true,
	sortOrder: true,
	modifierGroupIds: true,
});
export const UpdateProduct = CreateProduct.partial();

/** PATCH /categories/order and /products/order */
export const Reorder = z
	.array(z.object({ id: Id, sortOrder: z.int() }))
	.min(1)
	.max(500);

/** GET/POST /modifier-groups, PATCH /modifier-groups/:id */
export const AdminModifierOption = z.object({
	id: Id,
	name: LocalizedText,
	/** May be negative ("no cheese"). */
	priceDelta: Minor,
	sortOrder: z.int(),
	isAvailable: z.boolean(),
});
export const AdminModifierGroup = z.object({
	id: Id,
	name: LocalizedText,
	minSelect: z.int().min(0),
	maxSelect: z.int().min(1),
	options: z.array(AdminModifierOption),
});
export const CreateModifierGroup = z
	.object({
		name: LocalizedText,
		minSelect: z.int().min(0).default(0),
		maxSelect: z.int().min(1).default(1),
	})
	.refine((g) => g.maxSelect >= g.minSelect, {
		message: "maxSelect < minSelect",
		path: ["maxSelect"],
	});
export const UpdateModifierGroup = z.object({
	name: LocalizedText.optional(),
	minSelect: z.int().min(0).optional(),
	maxSelect: z.int().min(1).optional(),
});
/** POST /modifier-groups/:id/options, PATCH /modifier-groups/:id/options/:optionId */
export const CreateModifierOption = AdminModifierOption.omit({
	id: true,
}).partial({
	priceDelta: true,
	sortOrder: true,
	isAvailable: true,
});
export const UpdateModifierOption = CreateModifierOption.partial();

// ---------------------------------------------------------------- per-location overrides

/** GET /locations/:locationId/products */
export const LocationProduct = z.object({
	productId: Id,
	name: LocalizedText,
	categoryId: Id,
	basePrice: NonNegMinor,
	/** Null = uses basePrice. */
	overridePrice: NonNegMinor.nullable(),
	effectivePrice: NonNegMinor,
	isAvailable: z.boolean(),
});
/** PUT /locations/:locationId/products/:productId */
export const SetLocationProduct = z.object({
	price: NonNegMinor.nullable(),
	isAvailable: z.boolean(),
});

// ---------------------------------------------------------------- promotions

/** GET/POST /promotions, PATCH /promotions/:id. Deactivate with isActive=false. */
export const AdminPromotion = z.object({
	id: Id,
	/** Null = every location of the org. */
	locationId: Id.nullable(),
	name: z.string().min(1).max(120),
	kind: z.enum(["percent", "fixed"]),
	/** Bps when percent (1..10000), minor units off the unit price when fixed. */
	value: z.int().min(1),
	productId: Id.nullable(),
	categoryId: Id.nullable(),
	startsAt: Instant.nullable(),
	endsAt: Instant.nullable(),
	/** Local "HH:MM". May wrap midnight. Both or neither. */
	dailyStart: z
		.string()
		.regex(/^\d{2}:\d{2}(:\d{2})?$/)
		.nullable(),
	dailyEnd: z
		.string()
		.regex(/^\d{2}:\d{2}(:\d{2})?$/)
		.nullable(),
	/** 0 = Sunday. Null = every day. */
	daysOfWeek: z.array(z.int().min(0).max(6)).nullable(),
	priority: z.int(),
	isActive: z.boolean(),
});
type PromoShape = {
	[K in keyof z.infer<typeof AdminPromotion>]?:
		| z.infer<typeof AdminPromotion>[K]
		| undefined;
};
const promoRules = <T extends z.ZodType<PromoShape>>(s: T) =>
	s
		.refine((p) => !(p.productId && p.categoryId), {
			message: "target a product or a category, not both",
		})
		.refine(
			(p) => p.kind !== "percent" || p.value === undefined || p.value <= 10_000,
			{
				message: "percent is at most 10000 bps",
				path: ["value"],
			},
		)
		.refine((p) => (p.dailyStart == null) === (p.dailyEnd == null), {
			message: "dailyStart and dailyEnd go together",
		});
export const CreatePromotion = promoRules(
	AdminPromotion.omit({ id: true }).partial({
		locationId: true,
		productId: true,
		categoryId: true,
		startsAt: true,
		endsAt: true,
		dailyStart: true,
		dailyEnd: true,
		daysOfWeek: true,
		priority: true,
		isActive: true,
	}),
);
export const UpdatePromotion = promoRules(
	AdminPromotion.omit({ id: true }).partial(),
);

// ---------------------------------------------------------------- staff

export const StaffLocationRole = z.object({
	locationId: Id,
	role: LocationRole,
});

/** GET /staff */
export const AdminStaff = z.object({
	id: Id,
	displayName: z.string(),
	/** Present for members with a back-office login. */
	email: z.email().nullable(),
	orgRole: OrgRole,
	hasPin: z.boolean(),
	isActive: z.boolean(),
	locations: z.array(StaffLocationRole),
});

/** POST /staff/invite: owners/admins/managers get an emailed sign-up link. */
export const InviteStaff = z.object({
	email: z.email(),
	displayName: z.string().min(1).max(80),
	orgRole: OrgRole.exclude(["owner"]),
	locations: z.array(StaffLocationRole).default([]),
});

/**
 * POST /staff/invite response. No email provider yet: the back office shows
 * or shares the link itself. The token is returned exactly once.
 */
export const InviteStaffResponse = z.object({
	staff: AdminStaff,
	inviteToken: z.string(),
	expiresAt: Instant,
});

/** POST /staff: PIN-only floor staff, no login. */
export const CreatePinStaff = z.object({
	displayName: z.string().min(1).max(80),
	pin: z.string().regex(/^\d{4,8}$/),
	locations: z.array(StaffLocationRole).min(1),
});

/** PATCH /staff/:id */
export const UpdateStaff = z.object({
	displayName: z.string().min(1).max(80).optional(),
	orgRole: OrgRole.exclude(["owner"]).optional(),
	/** Replaces the whole set. */
	locations: z.array(StaffLocationRole).optional(),
});

/** POST /staff/:id/reset-pin. POST /staff/:id/deactivate takes no body. */
export const ResetPin = z.object({ pin: z.string().regex(/^\d{4,8}$/) });

// ---------------------------------------------------------------- locations + devices

/** GET /locations, PATCH /locations/:id */
export const AdminLocationSettings = AdminLocation.extend({
	timezone: z.string(),
	currencyCode: z.string().length(3),
	pricesIncludeTax: z.boolean(),
	taxBps: Bps,
	vatNumber: z.string().nullable(),
	dayCutoffMinutes: z.int().min(0).max(1439),
	address: z.string().nullable(),
	phone: z.string().nullable(),
	whatsappNumber: z.string().nullable(),
	businessHours: z
		.record(
			z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
			z.array(
				z.object({
					open: z.string().regex(/^\d{2}:\d{2}$/),
					close: z.string().regex(/^\d{2}:\d{2}$/),
				}),
			),
		)
		.nullable(),
	theme: z
		.object({ accent: z.string().optional(), logoUrl: z.url().optional() })
		.catchall(z.unknown()),
	receiptHeader: z.string().nullable(),
	/** Guest ordering paused until this instant (null = not paused). */
	ordersPausedUntil: Instant.nullable(),
});
export const UpdateLocation = AdminLocationSettings.omit({
	id: true,
	slug: true,
	currencyCode: true,
}).partial();

/** GET /locations/:id/devices. Register via RegisterDeviceRequest (auth.ts). POST /devices/:id/revoke. */
export const AdminDevice = z.object({
	id: Id,
	locationId: Id,
	name: z.string(),
	kind: DeviceKind,
	ticketPrefix: z.string(),
	lastSeenAt: Instant.nullable(),
	revokedAt: Instant.nullable(),
});

// ---------------------------------------------------------------- reports

/** GET /reports/sales?locationId&from&to (business dates, inclusive) */
export const SalesReportQuery = z.object({
	locationId: Id,
	from: BusinessDate,
	to: BusinessDate,
});
export const SalesReport = z.object({
	locationId: Id,
	from: BusinessDate,
	to: BusinessDate,
	/** Non-cancelled orders. */
	orderCount: z.int(),
	/** Before promotions: Σ list price x qty (incl. modifiers). */
	gross: Minor,
	discounts: Minor,
	tax: Minor,
	/** What customers were charged: Σ order totals. */
	total: Minor,
	/** total - tax. */
	net: Minor,
	/** Money actually taken, from the payments ledger (refunds netted). */
	byMethod: z.array(
		z.object({ method: PaymentMethod, amount: Minor, count: z.int() }),
	),
	tips: Minor,
	/**
	 * Money given back in the range, by the refund's own business date
	 * (positive). Already netted out of byMethod. NOT taken out of total/net:
	 * a refunded order that was never cancelled still counts as a sale there.
	 */
	refunds: Minor,
	refundCount: z.int(),
	topProducts: z.array(
		z.object({
			productId: Id.nullable(),
			name: LocalizedText,
			quantity: z.int(),
			revenue: Minor,
		}),
	),
});

/** GET /orders (Page<AdminOrderRow>) and GET /orders.csv, same filters. */
export const AdminOrdersQuery = z.object({
	locationId: Id,
	from: BusinessDate,
	to: BusinessDate,
	paymentStatus: PaymentStatus.optional(),
	fulfillmentStatus: FulfillmentStatus.optional(),
	/** Ticket number, customer name or phone, or table: contains, any case. */
	search: z.string().trim().min(1).max(40).optional(),
	cursor: Cursor.optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const AdminOrderRow = z.object({
	id: Id,
	ticketNumber: z.string(),
	businessDate: BusinessDate,
	placedAt: Instant,
	source: z.string(),
	type: z.string(),
	paymentStatus: PaymentStatus,
	fulfillmentStatus: FulfillmentStatus,
	total: Minor,
	paidTotal: Minor,
	customerName: z.string().nullable(),
	tableLabel: z.string().nullable().optional(),
});

/**
 * GET /reports/trends?locationId&from&to: the shapes behind the charts.
 * Same rules as the sales report: non-cancelled orders, by business date.
 */
export const TrendsReport = z.object({
	locationId: Id,
	from: BusinessDate,
	to: BusinessDate,
	/** Every business date in the range, zero-filled, oldest first. */
	days: z.array(
		z.object({ date: BusinessDate, orders: z.int(), net: Minor, total: Minor }),
	),
	/**
	 * Orders by local weekday and hour of placedAt, in the location's time
	 * zone. weekday 0 = Monday ... 6 = Sunday. Only non-empty cells.
	 */
	heat: z.array(
		z.object({
			weekday: z.int().min(0).max(6),
			hour: z.int().min(0).max(23),
			orders: z.int(),
			net: Minor,
		}),
	),
	bySource: z.array(
		z.object({ source: OrderSource, orders: z.int(), net: Minor }),
	),
	byType: z.array(z.object({ type: z.string(), orders: z.int(), net: Minor })),
	/** Line revenue (after promotions, incl. tax per the location's mode). */
	byCategory: z.array(
		z.object({
			categoryId: Id.nullable(),
			name: LocalizedText,
			quantity: z.int(),
			revenue: Minor,
		}),
	),
	/** Minutes from placed to ready, orders that reached ready. */
	prep: z.object({
		count: z.int(),
		medianMinutes: z.number().nullable(),
		p90Minutes: z.number().nullable(),
	}),
});

/** GET /orders/:id: one order with its lines and payments. */
export const AdminOrderDetail = AdminOrderRow.extend({
	locationId: Id,
	subtotal: Minor,
	discountTotal: Minor,
	taxTotal: Minor,
	pricesIncludeTax: z.boolean(),
	note: z.string().nullable(),
	customerPhone: z.string().nullable(),
	readyAt: Instant.nullable(),
	completedAt: Instant.nullable(),
	cancelledAt: Instant.nullable(),
	cancelReason: z.string().nullable(),
	deviceName: z.string().nullable(),
	createdByName: z.string().nullable(),
	lines: z.array(
		z.object({
			id: Id,
			name: LocalizedText,
			quantity: z.int(),
			unitPrice: Minor,
			listUnitPrice: Minor,
			modifiers: z.array(
				z.object({ name: LocalizedText, priceDelta: Minor }).loose(),
			),
			lineTotal: Minor,
			lineDiscount: Minor,
			lineTax: Minor,
			note: z.string().nullable(),
			voidedAt: Instant.nullable(),
			voidReason: z.string().nullable(),
		}),
	),
	payments: z.array(
		z.object({
			id: Id,
			method: PaymentMethod,
			state: z.string(),
			amount: Minor,
			tip: Minor,
			tendered: Minor.nullable(),
			reason: z.string().nullable(),
			businessDate: BusinessDate,
			createdAt: Instant,
			createdByName: z.string().nullable(),
		}),
	),
});

/** GET /cash-sessions?locationId&from&to: drawers by business date (Z report). */
export const CashSessionsQuery = SalesReportQuery;
export const AdminCashSession = z.object({
	id: Id,
	businessDate: BusinessDate,
	deviceName: z.string(),
	status: z.enum(["open", "closed"]),
	openedAt: Instant,
	openedByName: z.string(),
	closedAt: Instant.nullable(),
	closedByName: z.string().nullable(),
	openingFloat: Minor,
	/** Cash payments incl. tips (refunds netted). */
	cashSales: Minor,
	cashRefunds: Minor,
	payIns: Minor,
	payOuts: Minor,
	drops: Minor,
	/** Stored at close; computed live while the drawer is open. */
	expectedCash: Minor,
	countedCash: Minor.nullable(),
	/** counted - expected; null while open. */
	variance: Minor.nullable(),
	notes: z.string().nullable(),
	movements: z.array(
		z.object({
			kind: z.enum(["pay_in", "pay_out", "drop"]),
			amount: Minor,
			reason: z.string(),
			createdAt: Instant,
			byName: z.string(),
		}),
	),
});

export type AdminMe = z.infer<typeof AdminMe>;
export type AdminCategory = z.infer<typeof AdminCategory>;
export type CreateCategory = z.infer<typeof CreateCategory>;
export type UpdateCategory = z.infer<typeof UpdateCategory>;
export type AdminProduct = z.infer<typeof AdminProduct>;
export type CreateProduct = z.infer<typeof CreateProduct>;
export type UpdateProduct = z.infer<typeof UpdateProduct>;
export type Reorder = z.infer<typeof Reorder>;
export type AdminModifierGroup = z.infer<typeof AdminModifierGroup>;
export type AdminModifierOption = z.infer<typeof AdminModifierOption>;
export type CreateModifierGroup = z.infer<typeof CreateModifierGroup>;
export type UpdateModifierGroup = z.infer<typeof UpdateModifierGroup>;
export type CreateModifierOption = z.infer<typeof CreateModifierOption>;
export type UpdateModifierOption = z.infer<typeof UpdateModifierOption>;
export type LocationProduct = z.infer<typeof LocationProduct>;
export type SetLocationProduct = z.infer<typeof SetLocationProduct>;
export type AdminPromotion = z.infer<typeof AdminPromotion>;
export type CreatePromotion = z.infer<typeof CreatePromotion>;
export type UpdatePromotion = z.infer<typeof UpdatePromotion>;
export type AdminStaff = z.infer<typeof AdminStaff>;
export type InviteStaff = z.infer<typeof InviteStaff>;
export type InviteStaffResponse = z.infer<typeof InviteStaffResponse>;
export type CreatePinStaff = z.infer<typeof CreatePinStaff>;
export type UpdateStaff = z.infer<typeof UpdateStaff>;
export type ResetPin = z.infer<typeof ResetPin>;
export type AdminLocationSettings = z.infer<typeof AdminLocationSettings>;
export type UpdateLocation = z.infer<typeof UpdateLocation>;
export type AdminDevice = z.infer<typeof AdminDevice>;
export type SalesReportQuery = z.infer<typeof SalesReportQuery>;
export type SalesReport = z.infer<typeof SalesReport>;
export type AdminOrdersQuery = z.infer<typeof AdminOrdersQuery>;
export type AdminOrderRow = z.infer<typeof AdminOrderRow>;
export type TrendsReport = z.infer<typeof TrendsReport>;
export type AdminOrderDetail = z.infer<typeof AdminOrderDetail>;
export type CashSessionsQuery = z.infer<typeof CashSessionsQuery>;
export type AdminCashSession = z.infer<typeof AdminCashSession>;
