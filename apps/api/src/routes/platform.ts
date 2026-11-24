import {
	type OrgStatus,
	PlatformCreatedOrg,
	PlatformCreateOrg,
	PlatformExtendTrial,
	type PlatformMe,
	type PlatformOrgDetail,
	type PlatformOrgList,
	PlatformOrgQuery,
	type PlatformOrgRow,
	PlatformSetPlan,
	PlatformSetStatus,
	type PlatformUsage,
} from "@bite/contracts";
import {
	type EntitlementOverrides,
	type Entitlements,
	PLAN_IDS,
	type PlanId,
	resolveEntitlements,
} from "@bite/core";
import type { Db } from "@bite/db";
import { sql } from "@bite/db/orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import type { AppEnv } from "../env.js";
import { LIVE } from "../lib/entitlements.js";
import { ApiError } from "../lib/errors.js";
import { audit, UUID_RE } from "../lib/platform.js";
import { newSecret, sha256 } from "../lib/tokens.js";
import { validate } from "../lib/validate.js";
import { platformAuth } from "../middleware/platform-auth.js";
import { isUniqueViolation } from "../sync/orders.js";

const DAY_MS = 86_400_000;
const INVITE_TTL_MS = 7 * DAY_MS;
/** "Today" on the platform console is Muscat's day, whatever the branch. */
const PLATFORM_TZ = "Asia/Muscat";

type OrgRowSql = {
	id: string;
	name: string;
	slug: string;
	status: OrgStatus;
	trial_ends_at: Date | null;
	created_at: Date;
	entitlement_overrides: EntitlementOverrides | null;
	owner_email: string | null;
	location_count: number;
	member_count: number;
};
type UsageSql = {
	org_id: string;
	location_id: string;
	orders30d: number;
	sales30d: string;
	today: number;
	last_order_at: Date | null;
};
type SubSql = {
	id: string;
	org_id: string;
	provider: string;
	plan: string;
	status: string;
	current_period_end: Date | null;
	created_at: Date;
};

const sys = (c: Context<AppEnv>) => c.var.deps.systemDb as Db;
const now = (c: Context<AppEnv>) => c.var.deps.now?.() ?? new Date();
const iso = (d: Date | string | null) =>
	d === null ? null : new Date(d).toISOString();
const rows = async <T>(db: Db, q: ReturnType<typeof sql>) =>
	(await db.execute(q)) as unknown as T[];

function orgId(c: Context<AppEnv>) {
	const id = c.req.param("id") ?? "";
	if (!UUID_RE.test(id)) throw new ApiError("not_found", "org not found");
	return id;
}

const emptyUsage = (): PlatformUsage => ({
	orders30d: 0,
	sales30d: 0,
	ordersToday: 0,
	lastOrderAt: null,
	devices: 0,
});

function addUsage(into: PlatformUsage, u: UsageSql) {
	into.orders30d += u.orders30d;
	into.sales30d += Number(u.sales30d);
	into.ordersToday += u.today;
	const last = iso(u.last_order_at);
	if (last && (!into.lastOrderAt || last > into.lastOrderAt))
		into.lastOrderAt = last;
}

/**
 * The same choice as loadEntitlements in lib/entitlements.ts, for many orgs
 * at once and always as if enforcement were on, so the console shows the
 * plan each org would really be on.
 */
function entitlementsOf(
	org: OrgRowSql,
	subs: SubSql[],
	at: Date,
): Entitlements {
	const live = subs
		.filter((s) => LIVE.includes(s.status))
		.sort((a, b) => {
			const ae = a.current_period_end?.getTime() ?? Number.POSITIVE_INFINITY;
			const be = b.current_period_end?.getTime() ?? Number.POSITIVE_INFINITY;
			return be - ae || (a.id < b.id ? 1 : -1);
		});
	const sub = live[0];
	const lapsedCancel =
		sub?.status === "canceled" &&
		sub.current_period_end !== null &&
		sub.current_period_end.getTime() < at.getTime();
	return resolveEntitlements({
		enforce: true,
		now: at,
		orgStatus: org.status,
		trialEndsAt: org.trial_ends_at,
		subscription:
			sub && !lapsedCancel
				? { plan: sub.plan, currentPeriodEnd: sub.current_period_end }
				: null,
		overrides: org.entitlement_overrides,
	});
}

/** postgres-js under drizzle may hand timestamps back as strings. */
const date = (v: Date | string | null) => (v === null ? null : new Date(v));

