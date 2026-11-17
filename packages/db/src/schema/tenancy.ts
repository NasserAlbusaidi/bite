import { sql } from "drizzle-orm";
import {
	boolean,
	char,
	foreignKey,
	integer,
	jsonb,
	pgEnum,
	pgPolicy,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import {
	appRole,
	createdAt,
	id,
	orgId,
	tenantPolicy,
	updatedAt,
} from "./_shared.js";

export const orgStatus = pgEnum("org_status", ["trial", "active", "suspended"]);

/** The customer account (billing, menu, loyalty). Not tenant-scoped itself. */
export const orgs = pgTable(
	"orgs",
	{
		id: id(),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique(),
		status: orgStatus("status").notNull().default("trial"),
		trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		pgPolicy("own_org", {
			for: "select",
			to: appRole,
			using: sql`${t.id} = app_org_id()`,
		}),
	],
);

export type BusinessHours = Record<
	"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
	{ open: string; close: string }[]
>;

export const locations = pgTable(
	"locations",
	{
		id: id(),
		orgId: orgId().references(() => orgs.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		/** Guest menu URL segment, globally unique. */
		slug: text("slug").notNull().unique(),
		timezone: text("timezone").notNull().default("Asia/Muscat"),
		currencyCode: char("currency_code", { length: 3 }).notNull().default("OMR"),
		currencyDecimals: smallint("currency_decimals").notNull().default(3),
		pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
		/** Default tax rate in basis points (5% = 500). */
		taxBps: integer("tax_bps").notNull().default(0),
		vatNumber: text("vat_number"),
		/** Minutes after local midnight when the business day rolls over (240 = 4 AM). */
		dayCutoffMinutes: smallint("day_cutoff_minutes").notNull().default(240),
		address: text("address"),
		phone: text("phone"),
		whatsappNumber: text("whatsapp_number"),
		businessHours: jsonb("business_hours").$type<BusinessHours>(),
		/** Visual-only settings: colours, logo, cover, fonts. */
		theme: jsonb("theme")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		receiptHeader: text("receipt_header"),
		isActive: boolean("is_active").notNull().default(true),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [unique().on(t.orgId, t.id), tenantPolicy()],
);

export const orgRole = pgEnum("org_role", ["owner", "admin", "staff"]);
export const locationRole = pgEnum("location_role", [
	"manager",
	"cashier",
	"server",
	"kitchen",
]);

/**
 * A person in an org. `userId` links to a Better Auth login (owners,
 * managers). Floor staff usually have only a PIN and no login.
 */
export const members = pgTable(
	"members",
	{
		id: id(),
		orgId: orgId().references(() => orgs.id, { onDelete: "restrict" }),
		/** Better Auth user id (text). Null for PIN-only staff. */
		userId: text("user_id"),
		displayName: text("display_name").notNull(),
		orgRole: orgRole("org_role").notNull().default("staff"),
		/** Argon2id hash of the staff PIN. */
		pinHash: text("pin_hash"),
		isActive: boolean("is_active").notNull().default(true),
		legacyId: integer("legacy_id"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		uniqueIndex("members_org_user_uq")
			.on(t.orgId, t.userId)
			.where(sql`${t.userId} is not null`),
		tenantPolicy(),
	],
);

export const memberLocations = pgTable(
	"member_locations",
	{
		orgId: orgId(),
		memberId: uuid("member_id").notNull(),
		locationId: uuid("location_id").notNull(),
		role: locationRole("role").notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		unique().on(t.memberId, t.locationId),
		foreignKey({
			columns: [t.orgId, t.memberId],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("cascade"),
		tenantPolicy(),
	],
);

export const deviceKind = pgEnum("device_kind", ["pos", "kds", "kiosk"]);

/** A registered tablet. Authenticates with a revocable token. */
export const devices = pgTable(
	"devices",
	{
		id: id(),
		orgId: orgId(),
		locationId: uuid("location_id").notNull(),
		name: text("name").notNull(),
		kind: deviceKind("kind").notNull(),
		/** Offline-safe ticket prefix, e.g. "A" gives A-042. Unique per location. */
		ticketPrefix: text("ticket_prefix").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		unique().on(t.locationId, t.ticketPrefix),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("restrict"),
		tenantPolicy(),
	],
);
