import { createDb, type Db, schema as s } from "@bite/db";
import { runMigrations } from "@bite/db/migrate";
import { eq } from "@bite/db/orm";
import { hash } from "@node-rs/argon2";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { createApp } from "../app.js";
import { createAuth } from "../auth/better-auth.js";
import type { Deps } from "../env.js";
import { PinLimiter } from "../lib/pin-limiter.js";
import { newSecret, sha256 } from "../lib/tokens.js";
import { RealtimeHub } from "../realtime/hub.js";

/**
 * Integration harness: a fresh schema, the app connected as a bite_app login
 * (RLS enforced, exactly like production), and two fully separate tenants.
 * TEST_DATABASE_URL must be the schema owner with CREATEROLE.
 */
export const ownerUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !ownerUrl) {
	throw new Error(
		"TEST_DATABASE_URL is required in CI; API tests must not skip",
	);
}

export const PIN = "4321";
export const PASSWORD = "correct horse battery";
export const ADMIN_ORIGIN = "http://admin.test";

export type Tenant = Awaited<ReturnType<typeof seedTenant>>;

async function seedTenant(ownerDb: Db, slug: string) {
	const t = {
		org: uuidv7(),
		loc: uuidv7(),
		otherLoc: uuidv7(),
		device: uuidv7(),
		deviceToken: newSecret("dev_"),
		cashier: uuidv7(),
		manager: uuidv7(),
		kitchen: uuidv7(),
		otherLocStaff: uuidv7(),
		inactive: uuidv7(),
		cat: uuidv7(),
		prod: uuidv7(),
	};
	const pinHash = await hash(PIN);
	await ownerDb.insert(s.orgs).values({ id: t.org, name: slug, slug });
	await ownerDb.insert(s.locations).values([
		{ id: t.loc, orgId: t.org, name: `${slug} main`, slug: `${slug}-main` },
		{ id: t.otherLoc, orgId: t.org, name: `${slug} two`, slug: `${slug}-two` },
	]);
	await ownerDb.insert(s.devices).values({
		id: t.device,
		orgId: t.org,
		locationId: t.loc,
		name: "Front till",
		kind: "pos",
		ticketPrefix: "A",
		tokenHash: sha256(t.deviceToken),
	});
	await ownerDb.insert(s.members).values([
		{ id: t.cashier, orgId: t.org, displayName: `${slug} cashier`, pinHash },
		{ id: t.kitchen, orgId: t.org, displayName: `${slug} kitchen`, pinHash },
		{ id: t.manager, orgId: t.org, displayName: `${slug} manager`, pinHash },
		{
			id: t.otherLocStaff,
			orgId: t.org,
			displayName: `${slug} elsewhere`,
			pinHash,
		},
		{
			id: t.inactive,
			orgId: t.org,
			displayName: `${slug} gone`,
			pinHash,
			isActive: false,
		},
	]);
	await ownerDb.insert(s.memberLocations).values([
		{ orgId: t.org, memberId: t.cashier, locationId: t.loc, role: "cashier" },
		{ orgId: t.org, memberId: t.kitchen, locationId: t.loc, role: "kitchen" },
		{ orgId: t.org, memberId: t.manager, locationId: t.loc, role: "manager" },
		{
			orgId: t.org,
			memberId: t.otherLocStaff,
			locationId: t.otherLoc,
			role: "cashier",
		},
		{ orgId: t.org, memberId: t.inactive, locationId: t.loc, role: "cashier" },
	]);
	await ownerDb
		.insert(s.categories)
		.values({ id: t.cat, orgId: t.org, name: { en: "Drinks" } });
	await ownerDb.insert(s.products).values({
		id: t.prod,
		orgId: t.org,
		categoryId: t.cat,
		name: { en: `Latte ${slug}` },
		price: 1500,
	});
	return t;
}

/**
 * The API suite gets its own database so it can run alongside the
 * packages/db suite (turbo runs packages in parallel; both reset the schema).
 */
async function apiDatabaseUrl(): Promise<string> {
	const base = new URL(ownerUrl as string);
	const name = `${base.pathname.slice(1)}_api`;
	const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
	try {
		const [exists] =
			await admin`select 1 from pg_database where datname = ${name}`;
		if (!exists) await admin.unsafe(`create database "${name}"`);
	} finally {
		await admin.end();
	}
	base.pathname = `/${name}`;
	return base.toString();
}

