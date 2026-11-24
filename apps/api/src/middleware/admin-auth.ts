import { ORG_HEADER } from "@bite/contracts";
import { schema, type Tx, withTenant } from "@bite/db";
import { and, asc, eq, sql } from "@bite/db/orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { v7 as uuidv7 } from "uuid";
import type { AdminCtx, AppEnv, SessionCtx } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { audit, isPlatformAdmin, UUID_RE } from "../lib/platform.js";

const { members, memberLocations, locations } = schema;

/** Better Auth session cookie -> SessionCtx. Org not chosen yet. */
export const sessionAuth = createMiddleware<AppEnv>(async (c, next) => {
	const auth = c.var.deps.auth;
	if (!auth) throw new ApiError("internal", "auth not configured");
	const s = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!s) throw new ApiError("unauthenticated", "sign in required");
	c.set("session", {
		userId: s.user.id,
		email: s.user.email,
		name: s.user.name,
	});
	await next();
});

type Membership = { org_id: string; member_id: string };

export async function membershipsOf(
	c: Context<AppEnv>,
	userId: string,
): Promise<Membership[]> {
	return (await c.var.deps.db.execute(
		sql`select org_id, member_id from user_memberships(${userId})`,
	)) as unknown as Membership[];
}

/**
 * sessionAuth + pick the org (X-Org-Id, or the only membership) + load the
 * member under RLS. Re-checked every request, so deactivating someone or
 * removing a manager from a location takes effect immediately.
 * Floor roles (cashier/server/kitchen) without any managed location get 403.
 */
export const adminAuth = createMiddleware<AppEnv>(async (c, next) => {
	await sessionAuth(c, async () => {});
	const session = c.var.session;
	const all = await membershipsOf(c, session.userId);
	const wanted = c.req.header(ORG_HEADER);
	let m: Membership | undefined;
	if (wanted) m = all.find((x) => x.org_id === wanted);
	else if (all.length === 1) m = all[0];
	else if (all.length > 1)
		throw new ApiError("bad_request", `${ORG_HEADER} header required`, {
			orgIds: all.map((x) => x.org_id),
		});
	if (!m && wanted) {
		// Platform support view: a Bite operator opening an org they don't
		// belong to. Read-only, and every visit lands in the org's audit log.
		const support = await supportContext(c, session, wanted);
		if (support) {
			c.set("admin", support);
			await next();
			return;
		}
	}
	// Unknown org and "not a member" look identical on purpose.
	if (!m) throw new ApiError("forbidden", "not a member of this org");
	const { org_id: orgId, member_id: memberId } = m;

	const admin = await withTenant(c.var.deps.db, orgId, async (tx) => {
		const [member] = await tx
			.select()
			.from(members)
			.where(and(eq(members.id, memberId), eq(members.isActive, true)));
		if (!member) return null;
		const orgWide = member.orgRole === "owner" || member.orgRole === "admin";
		const locs = await locationsFor(tx, memberId, orgWide);
		return { member, orgWide, locs };
	});
	if (!admin) throw new ApiError("forbidden", "not a member of this org");
	const manages = new Set(
		admin.locs.filter((l) => l.role === "manager").map((l) => l.location.id),
	);
	if (!admin.orgWide && manages.size === 0) {
		throw new ApiError("forbidden", "back office needs a manager role");
	}
	const ctx: AdminCtx = {
		...session,
		orgId,
		memberId,
		displayName: admin.member.displayName,
		orgRole: admin.member.orgRole,
		locations: admin.locs,
		manages,
		orgWide: admin.orgWide,
	};
	c.set("admin", ctx);
	await next();
});

async function supportContext(
	c: Context<AppEnv>,
	session: SessionCtx,
	orgId: string,
): Promise<AdminCtx | null> {
	const sys = c.var.deps.systemDb;
	if (!sys || !UUID_RE.test(orgId)) return null;
	if (!(await isPlatformAdmin(sys, session.userId))) return null;
	const [org] = (await sys.execute(
		sql`select id from orgs where id = ${orgId}`,
	)) as unknown as { id: string }[];
	if (!org) return null;
	if (c.req.method !== "GET" && c.req.method !== "HEAD") {
		throw new ApiError("forbidden", "support view is read-only");
	}
	const locs = await withTenant(c.var.deps.db, orgId, (tx) =>
		locationsFor(tx, "", true),
	);
	if (c.req.path.endsWith("/v1/admin/me")) {
		await audit(sys, orgId, session, "platform.support_view", {});
	}
	return {
		...session,
		orgId,
		// Not a member: a throwaway id, never written anywhere (read-only).
		memberId: uuidv7(),
		displayName: session.name,
		orgRole: "owner",
		locations: locs,
		manages: new Set(locs.map((l) => l.location.id)),
		orgWide: true,
		support: true,
	};
}

async function locationsFor(tx: Tx, memberId: string, orgWide: boolean) {
	const cols = {
		id: locations.id,
		name: locations.name,
		slug: locations.slug,
		isActive: locations.isActive,
	};
	if (orgWide) {
		const rows = await tx
			.select(cols)
			.from(locations)
			.orderBy(asc(locations.name));
		return rows.map((location) => ({ location, role: "manager" as const }));
	}
	const rows = await tx
		.select({ ...cols, role: memberLocations.role })
		.from(memberLocations)
		.innerJoin(locations, eq(locations.id, memberLocations.locationId))
		.where(eq(memberLocations.memberId, memberId))
		.orderBy(asc(locations.name));
	return rows.map(({ role, ...location }) => ({ location, role }));
}

/** Tenant transaction for the admin's org. The org comes from the verified session only. */
export function adminTx<T>(c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>) {
	return withTenant(c.var.deps.db, c.var.admin.orgId, fn);
}

/** 403 unless org-wide (owner/admin). */
export function requireOrgWide(c: Context<AppEnv>) {
	if (!c.var.admin.orgWide) {
		throw new ApiError("forbidden", "owner or admin only");
	}
}

/** 404 (not 403) for a location outside the admin's reach: don't confirm it exists. */
export function requireLocation(c: Context<AppEnv>, locationId: string) {
	if (!c.var.admin.manages.has(locationId)) {
		throw new ApiError("not_found", "location not found");
	}
}
