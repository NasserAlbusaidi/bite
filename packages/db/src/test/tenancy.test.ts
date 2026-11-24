import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db, withTenant } from "../client.js";
import { runMigrations } from "../migrate.js";
import * as s from "../schema/index.js";

/**
 * Needs a throwaway Postgres. TEST_DATABASE_URL must be the schema owner
 * (with CREATEROLE). CI provides one; locally:
 *   TEST_DATABASE_URL=postgres://bite_owner:owner@localhost/bite_test
 */
const ownerUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !ownerUrl) {
	throw new Error(
		"TEST_DATABASE_URL is required in CI; tenancy tests must not skip",
	);
}

/** Drizzle wraps driver errors; match against the Postgres error underneath. */
async function expectPgError(p: Promise<unknown>, re: RegExp): Promise<void> {
	const err = await p.then(
		() => {
			throw new Error(`expected rejection matching ${re}`);
		},
		(e: unknown) => e,
	);
	const cause = (
		err as { cause?: { message?: string; constraint_name?: string } }
	).cause;
	const text = [
		(err as Error).message,
		cause?.message,
		cause?.constraint_name,
	].join(" | ");
	expect(text).toMatch(re);
}

describe.runIf(ownerUrl)("tenancy (RLS + composite FKs)", () => {
	const url = ownerUrl as string;
	const owner = postgres(url, { max: 1, onnotice: () => {} });
	const ownerDb = drizzle(owner, { schema: s });
	let app: ReturnType<typeof createDb>;
	let db: Db;

	const A = { org: uuidv7(), loc: uuidv7(), cat: uuidv7(), prod: uuidv7() };
	const B = { org: uuidv7(), loc: uuidv7(), cat: uuidv7(), prod: uuidv7() };

	beforeAll(async () => {
		await owner.unsafe(
			"drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
		);
		await owner.file(
			new URL("../../sql/bootstrap-roles.sql", import.meta.url).pathname,
		);
		await runMigrations(url);
		await owner.unsafe(`
			do $$ begin
				if not exists (select 1 from pg_roles where rolname = 'bite_app_test') then
					create role bite_app_test login password 'app_test' in role bite_app;
				end if;
			end $$;`);
		const u = new URL(url);
		u.username = "bite_app_test";
		u.password = "app_test";
		app = createDb(u.toString(), { max: 2, onnotice: () => {} });
		db = app.db;

		for (const [t, slug] of [
			[A, "a"],
			[B, "b"],
		] as const) {
			await ownerDb.insert(s.orgs).values({ id: t.org, name: slug, slug });
			await ownerDb
				.insert(s.locations)
				.values({ id: t.loc, orgId: t.org, name: slug, slug: `${slug}-main` });
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
		}
	});

	afterAll(async () => {
		await app?.client.end();
		await owner.end();
	});

	it("sees only its own org's rows", async () => {
		const rows = await withTenant(db, A.org, (tx) =>
			tx.select().from(s.products),
		);
		expect(rows.map((r) => r.id)).toEqual([A.prod]);
		const orgs = await withTenant(db, A.org, (tx) => tx.select().from(s.orgs));
		expect(orgs.map((o) => o.id)).toEqual([A.org]);
	});

	it("fails closed with no tenant context", async () => {
		const rows = await db.select().from(s.products);
		expect(rows).toEqual([]);
	});

	it("cannot read another tenant's row by id", async () => {
		const rows = await withTenant(db, A.org, (tx) =>
			tx.select().from(s.products).where(eq(s.products.id, B.prod)),
		);
		expect(rows).toEqual([]);
	});

	it("cannot update or delete another tenant's rows", async () => {
		await withTenant(db, A.org, async (tx) => {
			await tx
				.update(s.products)
				.set({ price: 1 })
				.where(eq(s.products.id, B.prod));
			await tx.delete(s.products).where(eq(s.products.id, B.prod));
		});
		const [b] = await ownerDb
			.select()
			.from(s.products)
			.where(eq(s.products.id, B.prod));
		expect(b?.price).toBe(1500);
	});

	it("cannot insert rows into another tenant", async () => {
		await expectPgError(
			withTenant(db, A.org, (tx) =>
				tx.insert(s.categories).values({ orgId: B.org, name: { en: "x" } }),
			),
			/row-level security/,
		);
	});

	it("cannot reference another tenant's parent row, even as owner", async () => {
		await expectPgError(
			ownerDb.insert(s.products).values({
				orgId: A.org,
				categoryId: B.cat,
				name: { en: "smuggled" },
				price: 100,
			}),
			/foreign key/,
		);
	});

	it("rejects an invalid tenant id before touching the database", async () => {
		await expectPgError(
			withTenant(db, "' or 1=1 --", async () => 1),
			/invalid org id/,
		);
	});

	it("keeps the audit log append-only", async () => {
		await withTenant(db, A.org, (tx) =>
			tx.insert(s.auditLog).values({ orgId: A.org, action: "test" }),
		);
		await expectPgError(
			withTenant(db, A.org, (tx) =>
				tx.update(s.auditLog).set({ action: "tampered" }),
			),
			/permission denied/,
		);
	});

	it("blocks the app role from webhook_events", async () => {
		await expectPgError(db.select().from(s.webhookEvents), /permission denied/);
	});

	describe("billing state is read-only for the app role", () => {
		beforeAll(async () => {
			for (const t of [A, B]) {
				await ownerDb.insert(s.billingSubscriptions).values({
					orgId: t.org,
					provider: "manual",
					plan: "essentials",
					status: "active",
				});
			}
		});

		it("reads only its own subscription", async () => {
			const rows = await withTenant(db, A.org, (tx) =>
				tx.select().from(s.billingSubscriptions),
			);
			expect(rows.map((r) => r.orgId)).toEqual([A.org]);
		});

		it("cannot grant itself a plan", async () => {
			await expectPgError(
				withTenant(db, A.org, (tx) =>
					tx.insert(s.billingSubscriptions).values({
						orgId: A.org,
						provider: "manual",
						plan: "pro",
						status: "active",
					}),
				),
				/permission denied/,
			);
			await expectPgError(
				withTenant(db, A.org, (tx) =>
					tx.update(s.billingSubscriptions).set({ plan: "pro" }),
				),
				/permission denied/,
			);
			await expectPgError(
				withTenant(db, A.org, (tx) => tx.delete(s.billingSubscriptions)),
				/permission denied/,
			);
		});

		it("cannot extend its own trial, lift a suspension or set overrides", async () => {
			for (const set of [
				{ trialEndsAt: new Date("2099-01-01T00:00:00Z") },
				{ status: "active" as const },
				{ entitlementOverrides: { plan: "pro" } },
			]) {
				await expectPgError(
					withTenant(db, A.org, (tx) =>
						tx.update(s.orgs).set(set).where(eq(s.orgs.id, A.org)),
					),
					/permission denied/,
				);
			}
		});

		it("can still rename its own org", async () => {
			const [row] = await withTenant(db, A.org, (tx) =>
				tx
					.update(s.orgs)
					.set({ name: "a renamed" })
					.where(eq(s.orgs.id, A.org))
					.returning({ name: s.orgs.name }),
			);
			expect(row?.name).toBe("a renamed");
		});
	});

	describe("money ledger constraints", () => {
		const order = uuidv7();
		const device = uuidv7();
		const member = uuidv7();

		beforeAll(async () => {
			await withTenant(db, A.org, async (tx) => {
				await tx
					.insert(s.members)
					.values({ id: member, orgId: A.org, displayName: "Sara" });
				await tx.insert(s.devices).values({
					id: device,
					orgId: A.org,
					locationId: A.loc,
					name: "Till 1",
					kind: "pos",
					ticketPrefix: "A",
					tokenHash: "x",
				});
				await tx.insert(s.orders).values({
					id: order,
					orgId: A.org,
					locationId: A.loc,
					deviceId: device,
					ticketNumber: "A-001",
					businessDate: "2026-11-17",
					source: "counter",
					pricesIncludeTax: true,
					subtotal: 1500,
					taxTotal: 71,
					total: 1500,
				});
			});
		});

		const pay = (v: Partial<typeof s.payments.$inferInsert>) =>
			withTenant(db, A.org, (tx) =>
				tx.insert(s.payments).values({
					orgId: A.org,
					locationId: A.loc,
					orderId: order,
					amount: 1500,
					method: "card",
					businessDate: "2026-11-17",
					...v,
				}),
			);

		it("requires a cash session for cash", async () => {
			await expectPgError(
				pay({ method: "cash" }),
				/payments_cash_needs_session/,
			);
		});

		it("requires a refund to point at the payment it reverses", async () => {
			await expectPgError(pay({ amount: -500 }), /payments_refund_shape/);
		});

		it("allows one open cash session per device", async () => {
			const open = () =>
				withTenant(db, A.org, (tx) =>
					tx.insert(s.cashSessions).values({
						orgId: A.org,
						locationId: A.loc,
						deviceId: device,
						businessDate: "2026-11-17",
						openedBy: member,
						openingFloat: 20000,
					}),
				);
			await open();
			await expectPgError(open(), /cash_sessions_one_open_per_device/);
		});

		it("rejects duplicate ticket numbers on the same day", async () => {
			await expectPgError(
				withTenant(db, A.org, (tx) =>
					tx.insert(s.orders).values({
						orgId: A.org,
						locationId: A.loc,
						ticketNumber: "A-001",
						businessDate: "2026-11-17",
						source: "counter",
						pricesIncludeTax: true,
						subtotal: 0,
						taxTotal: 0,
						total: 0,
					}),
				),
				/orders_ticket_uq/,
			);
		});
	});

	it("has RLS enabled on every tenant table", async () => {
		const rows = await owner<{ relname: string }[]>`
			select c.relname from pg_class c
			join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id'
			join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
			where c.relkind = 'r' and not c.relrowsecurity`;
		expect(rows.map((r) => r.relname)).toEqual([]);
	});

	it("only allowlisted global tables run without RLS", async () => {
		const rows = await owner<{ relname: string }[]>`
			select c.relname from pg_class c
			join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
			where c.relkind = 'r' and not c.relrowsecurity
			order by c.relname`;
		expect(rows.map((r) => r.relname)).toEqual([
			"auth_accounts",
			"auth_sessions",
			"auth_users",
			"auth_verifications",
			// Bite's own operators (platform console). Not tenant data; no
			// grants to bite_app at all, bite_system only (migration 0017).
			"platform_admins",
			// Provider webhooks land before a tenant is known; bite_system only.
			"webhook_events",
		]);
	});
});
