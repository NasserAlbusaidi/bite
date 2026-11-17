import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, money, orgId, tenantPolicy } from "./_shared.js";
import { cashSessions } from "./cash.js";
import { orders } from "./orders.js";
import { devices, locations, members } from "./tenancy.js";

export const paymentMethod = pgEnum("payment_method", [
	"cash",
	"card", // standalone/integrated terminal
	"softpos",
	"thawani",
	"stripe",
	"other",
]);

export const paymentState = pgEnum("payment_state", [
	"pending", // async providers (Thawani, terminal) waiting for confirmation
	"succeeded",
	"failed",
]);

/**
 * Append-only money ledger. A refund is a NEW negative row pointing at the
 * payment it reverses; payment rows are never edited except the pending →
 * succeeded/failed transition. Split bills = several positive rows.
 */
export const payments = pgTable(
	"payments",
	{
		id: id(),
		orgId: orgId(),
		locationId: uuid("location_id").notNull(),
		orderId: uuid("order_id").notNull(),
		/** Cash payments must belong to an open cash session. */
		cashSessionId: uuid("cash_session_id"),
		/** Positive = money in, negative = refund. Never zero. */
		amount: money("amount").notNull(),
		/** Cash handed over by the customer (change = tendered - amount). Cash only. */
		tendered: money("tendered"),
		tip: money("tip").notNull().default(0),
		method: paymentMethod("method").notNull(),
		state: paymentState("state").notNull().default("succeeded"),
		provider: text("provider"),
		providerReference: text("provider_reference"),
		providerData: jsonb("provider_data").$type<Record<string, unknown>>(),
		reversesPaymentId: uuid("reverses_payment_id"),
		reason: text("reason"),
		createdBy: uuid("created_by"),
		deviceId: uuid("device_id"),
		/** Business day the money is counted on (may differ from the order's). */
		businessDate: date("business_date").notNull(),
		/** When a pending payment succeeded or failed. */
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		foreignKey({
			columns: [t.orgId, t.orderId],
			foreignColumns: [orders.orgId, orders.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.cashSessionId],
			foreignColumns: [cashSessions.orgId, cashSessions.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.reversesPaymentId],
			foreignColumns: [t.orgId, t.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.createdBy],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.deviceId],
			foreignColumns: [devices.orgId, devices.id],
		}).onDelete("restrict"),
		uniqueIndex("payments_provider_ref_uq")
			.on(t.provider, t.providerReference)
			.where(sql`${t.providerReference} is not null`),
		index("payments_order_idx").on(t.orderId),
		index("payments_location_day_idx").on(t.locationId, t.businessDate),
		index("payments_cash_session_idx").on(t.cashSessionId),
		check("payments_amount_nonzero", sql`${t.amount} <> 0`),
		check(
			"payments_refund_shape",
			sql`(${t.amount} < 0) = (${t.reversesPaymentId} is not null)`,
		),
		check(
			"payments_tendered_cash_only",
			sql`${t.tendered} is null or (${t.method} = 'cash' and ${t.tendered} >= ${t.amount})`,
		),
		check(
			"payments_cash_needs_session",
			sql`${t.method} <> 'cash' or ${t.cashSessionId} is not null`,
		),
		check("payments_tip_nonneg", sql`${t.tip} >= 0`),
		tenantPolicy(),
	],
);
