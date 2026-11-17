import { sql } from "drizzle-orm";
import {
	check,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, tenantPolicy, updatedAt } from "./_shared.js";
import { orgs } from "./tenancy.js";

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
