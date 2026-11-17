import {
	SyncPullQuery,
	SyncPushRequest,
	type SyncPushResponse,
} from "@bite/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { tenantTx } from "../lib/tenant.js";
import { validate } from "../lib/validate.js";
import { deviceAuth } from "../middleware/device-auth.js";
import { loadOrderDto } from "../orders/dto.js";
import { pullChanges } from "../sync/pull.js";
import { pushMutations } from "../sync/push.js";

/** Tablet sync. Device token only: offline mutations carry their own memberId. */
export const syncRoutes = new Hono<AppEnv>()
	.use(deviceAuth)
	.post("/sync/push", validate("json", SyncPushRequest), async (c) => {
		const body: SyncPushResponse = {
			results: await pushMutations(
				c.var.deps,
				c.var.device,
				c.req.valid("json"),
			),
		};
		return c.json(body);
	})
	.get("/sync/pull", validate("query", SyncPullQuery), async (c) =>
		c.json(await pullChanges(c.var.deps, c.var.device, c.req.valid("query"))),
	)
	.get(
		"/orders/:orderId",
		validate("param", z.object({ orderId: z.uuid() })),
		async (c) => {
			const order = await tenantTx(c, (tx) =>
				loadOrderDto(tx, c.req.valid("param").orderId),
			);
			if (!order || order.locationId !== c.var.device.locationId) {
				throw new ApiError("not_found", "no such order");
			}
			return c.json(order);
		},
	);
