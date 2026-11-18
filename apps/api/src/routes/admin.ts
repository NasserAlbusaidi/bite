import type { AdminMe } from "@bite/contracts";
import { schema } from "@bite/db";
import { eq } from "@bite/db/orm";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { loadEntitlements } from "../lib/entitlements.js";
import { adminAuth, adminTx } from "../middleware/admin-auth.js";
import { adminMenuRoutes } from "./admin-menu.js";
import { adminOrgRoutes } from "./admin-org.js";
import { adminReportRoutes } from "./admin-reports.js";

const { orgs } = schema;

/** Back office. Every route here runs after adminAuth (session + org + role). */
export const adminRoutes = new Hono<AppEnv>()
	.use(adminAuth)
	.get("/me", async (c) => {
		const a = c.var.admin;
		const { org, entitlements } = await adminTx(c, async (tx) => {
			const [org] = await tx.select().from(orgs).where(eq(orgs.id, a.orgId));
			return {
				org,
				entitlements: await loadEntitlements(tx, c.var.deps, a.orgId),
			};
		});
		const body: AdminMe = {
			member: {
				id: a.memberId,
				displayName: a.displayName,
				email: a.email,
				orgRole: a.orgRole,
			},
			org: { id: a.orgId, name: org?.name ?? "", slug: org?.slug ?? "" },
			locations: a.locations,
			entitlements,
		};
		return c.json(body);
	})
	.route("/", adminMenuRoutes)
	.route("/", adminOrgRoutes)
	.route("/", adminReportRoutes);
