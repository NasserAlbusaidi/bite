import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import {
	appendOnlyPolicies,
	createdAt,
	id,
	orgId,
	tenantPolicy,
	updatedAt,
} from "./_shared.js";
import { orgs } from "./tenancy.js";

export type LoyaltyRewardJson = {
	id: string;
	name: { en: string; ar?: string | undefined };
	points: number;
	/** baisa off the bill */
	value: number;
};

/** Loyalty customers are shared across every location in the org. */
export const customers = pgTable(
	"customers",
	{
		id: id(),
		orgId: orgId().references(() => orgs.id, { onDelete: "restrict" }),
		/** E.164, e.g. +96891234567. */
		phone: text("phone").notNull(),
		name: text("name"),
		points: integer("points").notNull().default(0),
		visitCount: integer("visit_count").notNull().default(0),
		lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
		favoriteProductIds: uuid("favorite_product_ids").array(),
		marketingOptIn: jsonb("marketing_opt_in").$type<{
			whatsapp?: boolean;
		}>(),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		unique().on(t.orgId, t.phone),
		check("customers_phone_e164", sql`${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
		check("customers_points_nonneg", sql`${t.points} >= 0`),
		tenantPolicy(),
	],
);

/** One loyalty program per org: how points are earned and what they buy. */
export const loyaltyPrograms = pgTable(
	"loyalty_programs",
	{
		orgId: orgId()
			.primaryKey()
			.references(() => orgs.id, { onDelete: "restrict" }),
		enabled: boolean("enabled").notNull().default(false),
		pointsPerRial: integer("points_per_rial").notNull().default(10),
		rewards: jsonb("rewards")
			.$type<LoyaltyRewardJson[]>()
			.notNull()
			.default([]),
		updatedAt: updatedAt(),
	},
	() => [
		check(
			"loyalty_points_per_rial_range",
			sql`points_per_rial between 0 and 1000`,
		),
		tenantPolicy(),
	],
);

/**
 * Append-only points ledger. customers.points is the running balance and is
 * updated in the same transaction as each row. One earn row per order.
 */
export const loyaltyLedger = pgTable(
	"loyalty_ledger",
	{
		id: id(),
		orgId: orgId(),
		customerId: uuid("customer_id").notNull(),
		orderId: uuid("order_id"),
		/** earn (paid order), redeem (reward used), adjust (back office). */
		kind: text("kind").$type<"earn" | "redeem" | "adjust">().notNull(),
		/** Positive = points in, negative = points out. Never zero. */
		points: integer("points").notNull(),
		rewardId: text("reward_id"),
		reason: text("reason"),
		createdBy: uuid("created_by"),
		createdAt: createdAt(),
	},
	(t) => [
		foreignKey({
			columns: [t.orgId, t.customerId],
			foreignColumns: [customers.orgId, customers.id],
		}).onDelete("restrict"),
		check(
			"loyalty_ledger_kind",
			sql`${t.kind} in ('earn', 'redeem', 'adjust')`,
		),
		check("loyalty_ledger_nonzero", sql`${t.points} <> 0`),
		index("loyalty_ledger_customer_idx").on(t.orgId, t.customerId, t.createdAt),
		uniqueIndex("loyalty_ledger_earn_once")
			.on(t.orgId, t.orderId)
			.where(sql`${t.kind} = 'earn'`),
		...appendOnlyPolicies(),
	],
);

/**
 * A guest's phone, remembered. The guest menu keeps the secret; the server
 * keeps its sha256. Lets a returning guest see their points and past orders
 * without an OTP: only a device that placed an order with that number gets one.
 */
export const customerDevices = pgTable(
	"customer_devices",
	{
		id: id(),
		orgId: orgId(),
		customerId: uuid("customer_id").notNull(),
		tokenHash: text("token_hash").notNull(),
		createdAt: createdAt(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
	},
	(t) => [
		foreignKey({
			columns: [t.orgId, t.customerId],
			foreignColumns: [customers.orgId, customers.id],
		}).onDelete("cascade"),
		uniqueIndex("customer_devices_token_uq").on(t.orgId, t.tokenHash),
		tenantPolicy(),
	],
);
