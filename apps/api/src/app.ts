import { Hono } from "hono";
import type { AppEnv, Deps } from "./env.js";
import { notFound, onError } from "./lib/errors.js";
import { deviceRoutes } from "./routes/device.js";
import { publicRoutes } from "./routes/public.js";

export function createApp(deps: Deps) {
	const app = new Hono<AppEnv>()
		.use(async (c, next) => {
			c.set("deps", deps);
			await next();
		})
		.get("/health", (c) => c.json({ ok: true }))
		.route("/v1/device", deviceRoutes)
		.route("/v1/public", publicRoutes);
	app.onError(onError);
	app.notFound(notFound);
	return app;
}

/** Hono RPC type for clients: `hc<AppType>(baseUrl)`. */
export type AppType = ReturnType<typeof createApp>;
