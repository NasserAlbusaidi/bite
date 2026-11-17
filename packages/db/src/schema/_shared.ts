import { sql } from "drizzle-orm";
import { bigint, pgPolicy, pgRole, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

/** Runtime role. Not the table owner and NOBYPASSRLS, so RLS always applies. */
export const appRole = pgRole("bite_app").existing();

/** UUIDv7 primary key. Clients (offline tablets) may supply their own. */
export const id = () =>
	uuid("id")
		.primaryKey()
		.$defaultFn(() => uuidv7());

export const orgId = () => uuid("org_id").notNull();

/** Integer minor units (baisa). Never decimal, never float. */
export const money = (name: string) => bigint(name, { mode: "number" });

export const createdAt = () =>
	timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
	timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date());

const sameOrg = sql`org_id = app_org_id()`;

/**
 * Every tenant table gets this. app_org_id() reads the per-transaction
 * setting and returns NULL when it is unset, so a forgotten tenant context
 * sees zero rows instead of every row.
 */
export const tenantPolicy = () =>
	pgPolicy("tenant_isolation", {
		as: "permissive",
		for: "all",
		to: appRole,
		using: sameOrg,
		withCheck: sameOrg,
	});

/** Append-only tables: the app can read and insert, never update or delete. */
export const appendOnlyPolicies = () => [
	pgPolicy("tenant_select", {
		for: "select",
		to: appRole,
		using: sameOrg,
	}),
	pgPolicy("tenant_insert", {
		for: "insert",
		to: appRole,
		withCheck: sameOrg,
	}),
];
