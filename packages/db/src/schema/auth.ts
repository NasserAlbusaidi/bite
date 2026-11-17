import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Better Auth tables (back-office logins: owners, admins, managers).
 *
 * Deliberately NOT tenant-scoped and without RLS: one person can belong to
 * several orgs, and the session lookup happens before any tenant is known.
 * They hold identities only. What a user may touch is decided by `members`
 * (RLS-scoped), reached through user_memberships() (migration 0010).
 * Ids are text (Better Auth generates uuids); members.user_id points here.
 */
const ts = (name: string) =>
	timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const authUsers = pgTable("auth_users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: ts("created_at"),
	updatedAt: ts("updated_at"),
});

export const authSessions = pgTable(
	"auth_sessions",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: ts("created_at"),
		updatedAt: ts("updated_at"),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => authUsers.id, { onDelete: "cascade" }),
	},
	(t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authAccounts = pgTable(
	"auth_accounts",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => authUsers.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", {
			withTimezone: true,
		}),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
			withTimezone: true,
		}),
		scope: text("scope"),
		/** Argon2id (legacy bcrypt hashes carried over at cutover). */
		password: text("password"),
		createdAt: ts("created_at"),
		updatedAt: ts("updated_at"),
	},
	(t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const authVerifications = pgTable(
	"auth_verifications",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: ts("created_at"),
		updatedAt: ts("updated_at"),
	},
	(t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);