export async function setupHarness() {
	const url = await apiDatabaseUrl();
	const ownerConn = createDb(url, { max: 1, onnotice: () => {} });
	const owner = ownerConn.client;
	const ownerDb = ownerConn.db;
	await owner.unsafe(
		"drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
	);
	await owner.file(
		new URL("../../../../packages/db/sql/bootstrap-roles.sql", import.meta.url)
			.pathname,
	);
	await runMigrations(url);
	await owner.unsafe(`
		do $$ begin
			if not exists (select 1 from pg_roles where rolname = 'bite_api_test') then
				create role bite_api_test login password 'api_test' in role bite_app;
			end if;
		end $$;`);
	await owner.unsafe(`
		do $$ begin
			if not exists (select 1 from pg_roles where rolname = 'bite_system_test') then
				create role bite_system_test login bypassrls password 'system_test' in role bite_system;
			end if;
			alter role bite_system_test bypassrls;
		end $$;`);
	const sysUrl = new URL(url);
	sysUrl.username = "bite_system_test";
	sysUrl.password = "system_test";
	const sys = createDb(sysUrl.toString(), { max: 2, onnotice: () => {} });
	const u = new URL(url);
	u.username = "bite_api_test";
	u.password = "api_test";
	const conn = createDb(u.toString(), { max: 4, onnotice: () => {} });
	const db: Db = conn.db;

	const A = await seedTenant(ownerDb, "a");
	const B = await seedTenant(ownerDb, "b");

	const realtime = new RealtimeHub(10);
	await realtime.start((channel, fn) => conn.client.listen(channel, fn));
	const auth = createAuth(db, {
		secret: "test-auth-secret-test-auth-secret!!",
		baseURL: "http://localhost",
		trustedOrigins: [ADMIN_ORIGIN],
	});
	const deps: Deps = {
		realtime,
		auth,
		adminOrigins: [ADMIN_ORIGIN],
		db,
		staffTokenSecret: "test-secret-test-secret-test-secret!",
		pinLimiter: new PinLimiter(),
	};
	const app = createApp(deps);
	const logins = {
		A: await seedLogins(app, ownerDb, A),
		B: await seedLogins(app, ownerDb, B),
	};

	return {
		app,
		deps,
		owner,
		ownerDb,
		/** bite_system login (cross-tenant), for jobs. */
		systemDb: sys.db,
		systemUrl: sysUrl.toString(),
		A,
		B,
		/** Cookie headers for back-office logins, per tenant. */
		logins,
		async close() {
			await realtime.close();
			await conn.client.end();
			await sys.client.end();
			await owner.end();
		},
	};
}

/** Sign up through the real Better Auth endpoint; returns a Cookie header. */
export async function signUp(
	app: {
		request: (path: string, init: RequestInit) => Promise<Response> | Response;
	},
	email: string,
	name: string,
) {
	const res = await app.request(
		"/v1/auth/sign-up/email",
		json({ email, name, password: PASSWORD }, { origin: ADMIN_ORIGIN }),
	);
	if (res.status !== 200) {
		throw new Error(`sign-up ${email}: ${res.status} ${await res.text()}`);
	}
	const { user } = (await res.json()) as { user: { id: string } };
	return { userId: user.id, cookie: cookieOf(res) };
}

export function cookieOf(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

/**
 * Back-office logins per tenant: the owner (org-wide), the location manager
 * (manages only `loc`), and the cashier (floor role, must get 403).
 */
async function seedLogins(
	app: Parameters<typeof signUp>[0],
	ownerDb: Db,
	t: Tenant,
) {
	const slug = t.org.slice(-6);
	const owner = await signUp(app, `owner-${slug}@test.bite`, "Owner");
	const manager = await signUp(app, `manager-${slug}@test.bite`, "Manager");
	const cashier = await signUp(app, `cashier-${slug}@test.bite`, "Cashier");
	const ownerMember = uuidv7();
	await ownerDb.insert(s.members).values({
		id: ownerMember,
		orgId: t.org,
		userId: owner.userId,
		displayName: "Owner",
		orgRole: "owner",
	});
	await ownerDb
		.update(s.members)
		.set({ userId: manager.userId })
		.where(eq(s.members.id, t.manager));
	await ownerDb
		.update(s.members)
		.set({ userId: cashier.userId })
		.where(eq(s.members.id, t.cashier));
	const h = (cookie: string) => ({ cookie, origin: ADMIN_ORIGIN });
	return {
		ownerMember,
		owner: h(owner.cookie),
		manager: h(manager.cookie),
		cashier: h(cashier.cookie),
	};
}

export type Harness = Awaited<ReturnType<typeof setupHarness>>;

export const json = (body: unknown, headers: Record<string, string> = {}) => ({
	method: "POST",
	headers: { "content-type": "application/json", ...headers },
	body: JSON.stringify(body),
});

export const bearer = (t: Tenant) => ({
	authorization: `Bearer ${t.deviceToken}`,
});

export async function staffLogin(h: Harness, t: Tenant, memberId: string) {
	const res = await h.app.request(
		"/v1/device/pin-login",
		json({ memberId, pin: PIN }, bearer(t)),
	);
	if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
	const body = (await res.json()) as { staffToken: string };
	return { ...bearer(t), "x-staff-token": body.staffToken };
}

export { uuidv7 };
