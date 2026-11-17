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
import { devices, locations, members } from "./tenancy.js";

export const cashSessionStatus = pgEnum("cash_session_status", [
	"open",
	"closed",
]);

/**
 * One cash drawer shift: opened with a float, closed with a count.
 * A drawer is identified by the device it is attached to; one open session
 * per device at a time.
 */
export const cashSessions = pgTable(
	"cash_sessions",
	{
		id: id(),
		orgId: orgId(),
		locationId: uuid("location_id").notNull(),
		deviceId: uuid("device_id").notNull(),
		businessDate: date("business_date").notNull(),
		status: cashSessionStatus("status").notNull().default("open"),
		openedBy: uuid("opened_by").notNull(),
		openedAt: timestamp("opened_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		openingFloat: money("opening_float").notNull(),
		closedBy: uuid("closed_by"),
		closedAt: timestamp("closed_at", { withTimezone: true }),
		/** Computed at close: float + cash payments - cash refunds + pay-ins - pay-outs - drops. */
		expectedCash: money("expected_cash"),
		countedCash: money("counted_cash"),
		/** Denomination breakdown from the count screen. */
		countDetail: jsonb("count_detail").$type<Record<string, number>>(),
		notes: text("notes"),
		createdAt: createdAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.deviceId],
			foreignColumns: [devices.orgId, devices.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.openedBy],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.closedBy],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("restrict"),
		uniqueIndex("cash_sessions_one_open_per_device")
			.on(t.deviceId)
			.where(sql`${t.status} = 'open'`),
		index("cash_sessions_location_day_idx").on(t.locationId, t.businessDate),
		check("cash_sessions_float_nonneg", sql`${t.openingFloat} >= 0`),
		check(
			"cash_sessions_closed_shape",
			sql`(${t.status} = 'closed') = (${t.closedAt} is not null and ${t.countedCash} is not null and ${t.expectedCash} is not null and ${t.closedBy} is not null)`,
		),
		tenantPolicy(),
	],
);

export const cashMovementKind = pgEnum("cash_movement_kind", [
	"pay_in",
	"pay_out", // petty cash, supplier paid from the drawer
	"drop", // moved to the safe mid-shift
]);

export const cashMovements = pgTable(
	"cash_movements",
	{
		id: id(),
		orgId: orgId(),
		cashSessionId: uuid("cash_session_id").notNull(),
		kind: cashMovementKind("kind").notNull(),
		/** Always positive; direction comes from kind. */
		amount: money("amount").notNull(),
		reason: text("reason").notNull(),
		createdBy: uuid("created_by").notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		foreignKey({
			columns: [t.orgId, t.cashSessionId],
			foreignColumns: [cashSessions.orgId, cashSessions.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.createdBy],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("restrict"),
		check("cash_movements_amount_pos", sql`${t.amount} > 0`),
		tenantPolicy(),
	],
);
