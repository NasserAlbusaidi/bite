/**
 * The real API (same createApp as src/server.ts) with a virtual clock, so a
 * simulated business day can run compressed. now = VIRT0 + (real - REAL0) * SPEED.
 * Also counts in-flight requests and server-side handler time per route.
 */
import { createDb } from "@bite/db";
import { serve } from "@hono/node-server";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth/better-auth.js";
import { PinLimiter } from "../src/lib/pin-limiter.js";
import { RealtimeHub } from "../src/realtime/hub.js";

const env = (k: string) => {
	const v = process.env[k];
	if (!v) throw new Error(`${k} required`);
	return v;
};
const REAL0 = Number(env("SIM_REAL0"));
const VIRT0 = Date.parse(env("SIM_VIRT0"));
const SPEED = Number(env("SIM_SPEED"));
const now = () => new Date(VIRT0 + (Date.now() - REAL0) * SPEED);

const pool = Number(process.env.SIM_POOL ?? 10);
const { db, client } = createDb(env("DATABASE_URL"), { max: pool });
const adminOrigins = env("ADMIN_ORIGINS").split(",");
const auth = createAuth(db, {
	secret: env("BETTER_AUTH_SECRET"),
	baseURL: env("PUBLIC_API_URL"),
	trustedOrigins: adminOrigins,
});
const realtime = new RealtimeHub();
await realtime.start((channel, fn) => client.listen(channel, fn));
const app = createApp({
	db,
	staffTokenSecret: env("STAFF_TOKEN_SECRET"),
	// No PIN lockouts from the sim's own volume (each test hits the same few members).
	pinLimiter: new PinLimiter(),
	realtime,
	auth,
	adminOrigins,
	now,
});
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(
	`sim api :${port} pool=${pool} speed=${SPEED} virt0=${new Date(VIRT0).toISOString()}`,
);
