import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { isPlatformAdmin } from "../lib/platform.js";
import { sessionAuth } from "./admin-auth.js";

/**
 * Session cookie + a row in platform_admins. Everyone else, signed in or
 * not, gets the same 404 as an unknown path: the console doesn't announce
 * itself. Off entirely (404) when the API has no system connection.
 */
export const platformAuth = createMiddleware<AppEnv>(async (c, next) => {
	const sys = c.var.deps.systemDb;
	if (!sys || !c.var.deps.auth) throw new ApiError("not_found", "not found");
	try {
		await sessionAuth(c, async () => {});
	} catch {
		throw new ApiError("not_found", "not found");
	}
	if (!(await isPlatformAdmin(sys, c.var.session.userId))) {
		throw new ApiError("not_found", "not found");
	}
	await next();
});
