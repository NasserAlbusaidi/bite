import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	customType,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import {
	createdAt,
	id,
	money,
	orgId,
	tenantPolicy,
	updatedAt,
} from "./_shared.js";
import { customers } from "./customers.js";
import type { LocalizedText } from "./menu.js";
import { products } from "./menu.js";
import { devices, locations, members } from "./tenancy.js";

export const orderSource = pgEnum("order_source", [
	"guest", // QR menu
	"counter", // staff on the POS
	"group", // group cart submitted from the QR menu
	"kiosk",
]);

export const orderType = pgEnum("order_type", ["dine_in", "takeaway"]);

export const paymentStatus = pgEnum("payment_status", [
	"unpaid",
	"partially_paid",
	"paid",
	"partially_refunded",
	"refunded",
]);

export const fulfillmentStatus = pgEnum("fulfillment_status", [
	"pending", // placed, not yet accepted by the kitchen
	"preparing",
	"ready",
	"completed",
	"cancelled",
]);

/**
 * Postgres xid8: the id of the transaction that last wrote the row. Set by a
 * trigger (migration 0006). Sync pull uses it as a gap-free change cursor:
 * unlike a sequence or timestamp, a transaction that commits late still has
 * an xid >= the snapshot xmin the puller saved, so it can't be skipped.
 * Read as a decimal string (it can exceed 2^53).
 */
const xid8 = customType<{ data: string; driverData: string }>({
	dataType: () => "xid8",
});

/**
 * One order, many payments (splits are payments, not child orders).
 * Totals are denormalized from lines by @bite/core and stored for reporting.
 * The id is generated on the device so offline orders sync idempotently.
 */
export const orders = pgTable(
	"orders",
	{
		id: id(),
		orgId: orgId(),
		locationId: uuid("location_id").notNull(),
		/** Device that created it. Null for guest/QR orders. */
		deviceId: uuid("device_id"),
		/** Human ticket number, offline-safe: "<device prefix>-<seq>" or "Q-<seq>" for QR. */
		ticketNumber: text("ticket_number").notNull(),
		/** Local business day (location timezone + day cutoff). */
		businessDate: date("business_date").notNull(),
		source: orderSource("source").notNull(),
		type: orderType("type").notNull().default("dine_in"),
		paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
		fulfillmentStatus: fulfillmentStatus("fulfillment_status")
			.notNull()
			.default("pending"),
		customerId: uuid("customer_id"),
		customerName: text("customer_name"),
		customerPhone: text("customer_phone"),
		note: text("note"),
		/** Snapshot of the location's tax mode when the order was priced. */
		pricesIncludeTax: boolean("prices_include_tax").notNull(),
		subtotal: money("subtotal").notNull(),
		discountTotal: money("discount_total").notNull().default(0),
		taxTotal: money("tax_total").notNull(),
		total: money("total").notNull(),
		/** Sum of succeeded payments minus refunds. Maintained with payments. */
		paidTotal: money("paid_total").notNull().default(0),
		/** Public guest tracking link. */
		trackingToken: uuid("tracking_token")
			.notNull()
			.unique()
			.default(sql`gen_random_uuid()`),
		idempotencyKey: text("idempotency_key"),
		idempotencyFingerprint: text("idempotency_fingerprint"),
		createdBy: uuid("created_by"),
		/** Unpaid guest orders auto-cancel after this. */
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		placedAt: timestamp("placed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		readyAt: timestamp("ready_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		cancelReason: text("cancel_reason"),
		/** Bumped on every write; the sync protocol uses it for conflict checks. */
		version: integer("version").notNull().default(1),
		changeXid: xid8("change_xid").notNull().default(sql`pg_current_xact_id()`),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		unique("orders_ticket_uq").on(t.locationId, t.businessDate, t.ticketNumber),
		unique("orders_idempotency_uq").on(t.orgId, t.idempotencyKey),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.deviceId],
			foreignColumns: [devices.orgId, devices.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.customerId],
			foreignColumns: [customers.orgId, customers.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.createdBy],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("restrict"),
		index("orders_location_day_idx").on(t.locationId, t.businessDate),
		index("orders_kitchen_idx")
			.on(t.locationId, t.fulfillmentStatus)
			.where(sql`${t.fulfillmentStatus} in ('pending', 'preparing', 'ready')`),
		index("orders_expiry_idx")
			.on(t.expiresAt)
			.where(sql`${t.paymentStatus} = 'unpaid' and ${t.expiresAt} is not null`),
		index("orders_customer_idx").on(t.orgId, t.customerId),
		index("orders_location_change_idx").on(t.locationId, t.changeXid, t.id),
		check(
			"orders_totals_nonneg",
			sql`${t.subtotal} >= 0 and ${t.discountTotal} >= 0 and ${t.taxTotal} >= 0 and ${t.total} >= 0`,
		),
		tenantPolicy(),
	],
);

