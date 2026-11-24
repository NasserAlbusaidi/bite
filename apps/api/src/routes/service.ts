import {
	CreateServiceRequest,
	type ServiceRequestList,
	type ServiceRequestResponse,
} from "@bite/contracts";
import { sql } from "@bite/db/orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { deviceAuth } from "../middleware/device-auth.js";
import { ServiceRequestStore } from "../service/requests.js";

const stores = new WeakMap<Deps, ServiceRequestStore>();
function store(deps: Deps): ServiceRequestStore {
	if (deps.serviceRequests) return deps.serviceRequests;
	let s = stores.get(deps);
	if (!s) {
		s = new ServiceRequestStore();
		stores.set(deps, s);
	}
	return s;
}

/** Tell the location's tablets to refetch (in-process: the store is too). */
function hint(deps: Deps, orgId: string, locationId: string) {
	deps.realtime?.dispatch(
		JSON.stringify({ type: "service.changed", org: orgId, loc: locationId }),
	);
}

/** Guest side: POST /v1/public/locations/:slug/service-requests */
export const publicServiceRoutes = new Hono<AppEnv>().post(
	"/locations/:slug/service-requests",
	validate("json", CreateServiceRequest),
	async (c) => {
		const rows = (await c.var.deps.db.execute(
			sql`select org_id, location_id from resolve_location_slug(${c.req.param("slug")})`,
		)) as unknown as { org_id: string; location_id: string }[];
		const r = rows[0];
		if (!r) throw new ApiError("not_found", "no such location");
		const body = c.req.valid("json");
		const out = store(c.var.deps).open({
			orgId: r.org_id,
			locationId: r.location_id,
			kind: body.kind,
			tableLabel: body.tableLabel,
		});
		if (!out) throw new ApiError("rate_limited", "too many open calls");
		hint(c.var.deps, r.org_id, r.location_id);
		const res: ServiceRequestResponse = { request: out.request };
		return c.json(res, out.created ? 201 : 200);
	},
);

/** Tablet side: the location's open calls, and closing one. */
export const deviceServiceRoutes = new Hono<AppEnv>()
	.use(deviceAuth)
	.get("/service-requests", (c) => {
		const d = c.var.device;
		const res: ServiceRequestList = {
			requests: store(c.var.deps).list(d.orgId, d.locationId),
		};
		c.header("cache-control", "no-store");
		return c.json(res);
	})
	.post(
		"/service-requests/:id/done",
		validate("param", z.object({ id: z.uuid() })),
		(c) => {
			const d = c.var.device;
			const ok = store(c.var.deps).close(
				d.orgId,
				d.locationId,
				c.req.valid("param").id,
			);
			if (!ok) throw new ApiError("not_found", "no such request");
			hint(c.var.deps, d.orgId, d.locationId);
			return c.json({ ok: true });
		},
	);
