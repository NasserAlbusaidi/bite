import { sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { AppEnv, DeviceCtx } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { sha256 } from "../lib/tokens.js";

type Row = {
	device_id: string;
	org_id: string;
	location_id: string;
	kind: DeviceCtx["kind"];
	ticket_prefix: string;
	name: string;
};

/**
 * `Authorization: Bearer <device token>`. Resolved via the auth_device()
 * SECURITY DEFINER function, since RLS hides devices until the tenant is
 * known. Revoked devices, inactive locations and suspended orgs fail here.
 */
export const deviceAuth = createMiddleware<AppEnv>(async (c, next) => {
	const header = c.req.header("authorization") ?? "";
	const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
	if (!m?.[1]) throw new ApiError("unauthenticated", "device token required");
	const rows = (await c.var.deps.db.execute(
		sql`select * from auth_device(${sha256(m[1])})`,
	)) as unknown as Row[];
	const r = rows[0];
	if (!r) throw new ApiError("unauthenticated", "invalid device token");
	c.set("device", {
		deviceId: r.device_id,
		orgId: r.org_id,
		locationId: r.location_id,
		kind: r.kind,
		ticketPrefix: r.ticket_prefix,
		name: r.name,
	});
	await next();
});
