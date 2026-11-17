import { type Tx, withTenant } from "@bite/db";
import type { Context } from "hono";
import type { AppEnv } from "../env.js";

/**
 * Run fn in a transaction scoped to the authenticated device's org.
 * The ONLY way route handlers touch tenant data. The org comes from the
 * verified credential, never from the request body or path.
 */
export function tenantTx<T>(
	c: Context<AppEnv>,
	fn: (tx: Tx) => Promise<T>,
): Promise<T> {
	return withTenant(c.var.deps.db, c.var.device.orgId, fn);
}