/**
 * Server-allocated ticket sequences (guest/QR "Q-<n>", kiosk), per location
 * per business day. Tablets number their own tickets offline with their
 * device prefix and never touch this.
 */
export const ticketCounters = pgTable(
	"ticket_counters",
	{
		orgId: orgId(),
		locationId: uuid("location_id").notNull(),
		businessDate: date("business_date").notNull(),
		prefix: text("prefix").notNull(),
		lastSeq: integer("last_seq").notNull().default(0),
	},
	(t) => [
		primaryKey({ columns: [t.locationId, t.businessDate, t.prefix] }),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("cascade"),
		tenantPolicy(),
	],
);

/** Snapshot of a chosen modifier at the moment the line was priced. */
export type LineModifier = {
	groupId: string;
	optionId: string;
	name: LocalizedText;
	priceDelta: number;
};

export const orderLines = pgTable(
	"order_lines",
	{
		id: id(),
		orgId: orgId(),
		orderId: uuid("order_id").notNull(),
		/** Products are archived, never deleted, so this stays valid. Null for open/custom items. */
		productId: uuid("product_id"),
		name: jsonb("name").$type<LocalizedText>().notNull(),
		quantity: integer("quantity").notNull(),
		/** Unit price after promotion, before modifiers. */
		unitPrice: money("unit_price").notNull(),
		/** Unit price before promotion, for receipts and discount reporting. */
		listUnitPrice: money("list_unit_price").notNull(),
		promotionId: uuid("promotion_id"),
		modifiers: jsonb("modifiers").$type<LineModifier[]>().notNull().default([]),
		taxBps: integer("tax_bps").notNull(),
		/** (unitPrice + modifier deltas) * quantity. Gross or net per order tax mode. */
		lineTotal: money("line_total").notNull(),
		lineDiscount: money("line_discount").notNull().default(0),
		lineTax: money("line_tax").notNull(),
		note: text("note"),
		/** KDS station routing, later. */
		station: text("station"),
		sortOrder: smallint("sort_order").notNull().default(0),
		voidedAt: timestamp("voided_at", { withTimezone: true }),
		voidedBy: uuid("voided_by"),
		voidReason: text("void_reason"),
		createdAt: createdAt(),
	},
	(t) => [
		foreignKey({
			columns: [t.orgId, t.orderId],
			foreignColumns: [orders.orgId, orders.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.productId],
			foreignColumns: [products.orgId, products.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.voidedBy],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("restrict"),
		index("order_lines_order_idx").on(t.orderId),
		index("order_lines_product_idx").on(t.productId),
		check("order_lines_qty_pos", sql`${t.quantity} > 0`),
		check(
			"order_lines_amounts_nonneg",
			sql`${t.unitPrice} >= 0 and ${t.lineTotal} >= 0 and ${t.lineTax} >= 0 and ${t.lineDiscount} >= 0`,
		),
		tenantPolicy(),
	],
);

export const orderFeedback = pgTable(
	"order_feedback",
	{
		orderId: uuid("order_id").primaryKey(),
		orgId: orgId(),
		rating: smallint("rating").notNull(),
		comment: text("comment"),
		createdAt: createdAt(),
	},
	(t) => [
		foreignKey({
			columns: [t.orgId, t.orderId],
			foreignColumns: [orders.orgId, orders.id],
		}).onDelete("cascade"),
		check("order_feedback_rating", sql`${t.rating} between 1 and 5`),
		tenantPolicy(),
	],
);
