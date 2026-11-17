import { STAFF_TOKEN_HEADER } from "@bite/contracts";
import { schema } from "@bite/db";
import { and, eq } from "@bite/db/orm";
import { createMiddleware } from "hono/factory";
import type { AppEnv, StaffCtx } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { tenantTx } from "../lib/tenant.js";
import { verifyStaffToken } from "../lib/tokens.js";

const { members, memberLocations } = schema;

/**
 * X-Staff-Token from PIN login. Must run after deviceAuth. The token is bound
 * to the device it was issued on, and the member is re-checked on every
 * request so deactivating staff or removing them from the location takes
 * effect immediately, not at token expiry.
 */
export const staffAuth = (allowed?: readonly StaffCtx["role"][]) =>
	createMiddleware<AppEnv>(async (c, next) => {
		const token = c.req.header(STAFF_TOKEN_HEADER);
		if (!token) throw new ApiError("unauthenticated", "staff token required");
		const claims = verifyStaffToken(
			token,
			c.var.deps.staffTokenSecret,
			(c.var.deps.now?.() ?? new Date()).getTime(),
		);
		const device = c.var.device;
		if (!claims || claims.d !== device.deviceId || claims.o !== device.orgId) {
			throw new ApiError("unauthenticated", "invalid staff token");
		}
		const row = await tenantTx(c, async (tx) => {
			const [r] = await tx
				.select({
					memberId: members.id,
					displayName: members.displayName,
					orgRole: members.orgRole,
					role: memberLocations.role,
				})
				.from(members)
				.innerJoin(
					memberLocations,
					and(
						eq(memberLocations.memberId, members.id),
						eq(memberLocations.locationId, device.locationId),
					),
				)
				.where(and(eq(members.id, claims.m), eq(members.isActive, true)));
			return r;
		});
		if (!row) throw new ApiError("unauthenticated", "staff no longer active");
		if (allowed && !allowed.includes(row.role)) {
			throw new ApiError("forbidden", `role ${row.role} not allowed`);
		}
		c.set("staff", row);
		await next();
	});
