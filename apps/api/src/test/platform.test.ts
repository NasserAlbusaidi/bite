import { sql } from "@bite/db/orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import {
	ADMIN_ORIGIN,
	type Harness,
	ownerUrl,
	setupHarness,
	signUp,
} from "./harness.js";

type Row = {
	id: string;
	name: string;
	status: string;
	plan: string;
	planSource: string;
	ownerEmail: string | null;
	locationCount: number;
	usage: { orders30d: number; devices: number };
};

describe.runIf(ownerUrl)("platform console", () => {
	let h: Harness;
	let app: ReturnType<typeof createApp>;
	let op: Record<string, string>;
	beforeAll(async () => {
		h = await setupHarness();
		app = createApp({ ...h.deps, systemDb: h.systemDb });
		const s = await signUp(app, "ops@bite.test", "Ops");
		await h.owner`insert into platform_admins (user_id) values (${s.userId})`;
		op = { cookie: s.cookie, origin: ADMIN_ORIGIN };
	});
	afterAll(() => h?.close());

	const call = (
		who: Record<string, string>,
		method: string,
		path: string,
		body?: unknown,
		extra: Record<string, string> = {},
	) =>
		app.request(path, {
			method,
			headers: { ...who, ...extra, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	const ok = async <T>(res: Response | Promise<Response>, status = 200) => {
		const r = await res;
		if (r.status !== status) throw new Error(`${r.status}: ${await r.text()}`);
		return (await r.json()) as T;
	};

	describe("who gets in", () => {
		it("hides the console from everyone but platform admins", async () => {
			expect((await call({}, "GET", "/v1/platform/me")).status).toBe(404);
			const owner = h.logins.A.owner;
			expect((await call(owner, "GET", "/v1/platform/me")).status).toBe(404);
			expect((await call(owner, "GET", "/v1/platform/orgs")).status).toBe(404);
			const b = h.logins.B.owner;
			expect(
				(
					await call(b, "POST", `/v1/platform/orgs/${h.A.org}/status`, {
						status: "suspended",
					})
				).status,
			).toBe(404);
		});

		it("is off when the API has no system connection", async () => {
			const res = await h.app.request("/v1/platform/me", { headers: op });
			expect(res.status).toBe(404);
		});

		it("lets a platform admin in", async () => {
			const me = await ok<{ email: string }>(
				call(op, "GET", "/v1/platform/me"),
			);
			expect(me.email).toBe("ops@bite.test");
		});

		it("keeps platform_admins away from the app role", async () => {
			const err = await h.deps.db
				.execute(sql`select * from platform_admins`)
				.catch((e: { cause?: { code?: string } }) => e);
			// 42501 insufficient_privilege
			expect((err as { cause?: { code?: string } }).cause?.code).toBe("42501");
		});
	});

	describe("orgs", () => {
		it("lists every org with usage and totals, and searches", async () => {
			const list = await ok<{
				items: Row[];
				totals: { orgs: number; locations: number };
			}>(call(op, "GET", "/v1/platform/orgs"));
			const ids = list.items.map((r) => r.id);
			expect(ids).toEqual(expect.arrayContaining([h.A.org, h.B.org]));
			const a = list.items.find((r) => r.id === h.A.org) as Row;
			expect(a.locationCount).toBe(2);
			expect(a.usage.devices).toBe(1);
			expect(a.ownerEmail).toMatch(/^owner-/);
			expect(list.totals.orgs).toBeGreaterThanOrEqual(2);

			const found = await ok<{ items: Row[] }>(
				call(op, "GET", "/v1/platform/orgs?q=a%20two"),
			);
			expect(found.items.map((r) => r.id)).toEqual([h.A.org]);
		});

		it("shows one org with its branches, people and plan", async () => {
			const d = await ok<{
				locations: { id: string }[];
				members: { orgRole: string }[];
				entitlements: { plan: string };
			}>(call(op, "GET", `/v1/platform/orgs/${h.B.org}`));
			expect(d.locations.map((l) => l.id)).toContain(h.B.loc);
			expect(d.members.some((m) => m.orgRole === "owner")).toBe(true);
			expect(d.entitlements.plan).toBe("free");
			expect(
				(await call(op, "GET", "/v1/platform/orgs/not-a-uuid")).status,
			).toBe(404);
		});

		it("sets a plan and takes it away again", async () => {
			let d = await ok<Row>(
				call(op, "POST", `/v1/platform/orgs/${h.B.org}/plan`, {
					plan: "pro",
					note: "founding customer",
				}),
			);
			expect([d.plan, d.planSource]).toEqual(["pro", "subscription"]);
			d = await ok<Row>(
				call(op, "POST", `/v1/platform/orgs/${h.B.org}/plan`, {
					plan: "essentials",
				}),
			);
			expect(d.plan).toBe("essentials");
			d = await ok<Row>(
				call(op, "POST", `/v1/platform/orgs/${h.B.org}/plan`, { plan: "free" }),
			);
			expect(d.plan).toBe("free");
		});

		it("extends a trial", async () => {
			const d = await ok<Row>(
				call(op, "POST", `/v1/platform/orgs/${h.B.org}/trial`, { days: 14 }),
			);
			expect([d.status, d.plan, d.planSource]).toEqual([
				"trial",
				"pro",
				"trial",
			]);
		});

		it("suspends an org (its back office stops working) and reactivates it", async () => {
			const owner = h.logins.B.owner;
			expect((await call(owner, "GET", "/v1/admin/me")).status).toBe(200);
			await ok(
				call(op, "POST", `/v1/platform/orgs/${h.B.org}/status`, {
					status: "suspended",
					note: "unpaid",
				}),
			);
			expect((await call(owner, "GET", "/v1/admin/me")).status).toBe(403);
			const d = await ok<{ status: string; activity: { action: string }[] }>(
				call(op, "POST", `/v1/platform/orgs/${h.B.org}/status`, {
					status: "active",
				}),
			);
			expect(d.status).toBe("active");
			expect((await call(owner, "GET", "/v1/admin/me")).status).toBe(200);
			const actions = d.activity.map((a) => a.action);
			expect(actions).toEqual(
				expect.arrayContaining([
					"platform.status_changed",
					"platform.plan_set",
					"platform.trial_set",
				]),
			);
		});

		it("creates a restaurant whose owner joins through the invite", async () => {
			const created = await ok<{
				orgId: string;
				locationId: string;
				inviteToken: string;
			}>(
				call(op, "POST", "/v1/platform/orgs", {
					orgName: "Shuwa House",
					orgSlug: "shuwa-house",
					locationName: "Shuwa House Seeb",
					locationSlug: "shuwa-seeb",
					ownerName: "Salim",
					ownerEmail: "Salim@Shuwa.test",
				}),
				201,
			);
			const dup = await call(op, "POST", "/v1/platform/orgs", {
				orgName: "Other",
				orgSlug: "shuwa-house",
				locationName: "x",
				locationSlug: "other-x",
				ownerName: "x",
				ownerEmail: "x@x.test",
			});
			expect(dup.status).toBe(409);

			const salim = await signUp(app, "salim@shuwa.test", "Salim");
			const who = { cookie: salim.cookie, origin: ADMIN_ORIGIN };
			await ok(
				call(who, "POST", "/v1/account/invites/accept", {
					token: created.inviteToken,
				}),
			);
			const me = await ok<{
				member: { orgRole: string };
				org: { id: string };
				locations: { location: { id: string } }[];
			}>(call(who, "GET", "/v1/admin/me"));
			expect(me.org.id).toBe(created.orgId);
			expect(me.member.orgRole).toBe("owner");
			expect(me.locations.map((l) => l.location.id)).toEqual([
				created.locationId,
			]);
			const d = await ok<Row>(
				call(op, "GET", `/v1/platform/orgs/${created.orgId}`),
			);
			expect([d.status, d.plan]).toEqual(["trial", "pro"]);
		});
	});

	describe("support view", () => {
		it("opens any org's back office read-only and logs the visit", async () => {
			const org = { "x-org-id": h.A.org };
			const me = await ok<{ support?: boolean; org: { id: string } }>(
				call(op, "GET", "/v1/admin/me", undefined, org),
			);
			expect(me.support).toBe(true);
			expect(me.org.id).toBe(h.A.org);
			const staff = await ok<{ items: { id: string }[] }>(
				call(op, "GET", "/v1/admin/staff", undefined, org),
			);
			expect(staff.items.map((s) => s.id)).toContain(h.A.cashier);
			const write = await call(
				op,
				"POST",
				"/v1/admin/categories",
				{ name: { en: "Nope" } },
				org,
			);
			expect(write.status).toBe(403);
			const d = await ok<{ activity: { action: string }[] }>(
				call(op, "GET", `/v1/platform/orgs/${h.A.org}`),
			);
			expect(d.activity.map((a) => a.action)).toContain(
				"platform.support_view",
			);
		});

		it("gives an ordinary login nothing from another org", async () => {
			const res = await call(
				h.logins.A.owner,
				"GET",
				"/v1/admin/me",
				undefined,
				{ "x-org-id": h.B.org },
			);
			expect(res.status).toBe(403);
		});

		it("is off without the system connection", async () => {
			const res = await h.app.request("/v1/admin/me", {
				headers: { ...op, "x-org-id": h.A.org },
			});
			expect(res.status).toBe(403);
		});
	});
});
