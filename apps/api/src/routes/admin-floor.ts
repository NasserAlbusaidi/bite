import { type Floor, PutFloorRequest } from "@bite/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { loadFloor, saveFloor } from "../floor/service.js";
import { ApiError } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { adminTx, requireLocation } from "../middleware/admin-auth.js";
import { isUniqueViolation } from "../sync/orders.js";

const idParam = z.object({ id: z.uuid() });

/** Floor plan per branch: GET and PUT the whole plan. Managers of the branch and up. */
export const adminFloorRoutes = new Hono<AppEnv>()
	.get("/locations/:id/floor", validate("param", idParam), async (c) => {
		const { id } = c.req.valid("param");
		requireLocation(c, id);
		const body: Floor = await adminTx(c, (tx) => loadFloor(tx, id));
		return c.json(body);
	})
	.put(
		"/locations/:id/floor",
		validate("param", idParam),
		validate("json", PutFloorRequest),
		async (c) => {
			const { id } = c.req.valid("param");
			requireLocation(c, id);
			const b = c.req.valid("json");
			try {
				const body: Floor = await adminTx(c, (tx) =>
					saveFloor(tx, c.var.admin.orgId, id, b),
				);
				return c.json(body);
			} catch (err) {
				// A unique label/id clash, or an id another org owns (RLS refuses
				// the upsert's update half): either way the id or label is taken.
				const code = (err as { cause?: { code?: string } })?.cause?.code;
				if (isUniqueViolation(err) || code === "42501")
					throw new ApiError("conflict", "table label or id already used");
				throw err;
			}
		},
	);
