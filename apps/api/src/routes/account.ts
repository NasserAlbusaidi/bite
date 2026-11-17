import { type AccountOrgs, CreatedOrg, CreateOrg } from "@bite/contracts";
import { schema, withTenant } from "@bite/db";
import { eq } from "@bite/db/orm";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { membershipsOf, sessionAuth } from "../middleware/admin-auth.js";
import { isUniqueViolation } from "../sync/orders.js";

const { orgs, locations, members, memberLocations } = schema;

/** A back-office login before it picks an org: list orgs, create one. */
export const accountRoutes = new Hono<AppEnv>()
	.use(sessionAuth)
	.get("/orgs", async (c) => {
		const all = await membershipsOf(c, c.var.session.userId);
		const items: AccountOrgs["items"] = [];
		// One short transaction per org: RLS shows each org only inside its own tenant.
		for (const m of all) {
			const row = await withTenant(c.var.deps.db, m.org_id, async (tx) => {
				const [o] = await tx.select().from(orgs).where(eq(orgs.id, m.org_id));
				const [me] = await tx
					.select({ orgRole: members.orgRole })
					.from(members)
					.where(eq(members.id, m.member_id));
				return o && me
					? { id: o.id, name: o.name, slug: o.slug, orgRole: me.orgRole }
					: null;
			});
			if (row) items.push(row);
		}
		return c.json({ items } satisfies AccountOrgs);
	})
	.post("/orgs", validate("json", CreateOrg), async (c) => {
		const body = c.req.valid("json");
		const s = c.var.session;
		const ids = { orgId: uuidv7(), locationId: uuidv7(), memberId: uuidv7() };
		try {
			// The org id is minted here and becomes the tenant before the org row
			// exists; the own_org_insert policy only allows inserting that one id.
			await withTenant(c.var.deps.db, ids.orgId, async (tx) => {
				await tx
					.insert(orgs)
					.values({ id: ids.orgId, name: body.orgName, slug: body.orgSlug });
				await tx.insert(locations).values({
					id: ids.locationId,
					orgId: ids.orgId,
					name: body.locationName,
					slug: body.locationSlug,
					timezone: body.timezone,
				});
				await tx.insert(members).values({
					id: ids.memberId,
					orgId: ids.orgId,
					userId: s.userId,
					displayName: body.displayName ?? s.name,
					orgRole: "owner",
				});
				await tx.insert(memberLocations).values({
					orgId: ids.orgId,
					memberId: ids.memberId,
					locationId: ids.locationId,
					role: "manager",
				});
			});
		} catch (err) {
			if (isUniqueViolation(err, "orgs_slug_unique")) {
				throw new ApiError("conflict", "org slug taken", { field: "orgSlug" });
			}
			if (isUniqueViolation(err, "locations_slug_unique")) {
				throw new ApiError("conflict", "location slug taken", {
					field: "locationSlug",
				});
			}
			throw err;
		}
		return c.json(CreatedOrg.parse(ids), 201);
	});
