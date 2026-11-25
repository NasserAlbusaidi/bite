import {
	normalizeConnectCode,
	PairDeviceRequest,
	type PairDeviceResponse,
} from "@bite/contracts";
import { sql } from "@bite/db/orm";
import { Hono } from "hono";
import type { AppEnv, DeviceCtx } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { PinLimiter } from "../lib/pin-limiter.js";
import { newSecret, sha256 } from "../lib/tokens.js";
import { validate } from "../lib/validate.js";

type Row = {
	device_id: string;
	org_id: string;
	location_id: string;
	kind: DeviceCtx["kind"];
	ticket_prefix: string;
	name: string;
};

/**
 * The address a guess came from. Behind the TLS proxy the last
 * X-Forwarded-For hop is the one the proxy itself added, so a client can't
 * pick it. Without a proxy everyone shares one bucket, which is still safe.
 */
function clientKey(header: string | undefined): string {
	const hops = (header ?? "").split(",").map((h) => h.trim());
	return `pair:${hops[hops.length - 1] || "direct"}`;
}

/**
 * POST /v1/pair: a tablet with no token types the connect code from the back
 * office and gets its device token back. No auth (that's the point); wrong
 * codes are limited to 10 per address per 10 minutes.
 */
export function pairRoutes(limiter = new PinLimiter(10, 10 * 60_000)) {
	return new Hono<AppEnv>().post(
		"/",
		validate("json", PairDeviceRequest),
		async (c) => {
			const key = clientKey(c.req.header("x-forwarded-for"));
			if (limiter.isLocked(key))
				throw new ApiError("rate_limited", "too many wrong codes, wait");
			const code = normalizeConnectCode(c.req.valid("json").code);
			const token = newSecret("dev_");
			const rows = code
				? ((await c.var.deps.db.execute(
						sql`select * from redeem_device_code(${sha256(code)}, ${sha256(token)})`,
					)) as unknown as Row[])
				: [];
			const r = rows[0];
			if (!r) {
				limiter.fail(key);
				throw new ApiError("not_found", "code not valid", {
					reason: "bad_code",
				});
			}
			limiter.reset(key);
			const res: PairDeviceResponse = {
				token,
				device: {
					deviceId: r.device_id,
					orgId: r.org_id,
					locationId: r.location_id,
					kind: r.kind,
					ticketPrefix: r.ticket_prefix,
					name: r.name,
				},
			};
			return c.json(res);
		},
	);
}
