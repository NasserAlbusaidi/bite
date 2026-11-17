import { ORG_HEADER } from "@bite/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv, Deps } from "./env.js";
import { notFound, onError } from "./lib/errors.js";
import { accountRoutes } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";
import { cartRoutes } from "./routes/carts.js";
import { deviceRoutes } from "./routes/device.js";
import { publicRoutes } from "./routes/public.js";
import { realtimeRoutes } from "./routes/realtime.js";
import { syncRoutes } from "./routes/sync.js";

export function createApp(deps: Deps) {
	const backOfficeCors = cors({
		origin: deps.adminOrigins ?? [],
		credentials: true,
		allowHeaders: ["content-type", ORG_HEADER],
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
		maxAge: 600,
	});
	const app = new Hono<AppEnv>()
		.use(async (c, next) => {
			c.set("deps", deps);
			await next();
		})
		.get("/health", (c) => c.json({ ok: true }))
		// Back office runs on its own origin and authenticates with a cookie.
		.use("/v1/auth/*", backOfficeCors)
		.use("/v1/account/*", backOfficeCors)
		.use("/v1/admin/*", backOfficeCors)
		.on(["GET", "POST"], "/v1/auth/*", (c) => {
			if (!deps.auth) return c.notFound();
			return deps.auth.handler(c.req.raw);
		})
		.route("/v1/account", accountRoutes)
		.route("/v1/admin", adminRoutes)
		.route("/v1/device", deviceRoutes)
		.route("/v1/public", publicRoutes)
		.route("/v1/public", cartRoutes)
		.route("/v1/realtime", realtimeRoutes)
		.route("/v1", syncRoutes);
	app.onError(onError);
	app.notFound(notFound);
	return app;
}

/** Hono RPC type for clients: `hc<AppType>(baseUrl)`. */
export type AppType = ReturnType<typeof createApp>;
