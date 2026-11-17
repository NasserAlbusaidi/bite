import { createDb } from "@bite/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { PinLimiter } from "./lib/pin-limiter.js";
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

const realtime = new RealtimeHub();
// postgres.js keeps a dedicated connection for LISTEN and re-listens after reconnects.
await realtime.start((channel, fn) => client.listen(channel, fn));

const app = createApp({
	db,
	staffTokenSecret,
	pinLimiter: new PinLimiter(),
	realtime,
});
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