async function loadOrgs(db: Db, id?: string) {
	const only = id ? sql`where o.id = ${id}` : sql``;
	const out = await rows<OrgRowSql>(
		db,
		sql`
		select o.id, o.name, o.slug, o.status, o.trial_ends_at, o.created_at,
			o.entitlement_overrides,
			(select count(*) from locations l where l.org_id = o.id)::int as location_count,
			(select count(*) from members m where m.org_id = o.id and m.is_active)::int as member_count,
			(select coalesce(u.email, i.email)
				from members m
				left join auth_users u on u.id = m.user_id
				left join member_invites i on i.member_id = m.id and i.accepted_at is null
				where m.org_id = o.id and m.org_role = 'owner' and m.is_active
				order by m.created_at limit 1) as owner_email
		from orgs o ${only}
		order by o.created_at desc`,
	);
	return out.map((o) => ({
		...o,
		trial_ends_at: date(o.trial_ends_at),
		created_at: date(o.created_at) as Date,
	}));
}

async function loadUsage(db: Db, at: Date, id?: string) {
	const only = id ? sql`and org_id = ${id}` : sql``;
	const since = new Date(at.getTime() - 30 * DAY_MS);
	const usage = await rows<UsageSql>(
		db,
		sql`
		select org_id, location_id,
			count(*) filter (where placed_at >= ${since.toISOString()}::timestamptz)::int as orders30d,
			coalesce(sum(total) filter (where placed_at >= ${since.toISOString()}::timestamptz), 0)::text as sales30d,
			count(*) filter (where placed_at >= (date_trunc('day', ${at.toISOString()}::timestamptz at time zone ${PLATFORM_TZ}) at time zone ${PLATFORM_TZ}))::int as today,
			max(placed_at) as last_order_at
		from orders
		where fulfillment_status <> 'cancelled' ${only}
		group by org_id, location_id`,
	);
	const devices = await rows<{
		org_id: string;
		location_id: string;
		n: number;
	}>(
		db,
		sql`select org_id, location_id, count(*)::int as n from devices
			where revoked_at is null ${only} group by org_id, location_id`,
	);
	return { usage, devices };
}

async function loadSubs(db: Db, id?: string) {
	const only = id ? sql`where org_id = ${id}` : sql``;
	const out = await rows<SubSql>(
		db,
		sql`select id, org_id, provider::text as provider, plan, status, current_period_end, created_at
			from billing_subscriptions ${only} order by created_at desc`,
	);
	return out.map((s) => ({
		...s,
		current_period_end: date(s.current_period_end),
		created_at: date(s.created_at) as Date,
	}));
}

async function buildRows(db: Db, at: Date, id?: string) {
	const [orgs, { usage, devices }, subs] = await Promise.all([
		loadOrgs(db, id),
		loadUsage(db, at, id),
		loadSubs(db, id),
	]);
	const byOrg = new Map<string, PlatformUsage>();
	const get = (k: string) => {
		let u = byOrg.get(k);
		if (!u) {
			u = emptyUsage();
			byOrg.set(k, u);
		}
		return u;
	};
	for (const u of usage) addUsage(get(u.org_id), u);
	for (const d of devices) get(d.org_id).devices += d.n;
	const items = orgs.map((o) => {
		const ent = entitlementsOf(
			o,
			subs.filter((s) => s.org_id === o.id),
			at,
		);
		const row: PlatformOrgRow = {
			id: o.id,
			name: o.name,
			slug: o.slug,
			status: o.status,
			trialEndsAt: iso(o.trial_ends_at),
			createdAt: iso(o.created_at) as string,
			plan: ent.plan,
			planSource: ent.source,
			ownerEmail: o.owner_email,
			locationCount: o.location_count,
			memberCount: o.member_count,
			usage: byOrg.get(o.id) ?? emptyUsage(),
		};
		return { row, ent, org: o };
	});
	return { items, usage, devices, subs };
}

