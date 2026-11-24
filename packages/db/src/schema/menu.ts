import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	smallint,
	text,
	time,
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
import { locations, orgs } from "./tenancy.js";

/** Localized text. `en` is required, other languages optional. */
export type LocalizedText = { en: string; ar?: string };
const localized = (name: string) => jsonb(name).$type<LocalizedText>();

/** The menu belongs to the org. Locations override price/availability. */
export const categories = pgTable(
	"categories",
	{
		id: id(),
		orgId: orgId().references(() => orgs.id, { onDelete: "restrict" }),
		parentId: uuid("parent_id"),
		name: localized("name").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		isActive: boolean("is_active").notNull().default(true),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		foreignKey({
			columns: [t.orgId, t.parentId],
			foreignColumns: [t.orgId, t.id],
		}).onDelete("restrict"),
		tenantPolicy(),
	],
);

export const products = pgTable(
	"products",
	{
		id: id(),
		orgId: orgId(),
		categoryId: uuid("category_id").notNull(),
		name: localized("name").notNull(),
		description: localized("description"),
		/** Base price in minor units; gross or net per the location's tax mode. */
		price: money("price").notNull(),
		/** Overrides the location's tax rate when set. Basis points. */
		taxBps: integer("tax_bps"),
		imageUrl: text("image_url"),
		/** Dietary tags shown to guests and used for menu filters. See DIETARY_TAGS in @bite/contracts. */
		dietaryTags: text("dietary_tags")
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		isVisible: boolean("is_visible").notNull().default(true),
		sortOrder: integer("sort_order").notNull().default(0),
		/** Soft delete: order lines keep pointing at archived products. */
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		foreignKey({
			columns: [t.orgId, t.categoryId],
			foreignColumns: [categories.orgId, categories.id],
		}).onDelete("restrict"),
		check("products_price_nonneg", sql`${t.price} >= 0`),
		tenantPolicy(),
	],
);

/** Per-location price override and 86'd flag. No row = use product defaults. */
export const productLocationSettings = pgTable(
	"product_location_settings",
	{
		orgId: orgId(),
		productId: uuid("product_id").notNull(),
		locationId: uuid("location_id").notNull(),
		price: money("price"),
		isAvailable: boolean("is_available").notNull().default(true),
		updatedAt: updatedAt(),
	},
	(t) => [
		primaryKey({ columns: [t.productId, t.locationId] }),
		foreignKey({
			columns: [t.orgId, t.productId],
			foreignColumns: [products.orgId, products.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("cascade"),
		check("pls_price_nonneg", sql`${t.price} is null or ${t.price} >= 0`),
		tenantPolicy(),
	],
);

export const modifierGroups = pgTable(
	"modifier_groups",
	{
		id: id(),
		orgId: orgId().references(() => orgs.id, { onDelete: "restrict" }),
		name: localized("name").notNull(),
		minSelect: smallint("min_select").notNull().default(0),
		maxSelect: smallint("max_select").notNull().default(1),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		check(
			"modifier_groups_select_range",
			sql`${t.minSelect} >= 0 and ${t.maxSelect} >= ${t.minSelect} and ${t.maxSelect} >= 1`,
		),
		tenantPolicy(),
	],
);

export const modifierOptions = pgTable(
	"modifier_options",
	{
		id: id(),
		orgId: orgId(),
		groupId: uuid("group_id").notNull(),
		name: localized("name").notNull(),
		/** Added to the line's unit price. May be negative (e.g. "no cheese"). */
		priceDelta: money("price_delta").notNull().default(0),
		sortOrder: integer("sort_order").notNull().default(0),
		isAvailable: boolean("is_available").notNull().default(true),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		foreignKey({
			columns: [t.orgId, t.groupId],
			foreignColumns: [modifierGroups.orgId, modifierGroups.id],
		}).onDelete("cascade"),
		tenantPolicy(),
	],
);

export const productModifierGroups = pgTable(
	"product_modifier_groups",
	{
		orgId: orgId(),
		productId: uuid("product_id").notNull(),
		groupId: uuid("group_id").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(t) => [
		primaryKey({ columns: [t.productId, t.groupId] }),
		foreignKey({
			columns: [t.orgId, t.productId],
			foreignColumns: [products.orgId, products.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.groupId],
			foreignColumns: [modifierGroups.orgId, modifierGroups.id],
		}).onDelete("cascade"),
		tenantPolicy(),
	],
);

export const promotionKind = pgEnum("promotion_kind", ["percent", "fixed"]);

/**
 * Replaces both product-level discounts and legacy pricing_rules.
 * Target: productId, else categoryId, else the whole menu.
 * Window: optional date range, optional daily time window, optional weekdays.
 */
export const promotions = pgTable(
	"promotions",
	{
		id: id(),
		orgId: orgId().references(() => orgs.id, { onDelete: "restrict" }),
		/** Null = every location in the org. */
		locationId: uuid("location_id"),
		name: text("name").notNull(),
		kind: promotionKind("kind").notNull(),
		/** Basis points when kind=percent, minor units off the unit price when kind=fixed. */
		value: integer("value").notNull(),
		productId: uuid("product_id"),
		categoryId: uuid("category_id"),
		startsAt: timestamp("starts_at", { withTimezone: true }),
		endsAt: timestamp("ends_at", { withTimezone: true }),
		/** Local wall-clock window in the location's timezone. May wrap midnight. */
		dailyStart: time("daily_start"),
		dailyEnd: time("daily_end"),
		/** 0 = Sunday .. 6 = Saturday. Null = every day. */
		daysOfWeek: smallint("days_of_week").array(),
		/** Higher wins when several promotions match one line. */
		priority: integer("priority").notNull().default(0),
		isActive: boolean("is_active").notNull().default(true),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.productId],
			foreignColumns: [products.orgId, products.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.categoryId],
			foreignColumns: [categories.orgId, categories.id],
		}).onDelete("cascade"),
		check("promotions_value_pos", sql`${t.value} > 0`),
		check(
			"promotions_percent_max",
			sql`${t.kind} <> 'percent' or ${t.value} <= 10000`,
		),
		check(
			"promotions_single_target",
			sql`${t.productId} is null or ${t.categoryId} is null`,
		),
		check(
			"promotions_daily_window",
			sql`(${t.dailyStart} is null) = (${t.dailyEnd} is null)`,
		),
		tenantPolicy(),
	],
);
