/**
 * Platform console demo: a Bite operator login and a few more businesses so
 * the console has something to list besides Luban Café.
 *
 *   pnpm --filter @bite/api platform:seed            (also run by demo:seed)
 *   pnpm --filter @bite/api platform:seed you@x.com  (make an existing login a platform admin)
 *
 * Env: DATABASE_OWNER_URL (superuser, default local). Idempotent.
 * Dev and demo only.
 */
import { fileURLToPath } from "node:url";
import { createDb, schema as s } from "@bite/db";
import { eq, sql } from "@bite/db/orm";
import { v7 as uuidv7 } from "uuid";
import { createAuth } from "../auth/better-auth.js";
import { newSecret } from "../lib/tokens.js";

export const PLATFORM_EMAIL = "ops@bite.demo";
export const PLATFORM_PASSWORD = "bite-ops-2026";

const DAY = 86_400_000;

/** Small businesses with a mix of statuses and plans. No sales history. */
const EXTRA = [
	{
		name: "Shuwa House",
		slug: "shuwa-house-demo",
		branch: "Shuwa House Seeb",
		branchSlug: "shuwa-seeb-demo",
		owner: "Salim Al Harthy",
		email: "salim@shuwa.demo",
		status: "trial" as const,
		trialDays: 12,
		plan: null,
	},
	{
		name: "Karak & Co",
		slug: "karak-co-demo",
		branch: "Karak & Co Ruwi",
		branchSlug: "karak-ruwi-demo",
		owner: "Fatma Al Balushi",
		email: "fatma@karak.demo",
		status: "active" as const,
		trialDays: 0,
		plan: "essentials",
	},
	{
		name: "Mandi Palace",
		slug: "mandi-palace-demo",
		branch: "Mandi Palace Sohar",
		branchSlug: "mandi-sohar-demo",
		owner: "Ahmed Al Rawahi",
		email: "ahmed@mandi.demo",
		status: "suspended" as const,
		trialDays: 0,
		plan: null,
	},
];

function withUser(ownerUrl: string, user: string, password: string) {
	const u = new URL(ownerUrl);
	u.username = user;
	u.password = password;
	return u.toString();
}

export async function seedPlatform(ownerUrl: string, apiBase: string) {
	const { db: o, client } = createDb(ownerUrl, { max: 1, onnotice: () => {} });
	try {
		const [has] = (await o.execute(
			sql`select to_regclass('public.platform_admins') as t`,
		)) as unknown as { t: string | null }[];
		if (!has?.t) {
			console.log("seed   platform_admins missing: run migrations first");
			return;
		}
		const [u] = await o
			.select({ id: s.authUsers.id })
			.from(s.authUsers)
			.where(eq(s.authUsers.email, PLATFORM_EMAIL));
		let userId = u?.id;
		if (!userId) {
			const api = createDb(withUser(ownerUrl, "bite_api", "bite_api"), {
				max: 1,
			});
			try {
				const auth = createAuth(api.db, {
					secret: newSecret(),
					baseURL: apiBase,
					trustedOrigins: [],
				});
				userId = (
					await auth.api.signUpEmail({
						body: {
							email: PLATFORM_EMAIL,
							password: PLATFORM_PASSWORD,
							name: "Bite Ops",
						},
					})
				).user.id;
			} finally {
				await api.client.end();
			}
		}
		await o.execute(sql`
			insert into platform_admins (user_id, note) values (${userId}, 'demo seed')
			on conflict (user_id) do nothing`);

		const now = Date.now();
		for (const x of EXTRA) {
			const [exists] = await o
				.select({ id: s.orgs.id })
				.from(s.orgs)
				.where(eq(s.orgs.slug, x.slug));
			if (exists) continue;
			const orgId = uuidv7();
			const locId = uuidv7();
			const memberId = uuidv7();
			await o.transaction(async (tx) => {
				await tx.insert(s.orgs).values({
					id: orgId,
					name: x.name,
					slug: x.slug,
					status: x.status,
					trialEndsAt: x.trialDays ? new Date(now + x.trialDays * DAY) : null,
					createdAt: new Date(now - (20 + EXTRA.indexOf(x) * 9) * DAY),
				});
				await tx.insert(s.locations).values({
					id: locId,
					orgId,
					name: x.branch,
					slug: x.branchSlug,
				});
				await tx.insert(s.members).values({
					id: memberId,
					orgId,
					displayName: x.owner,
					orgRole: "owner",
				});
				await tx.insert(s.memberLocations).values({
					orgId,
					memberId,
					locationId: locId,
					role: "manager",
				});
				await tx.insert(s.memberInvites).values({
					orgId,
					memberId,
					email: x.email,
					tokenHash: newSecret("seed_"),
					expiresAt: new Date(now + 7 * DAY),
				});
				if (x.plan) {
					await tx.insert(s.billingSubscriptions).values({
						orgId,
						provider: "manual",
						plan: x.plan,
						status: "active",
					});
				}
			});
		}
		// The showcase business is a paying Pro customer.
		await o.execute(sql`
			insert into billing_subscriptions (id, org_id, provider, plan, status)
			select ${uuidv7()}, o.id, 'manual', 'pro', 'active' from orgs o
			where o.slug = 'luban'
				and not exists (select 1 from billing_subscriptions b where b.org_id = o.id)`);
		console.log(`seed   platform admin ${PLATFORM_EMAIL} and demo businesses`);
	} finally {
		await client.end();
	}
}

/** Make an existing login a platform admin. */
async function grant(ownerUrl: string, email: string) {
	const { db: o, client } = createDb(ownerUrl, { max: 1 });
	try {
		const [u] = await o
			.select({ id: s.authUsers.id })
			.from(s.authUsers)
			.where(eq(s.authUsers.email, email.toLowerCase()));
		if (!u) throw new Error(`no login with email ${email}: sign up first`);
		await o.execute(sql`
			insert into platform_admins (user_id, note) values (${u.id}, 'granted by platform:seed')
			on conflict (user_id) do nothing`);
		console.log(`${email} is a platform admin`);
	} finally {
		await client.end();
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ownerUrl =
		process.env.DATABASE_OWNER_URL ??
		"postgres://postgres:postgres@localhost:5432/bite";
	const email = process.argv[2];
	if (email) await grant(ownerUrl, email);
	else
		await seedPlatform(
			ownerUrl,
			process.env.DEMO_API_URL ?? "http://localhost:3000",
		);
}
