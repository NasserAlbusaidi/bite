import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, tenantPolicy, updatedAt } from "./_shared.js";
import { products } from "./menu.js";
import { orders } from "./orders.js";
import { locations } from "./tenancy.js";

export const groupCartStatus = pgEnum("group_cart_status", [
	"open", // anyone with the link can add/edit their own items
	"locked", // host is checking out; edits rejected
	"submitted", // converted into exactly one order
	"expired",
	"cancelled",
]);

/**
 * Shared QR cart for a table. Replaces the legacy JSON blob: participants
 * and items are real rows, every write bumps `version` (optimistic
 * concurrency), and submission re-prices server-side into one order.
 */
export const groupCarts = pgTable(
	"group_carts",
	{
		id: id(),
		orgId: orgId(),
		locationId: uuid("location_id").notNull(),
		/** Secret in the share link. */
		token: uuid("token").notNull().unique().default(sql`gen_random_uuid()`),
		status: groupCartStatus("status").notNull().default("open"),
		version: integer("version").notNull().default(1),
		orderId: uuid("order_id"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		lockedAt: timestamp("locked_at", { withTimezone: true }),
		submittedAt: timestamp("submitted_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		uniqueIndex("group_carts_order_uq")
			.on(t.orderId)
			.where(sql`${t.orderId} is not null`),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.orderId],
			foreignColumns: [orders.orgId, orders.id],
		}).onDelete("restrict"),
		index("group_carts_expiry_idx")
			.on(t.expiresAt)
			.where(sql`${t.status} in ('open', 'locked')`),
		check(
			"group_carts_submitted_shape",
			sql`(${t.status} = 'submitted') = (${t.orderId} is not null)`,
		),
		tenantPolicy(),
	],
);

export const groupCartParticipants = pgTable(
	"group_cart_participants",
	{
		id: id(),
		orgId: orgId(),
		cartId: uuid("cart_id").notNull(),
		displayName: text("display_name").notNull(),
		isHost: boolean("is_host").notNull().default(false),
		/** Hash of the per-participant secret kept in the guest's browser. */
		secretHash: text("secret_hash").notNull(),
		joinedAt: createdAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		foreignKey({
			columns: [t.orgId, t.cartId],
			foreignColumns: [groupCarts.orgId, groupCarts.id],
		}).onDelete("cascade"),
		uniqueIndex("group_cart_one_host").on(t.cartId).where(sql`${t.isHost}`),
		tenantPolicy(),
	],
);

/** No prices stored: the cart is always re-priced from the live menu. */
export const groupCartItems = pgTable(
	"group_cart_items",
	{
		id: id(),
		orgId: orgId(),
		cartId: uuid("cart_id").notNull(),
		participantId: uuid("participant_id").notNull(),
		productId: uuid("product_id").notNull(),
		quantity: integer("quantity").notNull(),
		modifierOptionIds: uuid("modifier_option_ids")
			.array()
			.notNull()
			.default([]),
		note: text("note"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		foreignKey({
			columns: [t.orgId, t.cartId],
			foreignColumns: [groupCarts.orgId, groupCarts.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.participantId],
			foreignColumns: [groupCartParticipants.orgId, groupCartParticipants.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.productId],
			foreignColumns: [products.orgId, products.id],
		}).onDelete("cascade"),
		index("group_cart_items_cart_idx").on(t.cartId),
		check("group_cart_items_qty", sql`${t.quantity} between 1 and 99`),
		tenantPolicy(),
	],
);
