import { createDb } from "@bite/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./auth/better-auth.js";
import { PinLimiter } from "./lib/pin-limiter.js";
import { diskStore } from "./lib/uploads.js";
import { RealtimeHub } from "./realtime/hub.js";

function required(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is required`);
	return v;
}

/** DATABASE_URL must be a login role in bite_app, never the schema owner. */
const { db, client } = createDb(required("DATABASE_URL"));
const staffTokenSecret = required("STAFF_TOKEN_SECRET");
if (Buffer.byteLength(staffTokenSecret) < 32) {
	throw new Error("STAFF_TOKEN_SECRET must be at least 32 bytes");
}

const authSecret = required("BETTER_AUTH_SECRET");
if (Buffer.byteLength(authSecret) < 32) {
	throw new Error("BETTER_AUTH_SECRET must be at least 32 bytes");
}
/** Comma-separated back-office origins, e.g. https://admin.bite.om */
const adminOrigins = (process.env.ADMIN_ORIGINS ?? "")
	.split(",")
	.map((o) => o.trim())
	.filter(Boolean);
const auth = createAuth(db, {
	secret: authSecret,
	baseURL: required("PUBLIC_API_URL"),
	trustedOrigins: adminOrigins,
});

/**
 * The billing kill switch. Anything but "on" leaves every org on everything,
 * unlimited, exactly as before plans existed.
 */
const planEnforcement = process.env.PLAN_ENFORCEMENT === "on";

/** Product photos on local disk. One API server (the demo box) needs nothing else. */
const uploads = diskStore(process.env.UPLOAD_DIR ?? "./uploads");

const realtime = new RealtimeHub();
// postgres.js keeps a dedicated connection for LISTEN and re-listens after reconnects.
await realtime.start((channel, fn) => client.listen(channel, fn));

const app = createApp({
	db,
	staffTokenSecret,
	pinLimiter: new PinLimiter(),
	realtime,
	auth,
	adminOrigins,
	planEnforcement,
	uploads,
	publicApiUrl: required("PUBLIC_API_URL"),
});
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
