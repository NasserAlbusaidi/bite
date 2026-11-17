import type { RealtimeEvent } from "@bite/contracts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { deviceAuth } from "../middleware/device-auth.js";

const HEARTBEAT_MS = 25_000;

/**
 * GET /v1/realtime: SSE hints for the device's location. Clients pull on
 * every event and once on (re)connect; nothing is replayed. The stream
 * closes itself if this device is revoked.
 */
export const realtimeRoutes = new Hono<AppEnv>()
	.use(deviceAuth)
	.get("/", (c) => {
		const hub = c.var.deps.realtime;
		if (!hub) throw new ApiError("internal", "realtime is not enabled");
		const d = c.var.device;
		return streamSSE(c, async (stream) => {
			const queue: RealtimeEvent[] = [];
			let wake: (() => void) | undefined;
			let closed = false;
			const unsubscribe = hub.subscribe({
				orgId: d.orgId,
				locationId: d.locationId,
				send: (e) => {
					queue.push(e);
					wake?.();
				},
			});
			const done = () => {
				closed = true;
				wake?.();
			};
			stream.onAbort(done);
			await stream.writeSSE({ event: "ready", data: "{}" });
			try {
				while (!closed) {
					const e = queue.shift();
					if (e) {
						await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
						if (e.type === "device.revoked" && e.deviceId === d.deviceId) break;
						continue;
					}
					await new Promise<void>((resolve) => {
						wake = resolve;
						const t = setTimeout(resolve, HEARTBEAT_MS);
						wake = () => {
							clearTimeout(t);
							resolve();
						};
					});
					wake = undefined;
					if (!closed && queue.length === 0) await stream.write(": ping\n\n");
				}
			} finally {
				unsubscribe();
			}
		});
	});
