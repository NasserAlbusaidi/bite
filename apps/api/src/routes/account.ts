import {
	AcceptedInvite,
	AcceptInvite,
	type AccountOrgs,
	CreatedOrg,
	CreateOrg,
} from "@bite/contracts";
import { TRIAL_DAYS } from "@bite/core";
import { schema, withTenant } from "@bite/db";
import { and, eq, isNull, sql } from "@bite/db/orm";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { sha256 } from "../lib/tokens.js";
import { validate } from "../lib/validate.js";
import { membershipsOf, sessionAuth } from "../middleware/admin-auth.js";
import { isUniqueViolation } from "../sync/orders.js";

const { orgs, locations, members, memberLocations, memberInvites } = schema;

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
				// Every new business starts on a full-featured trial, then falls to
				// the free plan on its own (see @bite/core plans.ts).
				const now = c.var.deps.now?.() ?? new Date();
				await tx.insert(orgs).values({
					id: ids.orgId,
					name: body.orgName,
					slug: body.orgSlug,
					trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
				});
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
	})
	.post("/invites/accept", validate("json", AcceptInvite), async (c) => {
		const s = c.var.session;
		const rows = (await c.var.deps.db.execute(
			sql`select org_id, invite_id from resolve_invite(${sha256(c.req.valid("json").token)})`,
		)) as unknown as { org_id: string; invite_id: string }[];
		const hit = rows[0];
		// Unknown, expired and used links all look the same.
		if (!hit) throw new ApiError("not_found", "invite not found or expired");
		const res = await withTenant(c.var.deps.db, hit.org_id, async (tx) => {
			const [inv] = await tx
				.select()
				.from(memberInvites)
				.where(
					and(
						eq(memberInvites.id, hit.invite_id),
						isNull(memberInvites.acceptedAt),
					),
				)
				.for("update");
			if (!inv) throw new ApiError("not_found", "invite not found or expired");
			if (inv.email !== s.email.toLowerCase()) {
				throw new ApiError("forbidden", "this invite is for a different email");
			}
			const [m] = await tx
				.select()
				.from(members)
				.where(eq(members.id, inv.memberId));
			if (!m?.isActive || m.userId) {
				throw new ApiError("not_found", "invite not found or expired");
			}
			try {
				await tx
					.update(members)
					.set({ userId: s.userId, updatedAt: new Date() })
					.where(eq(members.id, m.id));
			} catch (err) {
				if (isUniqueViolation(err, "members_org_user_uq")) {
					throw new ApiError("conflict", "already a member of this org");
				}
				throw err;
			}
			await tx
				.update(memberInvites)
				.set({ acceptedAt: new Date() })
				.where(eq(memberInvites.id, inv.id));
			return { orgId: hit.org_id, memberId: m.id };
		});
		return c.json(AcceptedInvite.parse(res));
	});
