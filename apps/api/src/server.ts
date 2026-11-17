import { createDb } from "@bite/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { PinLimiter } from "./lib/pin-limiter.js";

function required(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is required`);
	return v;
}

/** DATABASE_URL must be a login role in bite_app, never the schema owner. */
const { db } = createDb(required("DATABASE_URL"));
const staffTokenSecret = required("STAFF_TOKEN_SECRET");
if (Buffer.byteLength(staffTokenSecret) < 32) {
	throw new Error("STAFF_TOKEN_SECRET must be at least 32 bytes");
}

const app = createApp({ db, staffTokenSecret, pinLimiter: new PinLimiter() });
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
