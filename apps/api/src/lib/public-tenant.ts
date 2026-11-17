import { type Tx, withTenant } from "@bite/db";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../env.js";
import { ApiError } from "./errors.js";

/**
 * Guest routes: resolve the location slug through resolve_location_slug()
 * (SECURITY DEFINER, ids only), then run fn inside that org's tenant tx.
 * Unknown, inactive and suspended slugs are all a plain 404.
 */
export async function slugTx<T>(
	c: Context<AppEnv>,
	slug: string,
	fn: (tx: Tx, ids: { orgId: string; locationId: string }) => Promise<T>,
): Promise<T> {
	const rows = (await c.var.deps.db.execute(
		sql`select org_id, location_id from resolve_location_slug(${slug})`,
	)) as unknown as { org_id: string; location_id: string }[];
	const r = rows[0];
	if (!r) throw new ApiError("not_found", "no such location");
	return withTenant(c.var.deps.db, r.org_id, (tx) =>
		fn(tx, { orgId: r.org_id, locationId: r.location_id }),
	);
}
