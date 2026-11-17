import { sql } from "@bite/db/orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ADMIN_ORIGIN,
	cookieOf,
	type Harness,
	json,
	ownerUrl,
	PASSWORD,
	setupHarness,
	signUp,
	uuidv7,
} from "./harness.js";

describe.runIf(ownerUrl)("back-office auth", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	const me = (headers: Record<string, string>) =>
		h.app.request("/v1/admin/me", { headers });

	it("signs in with email + password and rejects a wrong password", async () => {
		const email = `owner-${h.A.org.slice(-6)}@test.bite`;
		const ok = await h.app.request(
			"/v1/auth/sign-in/email",
			json({ email, password: PASSWORD }, { origin: ADMIN_ORIGIN }),
		);
		expect(ok.status).toBe(200);
		const res = await me({ cookie: cookieOf(ok) });
		expect(res.status).toBe(200);

		const bad = await h.app.request(
			"/v1/auth/sign-in/email",
			json({ email, password: "wrong password!" }, { origin: ADMIN_ORIGIN }),
		);
		expect(bad.status).toBe(401);
	});

	it("stores argon2id password hashes, not the password", async () => {
		const rows = await h.owner<{ password: string }[]>`
			select password from auth_accounts where password is not null limit 1`;
		expect(rows[0]?.password).toMatch(/^\$argon2id\$/);
	});

	it("401 without a session", async () => {
		const res = await me({});
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({
			error: { code: "unauthenticated" },
		});
	});

	it("owner sees the whole org as manager", async () => {
		const res = await me(h.logins.A.owner);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			member: { orgRole: string; email: string };
			org: { id: string };
			locations: { location: { id: string }; role: string }[];
		};
		expect(body.org.id).toBe(h.A.org);
		expect(body.member.orgRole).toBe("owner");
		expect(body.member.email).toMatch(/^owner-/);
		expect(body.locations.map((l) => l.location.id).sort()).toEqual(
			[h.A.loc, h.A.otherLoc].sort(),
		);
		expect(new Set(body.locations.map((l) => l.role))).toEqual(
			new Set(["manager"]),
		);
	});

	it("a location manager sees only the locations they belong to", async () => {
		const body = (await (await me(h.logins.A.manager)).json()) as {
			member: { orgRole: string };
			locations: { location: { id: string }; role: string }[];
		};
		expect(body.member.orgRole).toBe("staff");
		expect(body.locations).toEqual([
			expect.objectContaining({
				location: expect.objectContaining({ id: h.A.loc }),
				role: "manager",
			}),
		]);
	});

	it("floor roles get 403", async () => {
		const res = await me(h.logins.A.cashier);
		expect(res.status).toBe(403);
	});

	it("a login with no membership gets 403", async () => {
		const { cookie } = await signUp(h.app, "nobody@test.bite", "Nobody");
		const res = await me({ cookie });
		expect(res.status).toBe(403);
	});

	it("deactivating a member locks them out on the next request", async () => {
		const { cookie, userId } = await signUp(h.app, "temp@test.bite", "Temp");
		const id = uuidv7();
		await h.owner`
			insert into members (id, org_id, user_id, display_name, org_role)
			values (${id}, ${h.A.org}, ${userId}, 'Temp', 'admin')`;
		expect((await me({ cookie })).status).toBe(200);
		await h.owner`update members set is_active = false where id = ${id}`;
		expect((await me({ cookie })).status).toBe(403);
	});

	describe("onboarding + org switching", () => {
		let cookie: string;
		let first: { orgId: string; locationId: string; memberId: string };

		const create = (body: Record<string, unknown>) =>
			h.app.request(
				"/v1/account/orgs",
				json(body, { cookie, origin: ADMIN_ORIGIN }),
			);

		beforeAll(async () => {
			({ cookie } = await signUp(h.app, "founder@test.bite", "Founder"));
		});

		it("creates an org, its first location and the owner", async () => {
			const res = await create({
				orgName: "Karak House",
				orgSlug: "karak-house",
				locationName: "Qurum",
				locationSlug: "karak-qurum",
			});
			expect(res.status).toBe(201);
			first = (await res.json()) as typeof first;
			const body = (await (await me({ cookie })).json()) as {
				org: { id: string; slug: string };
				member: { orgRole: string };
				locations: { location: { id: string } }[];
			};
			expect(body.org).toMatchObject({ id: first.orgId, slug: "karak-house" });
			expect(body.member.orgRole).toBe("owner");
			expect(body.locations.map((l) => l.location.id)).toEqual([
				first.locationId,
			]);
			const [loc] = await h.owner<{ timezone: string }[]>`
				select timezone from locations where id = ${first.locationId}`;
			expect(loc?.timezone).toBe("Asia/Muscat");
		});

		it("409 on a taken slug, and nothing is half-created", async () => {
			const res = await create({
				orgName: "Copycat",
				orgSlug: "copycat",
				locationName: "Main",
				locationSlug: "karak-qurum",
			});
			expect(res.status).toBe(409);
			expect(await res.json()).toMatchObject({
				error: { code: "conflict", details: { field: "locationSlug" } },
			});
			const rows = await h.owner`select 1 from orgs where slug = 'copycat'`;
			expect(rows.length).toBe(0);
		});

		it("rejects bad slugs", async () => {
			const res = await create({
				orgName: "X",
				orgSlug: "Not A Slug",
				locationName: "Main",
				locationSlug: "fine-slug",
			});
			expect(res.status).toBe(400);
		});

		it("with two orgs, /v1/admin needs X-Org-Id", async () => {
			const res = await create({
				orgName: "Second",
				orgSlug: "second-org",
				locationName: "Main",
				locationSlug: "second-main",
			});
			const second = (await res.json()) as { orgId: string };

			const list = (await (
				await h.app.request("/v1/account/orgs", { headers: { cookie } })
			).json()) as { items: { id: string; orgRole: string }[] };
			expect(list.items.map((o) => o.id).sort()).toEqual(
				[first.orgId, second.orgId].sort(),
			);

			const ambiguous = await me({ cookie });
			expect(ambiguous.status).toBe(400);

			const picked = (await (
				await me({ cookie, "x-org-id": second.orgId })
			).json()) as { org: { id: string } };
			expect(picked.org.id).toBe(second.orgId);
		});
	});

	it("CORS: the admin origin gets credentials, others get nothing", async () => {
		const pre = (origin: string) =>
			h.app.request("/v1/admin/me", {
				method: "OPTIONS",
				headers: {
					origin,
					"access-control-request-method": "GET",
					"access-control-request-headers": "x-org-id",
				},
			});
		const ok = await pre(ADMIN_ORIGIN);
		expect(ok.headers.get("access-control-allow-origin")).toBe(ADMIN_ORIGIN);
		expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
		const evil = await pre("https://evil.example");
		expect(evil.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("the app role cannot read webhook_events", async () => {
		// 42501 = insufficient_privilege
		await expect(
			h.deps.db.execute(sql`select 1 from webhook_events`),
		).rejects.toMatchObject({ cause: { code: "42501" } });
	});
});