/** /v1/platform: Bite's own operators. Cross-tenant through the system role. */
export const platformRoutes = new Hono<AppEnv>()
	.use(platformAuth)
	.get("/me", (c) => {
		const s = c.var.session;
		return c.json({
			userId: s.userId,
			email: s.email,
			name: s.name,
		} satisfies PlatformMe);
	})
	.get("/orgs", validate("query", PlatformOrgQuery), async (c) => {
		const q = c.req.valid("query");
		const db = sys(c);
		const { items } = await buildRows(db, now(c));
		const branches = await rows<{ org_id: string; name: string; slug: string }>(
			db,
			sql`select org_id, name, slug from locations`,
		);
		const needle = q.q?.toLowerCase();
		const matches = (r: PlatformOrgRow) => {
			if (q.status && r.status !== q.status) return false;
			if (q.plan && r.plan !== q.plan) return false;
			if (!needle) return true;
			const hay = [r.name, r.slug, r.ownerEmail ?? "", r.id];
			for (const b of branches) if (b.org_id === r.id) hay.push(b.name, b.slug);
			return hay.some((h) => h.toLowerCase().includes(needle));
		};
		const all = items.map((i) => i.row);
		const byStatus = { trial: 0, active: 0, suspended: 0 };
		const byPlan = Object.fromEntries(PLAN_IDS.map((p) => [p, 0])) as Record<
			PlanId,
			number
		>;
		for (const r of all) {
			byStatus[r.status]++;
			byPlan[r.plan]++;
		}
		const body: PlatformOrgList = {
			items: all.filter(matches),
			totals: {
				orgs: all.length,
				byStatus,
				byPlan,
				locations: all.reduce((n, r) => n + r.locationCount, 0),
				orders30d: all.reduce((n, r) => n + r.usage.orders30d, 0),
				sales30d: all.reduce((n, r) => n + r.usage.sales30d, 0),
				ordersToday: all.reduce((n, r) => n + r.usage.ordersToday, 0),
			},
			planEnforcement: c.var.deps.planEnforcement === true,
		};
		return c.json(body);
	})
	.get("/orgs/:id", async (c) => {
		const id = orgId(c);
		return c.json(await detail(c, id));
	})
	.post("/orgs", validate("json", PlatformCreateOrg), async (c) => {
		const b = c.req.valid("json");
		const db = sys(c);
		const at = now(c);
		const ids = { orgId: uuidv7(), locationId: uuidv7(), memberId: uuidv7() };
		const token = newSecret("inv_");
		const expiresAt = new Date(at.getTime() + INVITE_TTL_MS);
		try {
			await db.transaction(async (tx) => {
				const trial = b.trialDays > 0;
				await tx.execute(sql`
					insert into orgs (id, name, slug, status, trial_ends_at)
					values (${ids.orgId}, ${b.orgName}, ${b.orgSlug},
						${trial ? "trial" : "active"},
						${trial ? new Date(at.getTime() + b.trialDays * DAY_MS).toISOString() : null}::timestamptz)`);
				await tx.execute(sql`
					insert into locations (id, org_id, name, slug, timezone)
					values (${ids.locationId}, ${ids.orgId}, ${b.locationName}, ${b.locationSlug}, ${b.timezone})`);
				await tx.execute(sql`
					insert into members (id, org_id, display_name, org_role)
					values (${ids.memberId}, ${ids.orgId}, ${b.ownerName}, 'owner')`);
				await tx.execute(sql`
					insert into member_locations (org_id, member_id, location_id, role)
					values (${ids.orgId}, ${ids.memberId}, ${ids.locationId}, 'manager')`);
				await tx.execute(sql`
					insert into member_invites (id, org_id, member_id, email, token_hash, expires_at)
					values (${uuidv7()}, ${ids.orgId}, ${ids.memberId}, ${b.ownerEmail.toLowerCase()},
						${sha256(token)}, ${expiresAt.toISOString()}::timestamptz)`);
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
		await audit(db, ids.orgId, c.var.session, "platform.org_created", {
			ownerEmail: b.ownerEmail.toLowerCase(),
			trialDays: b.trialDays,
		});
		return c.json(
			PlatformCreatedOrg.parse({
				...ids,
				inviteToken: token,
				inviteExpiresAt: expiresAt.toISOString(),
			}),
			201,
		);
	})
	.post("/orgs/:id/status", validate("json", PlatformSetStatus), async (c) => {
		const id = orgId(c);
		const b = c.req.valid("json");
		const db = sys(c);
		const [before] = await rows<{ status: string }>(
			db,
			sql`select status from orgs where id = ${id} for update`,
		);
		if (!before) throw new ApiError("not_found", "org not found");
		await db.execute(
			sql`update orgs set status = ${b.status}, updated_at = now() where id = ${id}`,
		);
		await audit(db, id, c.var.session, "platform.status_changed", {
			from: before.status,
			to: b.status,
			...(b.note ? { note: b.note } : {}),
		});
		return c.json(await detail(c, id));
	})
	.post("/orgs/:id/plan", validate("json", PlatformSetPlan), async (c) => {
		const id = orgId(c);
		const b = c.req.valid("json");
		const db = sys(c);
		const at = now(c);
		await db.transaction(async (tx) => {
			const [org] = await rows<{ id: string }>(
				tx as unknown as Db,
				sql`select id from orgs where id = ${id} for update`,
			);
			if (!org) throw new ApiError("not_found", "org not found");
			// A plan set here replaces the previous hand-set one. Provider
			// subscriptions (Stripe, Thawani) are left to their webhooks.
			await tx.execute(sql`
				update billing_subscriptions
				set status = 'canceled', current_period_end = ${at.toISOString()}::timestamptz, updated_at = now()
				where org_id = ${id} and provider = 'manual' and status in ('active', 'past_due')`);
			if (b.plan !== "free") {
				await tx.execute(sql`
					insert into billing_subscriptions (id, org_id, provider, plan, status, current_period_end)
					values (${uuidv7()}, ${id}, 'manual', ${b.plan}, 'active', ${b.until ?? null}::timestamptz)`);
			}
		});
		await audit(db, id, c.var.session, "platform.plan_set", {
			plan: b.plan,
			until: b.until ?? null,
			...(b.note ? { note: b.note } : {}),
		});
		return c.json(await detail(c, id));
	})
	.post("/orgs/:id/trial", validate("json", PlatformExtendTrial), async (c) => {
		const id = orgId(c);
		const { days } = c.req.valid("json");
		const db = sys(c);
		const ends = new Date(now(c).getTime() + days * DAY_MS);
		const done = await rows<{ id: string }>(
			db,
			sql`update orgs set status = 'trial', trial_ends_at = ${ends.toISOString()}::timestamptz, updated_at = now()
				where id = ${id} returning id`,
		);
		if (!done.length) throw new ApiError("not_found", "org not found");
		await audit(db, id, c.var.session, "platform.trial_set", {
			days,
			endsAt: ends.toISOString(),
		});
		return c.json(await detail(c, id));
	});

async function detail(
	c: Context<AppEnv>,
	id: string,
): Promise<PlatformOrgDetail> {
	const db = sys(c);
	const { items, usage, devices, subs } = await buildRows(db, now(c), id);
	const hit = items[0];
	if (!hit) throw new ApiError("not_found", "org not found");
	const [locs, members, activity] = await Promise.all([
		rows<{
			id: string;
			name: string;
			slug: string;
			timezone: string;
			is_active: boolean;
			orders_paused_until: Date | null;
		}>(
			db,
			sql`select id, name, slug, timezone, is_active, orders_paused_until
				from locations where org_id = ${id} order by name`,
		),
		rows<{
			id: string;
			display_name: string;
			email: string | null;
			org_role: "owner" | "admin" | "staff";
			is_active: boolean;
			has_login: boolean;
		}>(
			db,
			sql`select m.id, m.display_name, coalesce(u.email, i.email) as email,
					m.org_role, m.is_active, (m.user_id is not null) as has_login
				from members m
				left join auth_users u on u.id = m.user_id
				left join member_invites i on i.member_id = m.id and i.accepted_at is null
				where m.org_id = ${id}
				order by case m.org_role when 'owner' then 0 when 'admin' then 1 else 2 end,
					m.display_name`,
		),
		rows<{
			id: string;
			action: string;
			data: Record<string, unknown> | null;
			created_at: Date;
		}>(
			db,
			sql`select id, action, data, created_at from audit_log
				where org_id = ${id} order by created_at desc limit 30`,
		),
	]);
	return {
		...hit.row,
		entitlements: hit.ent,
		entitlementOverrides: hit.org.entitlement_overrides as Record<
			string,
			unknown
		> | null,
		locations: locs.map((l) => {
			const u = emptyUsage();
			for (const x of usage) if (x.location_id === l.id) addUsage(u, x);
			for (const d of devices) if (d.location_id === l.id) u.devices += d.n;
			return {
				id: l.id,
				name: l.name,
				slug: l.slug,
				timezone: l.timezone,
				isActive: l.is_active,
				ordersPausedUntil: iso(l.orders_paused_until),
				usage: u,
			};
		}),
		members: members.map((m) => ({
			id: m.id,
			displayName: m.display_name,
			email: m.email,
			orgRole: m.org_role,
			isActive: m.is_active,
			hasLogin: m.has_login,
		})),
		subscriptions: subs.map((s) => ({
			id: s.id,
			provider: s.provider,
			plan: s.plan,
			status: s.status,
			currentPeriodEnd: iso(s.current_period_end),
			createdAt: iso(s.created_at) as string,
		})),
		activity: activity.map((a) => ({
			id: a.id,
			action: a.action,
			data: a.data,
			createdAt: iso(a.created_at) as string,
		})),
	};
}
