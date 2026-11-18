/**
 * Local development setup. Idempotent: safe to run again.
 *
 *   1. Writes .env files for api, admin and menu if they are missing.
 *   2. Creates the database, the bite_app / bite_system groups and two
 *      dev logins (bite_api, bite_worker), then runs the migrations.
 *   3. Seeds a demo org (menu, staff with PINs, a POS and a KDS device,
 *      an owner login) unless it is already there.
 *   4. Prints every URL and credential, and saves them to .dev-credentials.txt.
 *
 * Dev only. Never run this against a shared or production database.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { createDb, schema as s } from "@bite/db";
import { runMigrations } from "@bite/db/migrate";
import { eq } from "@bite/db/orm";
import { hash } from "@node-rs/argon2";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { createAuth } from "../auth/better-auth.js";
import { newSecret, sha256 } from "../lib/tokens.js";

const root = (p: string) =>
	fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

const OWNER_URL =
	process.env.DATABASE_OWNER_URL ??
	"postgres://postgres:postgres@localhost:5432/bite";
const API_PORT = 3000;
const ADMIN_PORT = 5173;
const MENU_PORT = 5174;
const POS_PORT = 5175;

const OWNER_EMAIL = "owner@demo.bite";
const OWNER_PASSWORD = "demo-owner-pass";
const SLUG = "demo-cafe";

function lanIps(): string[] {
	return Object.values(networkInterfaces())
		.flat()
		.filter(
			(i) =>
				i &&
				i.family === "IPv4" &&
				!i.internal &&
				/^192\.168\./.test(i.address),
		)
		.map((i) => (i as { address: string }).address);
}

function writeIfMissing(path: string, body: string) {
	try {
		// "wx": create only, atomically; never overwrite an existing env file.
		writeFileSync(path, body, { flag: "wx" });
		console.log(`wrote  ${path}`);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		console.log(`keep   ${path}`);
	}
}

function dbUrl(user: string, password: string): string {
	const u = new URL(OWNER_URL);
	u.username = user;
	u.password = password;
	return u.toString();
}

function writeEnvFiles() {
	const origins = [
		`http://localhost:${ADMIN_PORT}`,
		...lanIps().map((ip) => `http://${ip}:${ADMIN_PORT}`),
	];
	writeIfMissing(
		root("apps/api/.env"),
		[
			"# Written by `pnpm dev:setup`. Dev only.",
			`DATABASE_URL=${dbUrl("bite_api", "bite_api")}`,
			`WORKER_DATABASE_URL=${dbUrl("bite_worker", "bite_worker")}`,
			`STAFF_TOKEN_SECRET=${randomBytes(32).toString("base64url")}`,
			`BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
			`PUBLIC_API_URL=http://localhost:${API_PORT}`,
			`ADMIN_ORIGINS=${origins.join(",")}`,
			`PORT=${API_PORT}`,
			"",
		].join("\n"),
	);
	// The admin dev server proxies /v1 to the API, so the API is same-origin
	// ("/") and the session cookie needs no cross-site settings.
	// VITE_PAIRING_API_URL: what the tablet-pairing QR points at. In dev the
	// POS can only reach the API through its own https dev server.
	const posHost = lanIps()[0] ?? "localhost";
	writeIfMissing(
		root("apps/admin/.env.local"),
		[
			"VITE_API_URL=/",
			`VITE_MENU_URL=http://${posHost}:${MENU_PORT}`,
			`VITE_PAIRING_API_URL=https://${posHost}:${POS_PORT}`,
			"",
		].join("\n"),
	);
	writeIfMissing(
		root("apps/menu/.env"),
		`BITE_API_URL=http://localhost:${API_PORT}\nBITE_ADMIN_URL=http://localhost:${ADMIN_PORT}\n`,
	);
}

async function setupDatabase() {
	const target = new URL(OWNER_URL);
	const name = target.pathname.slice(1);
	const adminUrl = new URL(OWNER_URL);
	adminUrl.pathname = "/postgres";
	const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
	try {
		const [exists] =
			await admin`select 1 from pg_database where datname = ${name}`;
		if (!exists) await admin.unsafe(`create database "${name}"`);
	} finally {
		await admin.end();
	}

	const owner = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
	try {
		await owner.unsafe(
			readFileSync(root("packages/db/sql/bootstrap-roles.sql"), "utf8"),
		);
		await owner.unsafe(`
			do $$ begin
				if not exists (select 1 from pg_roles where rolname = 'bite_api') then
					create role bite_api login password 'bite_api' in role bite_app;
				end if;
				if not exists (select 1 from pg_roles where rolname = 'bite_worker') then
					create role bite_worker login bypassrls password 'bite_worker' in role bite_system;
				end if;
			end $$;`);
	} finally {
		await owner.end();
	}
	await runMigrations(OWNER_URL);
	console.log("db     roles + migrations ok");
}

type Seeded = {
	posToken: string;
	kdsToken: string;
	staff: { name: string; role: string; pin: string }[];
};

async function seed(): Promise<Seeded | undefined> {
	const ownerConn = createDb(OWNER_URL, { max: 1, onnotice: () => {} });
	const o = ownerConn.db;
	try {
		const [existing] = await o
			.select({ id: s.locations.id })
			.from(s.locations)
			.where(eq(s.locations.slug, SLUG));
		if (existing) {
			console.log("seed   demo org already there, skipped");
			return undefined;
		}

		// Sign the owner up through Better Auth, like the real flow does.
		const api = createDb(dbUrl("bite_api", "bite_api"), { max: 1 });
		let userId: string;
		try {
			const auth = createAuth(api.db, {
				secret: randomBytes(32).toString("base64url"),
				baseURL: `http://localhost:${API_PORT}`,
				trustedOrigins: [],
			});
			const [user] = await o
				.select({ id: s.authUsers.id })
				.from(s.authUsers)
				.where(eq(s.authUsers.email, OWNER_EMAIL));
			userId =
				user?.id ??
				(
					await auth.api.signUpEmail({
						body: {
							email: OWNER_EMAIL,
							password: OWNER_PASSWORD,
							name: "Demo Owner",
						},
					})
				).user.id;
		} finally {
			await api.client.end();
		}

		const org = uuidv7();
		const loc = uuidv7();
		const posToken = newSecret("dev_");
		const kdsToken = newSecret("dev_");
		const staff = [
			{ id: uuidv7(), name: "Demo Owner", role: "manager", pin: "1234" },
			{ id: uuidv7(), name: "Sara (cashier)", role: "cashier", pin: "1111" },
			{ id: uuidv7(), name: "Ali (kitchen)", role: "kitchen", pin: "2222" },
		] as const;

		await o.transaction(async (tx) => {
			await tx.insert(s.orgs).values({
				id: org,
				name: "Demo Cafe",
				slug: "demo",
				status: "active",
			});
			await tx.insert(s.locations).values({
				id: loc,
				orgId: org,
				name: "Demo Cafe Muscat",
				slug: SLUG,
				taxBps: 500,
			});
			await tx.insert(s.devices).values([
				{
					orgId: org,
					locationId: loc,
					name: "Front till",
					kind: "pos",
					ticketPrefix: "A",
					tokenHash: sha256(posToken),
				},
				{
					orgId: org,
					locationId: loc,
					name: "Kitchen screen",
					kind: "kds",
					ticketPrefix: "K",
					tokenHash: sha256(kdsToken),
				},
			]);
			for (const [i, m] of staff.entries()) {
				await tx.insert(s.members).values({
					id: m.id,
					orgId: org,
					userId: i === 0 ? userId : null,
					displayName: m.name,
					orgRole: i === 0 ? "owner" : "staff",
					pinHash: await hash(m.pin),
				});
				await tx.insert(s.memberLocations).values({
					orgId: org,
					memberId: m.id,
					locationId: loc,
					role: m.role,
				});
			}

			const menu: [{ en: string; ar: string }, [string, string, number][]][] = [
				[
					{ en: "Coffee", ar: "قهوة" },
					[
						["Espresso", "إسبريسو", 900],
						["Latte", "لاتيه", 1500],
						["Cappuccino", "كابتشينو", 1400],
						["Karak", "كرك", 500],
					],
				],
				[
					{ en: "Food", ar: "طعام" },
					[
						["Chicken shawarma", "شاورما دجاج", 1200],
						["Halloumi sandwich", "ساندويتش حلوم", 1800],
						["Date cake", "كيكة التمر", 1350],
					],
				],
				[
					{ en: "Cold drinks", ar: "مشروبات باردة" },
					[
						["Fresh orange juice", "عصير برتقال طازج", 1600],
						["Water", "ماء", 200],
					],
				],
			];
			const products: Record<string, string> = {};
			for (const [ci, [cat, items]] of menu.entries()) {
				const catId = uuidv7();
				await tx
					.insert(s.categories)
					.values({ id: catId, orgId: org, name: cat, sortOrder: ci });
				for (const [pi, [en, ar, price]] of items.entries()) {
					const id = uuidv7();
					products[en] = id;
					await tx.insert(s.products).values({
						id,
						orgId: org,
						categoryId: catId,
						name: { en, ar },
						price,
						sortOrder: pi,
					});
				}
			}

			const group = uuidv7();
			await tx.insert(s.modifierGroups).values({
				id: group,
				orgId: org,
				name: { en: "Milk", ar: "الحليب" },
				minSelect: 0,
				maxSelect: 1,
			});
			await tx.insert(s.modifierOptions).values([
				{
					orgId: org,
					groupId: group,
					name: { en: "Oat", ar: "شوفان" },
					priceDelta: 300,
				},
				{
					orgId: org,
					groupId: group,
					name: { en: "Almond", ar: "لوز" },
					priceDelta: 300,
					sortOrder: 1,
				},
			]);
			for (const p of ["Latte", "Cappuccino"]) {
				await tx.insert(s.productModifierGroups).values({
					orgId: org,
					productId: products[p] as string,
					groupId: group,
				});
			}
		});
		console.log("seed   demo org created");
		return {
			posToken,
			kdsToken,
			staff: staff.map(({ name, role, pin }) => ({ name, role, pin })),
		};
	} finally {
		await ownerConn.client.end();
	}
}

function report(seeded: Seeded) {
	const ips = lanIps();
	const lan = (port: number, proto = "http") =>
		ips.map((ip) => `${proto}://${ip}:${port}`).join("  ");
	const text = `Bite local dev (written by \`pnpm dev:setup\`, dev only)

API          http://localhost:${API_PORT}/health
Back office  http://localhost:${ADMIN_PORT}   LAN: ${lan(ADMIN_PORT)}
  sign in    ${OWNER_EMAIL} / ${OWNER_PASSWORD}
Guest menu   http://localhost:${MENU_PORT}/${SLUG}
POS / KDS    https://localhost:${POS_PORT}   LAN: ${lan(POS_PORT, "https")}
  (self-signed cert: accept the browser warning once)
  pair POS   server URL = the POS page's own address, token below
  POS token  ${seeded.posToken}
  KDS token  ${seeded.kdsToken}
Staff PINs   ${seeded.staff.map((m) => `${m.name}: ${m.pin}`).join(", ")}
`;
	writeFileSync(root(".dev-credentials.txt"), text);
	console.log(`\n${text}\nSaved to .dev-credentials.txt`);
}

writeEnvFiles();
await setupDatabase();
const seeded = await seed();
if (seeded) report(seeded);
else if (existsSync(root(".dev-credentials.txt")))
	console.log(`\n${readFileSync(root(".dev-credentials.txt"), "utf8")}`);
