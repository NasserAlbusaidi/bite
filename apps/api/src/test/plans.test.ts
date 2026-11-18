import {
	Entitlements,
	ErrorBody,
	PlanFeature,
	PlanId,
	PlanLimitDetails,
	PlanLimits,
} from "@bite/contracts";
import {
	FEATURES,
	LIMIT_KEYS,
	PLAN_IDS,
	PLANS,
	resolveEntitlements,
	TRIAL_DAYS,
} from "@bite/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	ADMIN_ORIGIN,
	bearer,
	type Harness,
	json,
	ownerUrl,
	setupHarness,
	signUp,
	uuidv7,
} from "./harness.js";

const DAY = 86_400_000;

describe("plan contracts mirror the core catalog", () => {
	it("has the same plan, feature and limit keys", () => {
		expect([...PlanId.options]).toEqual([...PLAN_IDS]);
		expect([...PlanFeature.options].sort()).toEqual([...FEATURES].sort());
		expect(Object.keys(PlanLimits.shape).sort()).toEqual(
			[...LIMIT_KEYS].sort(),
		);
	});

	it("accepts whatever core resolves", () => {
		const now = new Date("2027-01-15T10:00:00Z");
		for (const enforce of [false, true]) {
			const e = resolveEntitlements({
				enforce,
				now,
				orgStatus: "trial",
				trialEndsAt: new Date(now.getTime() + DAY),
				subscription: { plan: "essentials", currentPeriodEnd: now },
			});
			expect(Entitlements.parse(e)).toEqual(e);
		}
	});
});

describe.runIf(ownerUrl)("plans and entitlements", () => {
	let h: Harness;
	const NOW = new Date("2027-03-10T09:00:00.000Z");
	const at = (days: number) => new Date(NOW.getTime() + days * DAY);
	// The owner connection takes timestamps as text.
	const iso = (d: Date) => d.toISOString();

	beforeAll(async () => {
		h = await setupHarness();
		h.deps.now = () => NOW;
	});
	afterAll(() => h?.close());
	beforeEach(async () => {
		// Each test starts enforced, with both tenants on the free plan.
		h.deps.planEnforcement = true;
		await h.owner`delete from billing_subscriptions`;
		await h.owner`
			update orgs set status = 'active', trial_ends_at = null,
				entitlement_overrides = null`;
	});

	const call = (t: "A" | "B", method: string, path: string, body?: unknown) =>
		h.app.request(`/v1/admin${path}`, {
			method,
			headers: { ...h.logins[t].owner, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	const me = async (t: "A" | "B" = "A") => {
		const res = await call(t, "GET", "/me");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { entitlements: unknown };
		return Entitlements.parse(body.entitlements);
	};
	const planLimit = async (res: Response | Promise<Response>) => {
		const r = await res;
		expect(r.status).toBe(402);
		const body = ErrorBody.parse(await r.json());
		expect(body.error.code).toBe("plan_limit");
		return PlanLimitDetails.parse(body.error.details);
	};
	const subscribe = (
		t: "A" | "B",
		plan: string,
		periodEnd: Date | null,
		status = "active",
	) => h.owner`
		insert into billing_subscriptions
			(id, org_id, provider, plan, status, current_period_end)
		values (${uuidv7()}, ${h[t].org}, 'manual', ${plan}, ${status}, ${periodEnd && iso(periodEnd)})`;
	const device = (
		t: "A" | "B",
		locationId: string,
		ticketPrefix: string,
		kind = "pos",
	) =>
		call(t, "POST", "/devices", {
			locationId,
			name: `Till ${ticketPrefix}`,
			kind,
			ticketPrefix,
		});

	describe("with enforcement off (the default)", () => {
		beforeEach(() => {
			h.deps.planEnforcement = false;
		});

		it("gives every org everything, unlimited", async () => {
			const e = await me();
			expect(e.source).toBe("unenforced");
			expect(e.plan).toBe("pro");
			expect(Object.values(e.features).every(Boolean)).toBe(true);
			expect(Object.values(e.limits).every((v) => v === null)).toBe(true);
		});

		it("does not limit devices, kitchen displays or old reports", async () => {
			expect((await device("A", h.A.loc, "X")).status).toBe(201);
			expect((await device("A", h.A.loc, "Y", "kds")).status).toBe(201);
			const res = await call(
				"A",
				"GET",
				`/reports/sales?locationId=${h.A.loc}&from=2026-01-01&to=2026-01-05`,
			);
			expect(res.status).toBe(200);
			// Tidy up so the enforced tests start from the seed's single till.
			await h.owner`
				update devices set revoked_at = now()
				where org_id = ${h.A.org} and ticket_prefix in ('X', 'Y')`;
		});

		it("sends entitlements on sync pull", async () => {
			const res = await h.app.request("/v1/sync/pull", {
				headers: bearer(h.A),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { entitlements: unknown };
			expect(Entitlements.parse(body.entitlements).source).toBe("unenforced");
		});
	});

	describe("resolving the plan", () => {
		it("is free with no trial, subscription or override", async () => {
			const e = await me();
			expect(e.plan).toBe("free");
			expect(e.source).toBe("free");
			expect(e.limits).toEqual(PLANS.free.limits);
			expect(e.validUntil).toBe(at(14).toISOString());
		});

		it("runs a trial until it ends", async () => {
			await h.owner`
				update orgs set status = 'trial', trial_ends_at = ${iso(at(3))}
				where id = ${h.A.org}`;
			const e = await me();
			expect(e.plan).toBe("pro");
			expect(e.source).toBe("trial");
			expect(e.trialEndsAt).toBe(at(3).toISOString());

			await h.owner`
				update orgs set trial_ends_at = ${iso(at(-1))} where id = ${h.A.org}`;
			expect((await me()).plan).toBe("free");
		});

		it("honours a paid subscription, then grace, then drops to free", async () => {
			await subscribe("A", "essentials", at(10));
			let e = await me();
			expect(e.plan).toBe("essentials");
			expect(e.source).toBe("subscription");
			expect(e.paidUntil).toBe(at(10).toISOString());

			await h.owner`update billing_subscriptions set current_period_end = ${iso(at(-5))}`;
			e = await me();
			expect(e.plan).toBe("essentials");
			expect(e.source).toBe("grace");
			expect(e.graceEndsAt).toBe(at(9).toISOString());

			await h.owner`update billing_subscriptions set current_period_end = ${iso(at(-15))}`;
			expect((await me()).plan).toBe("free");
		});

		it("gives a cancelled subscription its paid time but no grace", async () => {
			await subscribe("A", "pro", at(2), "canceled");
			expect((await me()).plan).toBe("pro");
			await h.owner`update billing_subscriptions set current_period_end = ${iso(at(-1))}`;
			expect((await me()).plan).toBe("free");
		});

		it("ignores subscriptions that never became active", async () => {
			await subscribe("A", "pro", at(30), "incomplete");
			expect((await me()).plan).toBe("free");
		});

		it("picks the subscription that runs longest", async () => {
			await subscribe("A", "essentials", at(-40));
			await subscribe("A", "pro", at(20));
			const e = await me();
			expect(e.plan).toBe("pro");
			expect(e.paidUntil).toBe(at(20).toISOString());
		});

		it("applies a hand-set override until it expires", async () => {
			const set = (o: object) => h.owner`
				update orgs set entitlement_overrides = ${JSON.stringify(o)}::jsonb
				where id = ${h.A.org}`;
			await set({ plan: "pro", expiresAt: at(1).toISOString() });
			let e = await me();
			expect(e.plan).toBe("pro");
			expect(e.source).toBe("override");

			await set({ plan: "pro", expiresAt: at(-1).toISOString() });
			expect((await me()).plan).toBe("free");

			await set({ features: { kds: true }, limits: { devicesPerLocation: 4 } });
			e = await me();
			expect(e.plan).toBe("free");
			expect(e.features.kds).toBe(true);
			expect(e.limits.devicesPerLocation).toBe(4);
		});

		it("never reads another tenant's subscription or override", async () => {
			await subscribe("B", "pro", at(30));
			await h.owner`
				update orgs set entitlement_overrides = '{"plan":"pro"}'::jsonb
				where id = ${h.B.org}`;
			expect((await me("B")).plan).toBe("pro");
			expect((await me("A")).plan).toBe("free");
		});

		it("sends the resolved plan to the tablet on sync pull", async () => {
			await subscribe("A", "essentials", at(10));
			const res = await h.app.request("/v1/sync/pull", {
				headers: bearer(h.A),
			});
			const body = (await res.json()) as { entitlements: unknown };
			const e = Entitlements.parse(body.entitlements);
			expect(e.plan).toBe("essentials");
			// B's tablet is unaffected.
			const resB = await h.app.request("/v1/sync/pull", {
				headers: bearer(h.B),
			});
			const bodyB = (await resB.json()) as { entitlements: unknown };
			expect(Entitlements.parse(bodyB.entitlements).plan).toBe("free");
		});
	});

	describe("limits", () => {
		it("caps devices per location, counting only live ones", async () => {
			// The seed has one till at loc. Free allows one.
			expect(await planLimit(device("A", h.A.loc, "B"))).toEqual({
				reason: "limit",
				limit: "devicesPerLocation",
				max: 1,
				plan: "free",
				upgradeTo: "essentials",
			});
			// Another location has its own allowance.
			expect((await device("A", h.A.otherLoc, "B")).status).toBe(201);
			expect((await planLimit(device("A", h.A.otherLoc, "C"))).reason).toBe(
				"limit",
			);

			// Essentials allows three.
			await subscribe("A", "essentials", at(10));
			expect((await device("A", h.A.loc, "B")).status).toBe(201);
			expect((await device("A", h.A.loc, "C")).status).toBe(201);
			const full = await planLimit(device("A", h.A.loc, "D"));
			expect(full).toMatchObject({ max: 3, upgradeTo: "pro" });

			// Revoking one frees the slot: replacing a broken tablet is free.
			await h.owner`
				update devices set revoked_at = now()
				where org_id = ${h.A.org} and location_id = ${h.A.loc}
					and ticket_prefix = 'C'`;
			expect((await device("A", h.A.loc, "D")).status).toBe(201);
		});

		it("two requests racing for the last slot cannot both win", async () => {
			await h.owner`
				update orgs set entitlement_overrides =
					'{"limits":{"devicesPerLocation":1}}'::jsonb
				where id = ${h.B.org}`;
			const [x, y] = await Promise.all([
				device("B", h.B.otherLoc, "X"),
				device("B", h.B.otherLoc, "Y"),
			]);
			expect([x.status, y.status].sort()).toEqual([201, 402]);
		});

		it("keeps kitchen displays for plans that include them", async () => {
			expect(await planLimit(device("B", h.B.otherLoc, "K", "kds"))).toEqual({
				reason: "feature",
				feature: "kds",
				plan: "free",
				upgradeTo: "essentials",
			});
			await subscribe("B", "essentials", at(10));
			// otherLoc already holds the till from the race test; essentials has room.
			expect((await device("B", h.B.otherLoc, "K", "kds")).status).toBe(201);
		});

		it("caps staff on free, for PIN staff and invites alike", async () => {
			const pinStaff = {
				displayName: "New cashier",
				pin: "5678",
				locations: [{ locationId: h.A.loc, role: "cashier" }],
			};
			expect(await planLimit(call("A", "POST", "/staff", pinStaff))).toEqual({
				reason: "limit",
				limit: "staff",
				max: 3,
				plan: "free",
				upgradeTo: "essentials",
			});
			const invite = {
				email: "new-manager@test.bite",
				displayName: "New manager",
				orgRole: "staff",
				locations: [{ locationId: h.A.loc, role: "manager" }],
			};
			await planLimit(call("A", "POST", "/staff/invite", invite));
			// Nothing was half-created.
			const [{ n } = { n: -1 }] = await h.owner<{ n: number }[]>`
				select count(*)::int as n from members
				where org_id = ${h.A.org}
					and display_name in ('New cashier', 'New manager')`;
			expect(n).toBe(0);

			await subscribe("A", "essentials", at(10));
			expect((await call("A", "POST", "/staff", pinStaff)).status).toBe(201);
			expect((await call("A", "POST", "/staff/invite", invite)).status).toBe(
				201,
			);
		});

		it("caps active promotions on free", async () => {
			const promo = (name: string, extra: object = {}) =>
				call("B", "POST", "/promotions", {
					name,
					kind: "percent",
					value: 1000,
					...extra,
				});
			const first = await promo("Opening week");
			expect(first.status).toBe(201);
			expect(await planLimit(promo("Second"))).toMatchObject({
				limit: "activePromotions",
				max: 1,
			});
			// A draft doesn't count until it is switched on.
			const draft = await promo("Draft", { isActive: false });
			expect(draft.status).toBe(201);
			const { id: draftId } = (await draft.json()) as { id: string };
			await planLimit(
				call("B", "PATCH", `/promotions/${draftId}`, { isActive: true }),
			);
			// Editing the live one is always fine.
			const { id: firstId } = (await first.json()) as { id: string };
			const edit = await call("B", "PATCH", `/promotions/${firstId}`, {
				name: "Opening fortnight",
				isActive: true,
			});
			expect(edit.status).toBe(200);
			// Switch it off and the draft can go live.
			await call("B", "PATCH", `/promotions/${firstId}`, { isActive: false });
			const live = await call("B", "PATCH", `/promotions/${draftId}`, {
				isActive: true,
			});
			expect(live.status).toBe(200);
		});

		it("limits report and order history to the plan's window", async () => {
			const day = (d: number) => at(d).toISOString().slice(0, 10);
			const q = (from: number, to: number) =>
				`locationId=${h.A.loc}&from=${day(from)}&to=${day(to)}`;
			for (const path of ["/reports/sales", "/orders", "/orders.csv"]) {
				expect(
					(await call("A", "GET", `${path}?${q(-31, 0)}`)).status,
					path,
				).toBe(200);
				expect(
					await planLimit(call("A", "GET", `${path}?${q(-60, -40)}`)),
					path,
				).toMatchObject({
					limit: "reportHistoryDays",
					max: 31,
					upgradeTo: "essentials",
				});
			}
			await subscribe("A", "essentials", at(10));
			expect(
				(await call("A", "GET", `/reports/sales?${q(-60, -40)}`)).status,
			).toBe(200);
		});
	});

	describe("guest QR ordering", () => {
		const menu = async () => {
			const res = await h.app.request("/v1/public/locations/a-main/menu");
			expect(res.status).toBe(200);
			return (await res.json()) as {
				location: { isAcceptingOrders: boolean };
				menu: { products: unknown[] };
			};
		};
		const order = () =>
			h.app.request(
				"/v1/public/locations/a-main/orders",
				json(
					{
						locationSlug: "a-main",
						type: "takeaway",
						lines: [
							{
								id: uuidv7(),
								productId: h.A.prod,
								quantity: 1,
								modifierOptionIds: [],
							},
						],
					},
					{ "idempotency-key": uuidv7() },
				),
			);

		it("is view-only on free: the menu shows, ordering is off", async () => {
			const m = await menu();
			expect(m.menu.products.length).toBeGreaterThan(0);
			expect(m.location.isAcceptingOrders).toBe(false);
			const res = await order();
			expect(res.status).toBe(422);
			expect(await res.json()).toMatchObject({
				error: { details: { reason: "not_accepting_orders" } },
			});
		});

		it("takes orders on a plan that includes it", async () => {
			await subscribe("A", "essentials", at(10));
			expect((await menu()).location.isAcceptingOrders).toBe(true);
			expect((await order()).status).toBe(201);
		});
	});

	it("starts a new business on a 30-day trial", async () => {
		const s = await signUp(h.app, "newcafe@test.bite", "New Owner");
		const res = await h.app.request(
			"/v1/account/orgs",
			json(
				{
					orgName: "New Cafe",
					orgSlug: "new-cafe",
					locationName: "Main",
					locationSlug: "new-cafe-main",
				},
				{ cookie: s.cookie, origin: ADMIN_ORIGIN },
			),
		);
		expect(res.status).toBe(201);
		const { orgId } = (await res.json()) as { orgId: string };
		const [org] = await h.owner<{ status: string; trial_ends_at: string }[]>`
			select status, trial_ends_at from orgs where id = ${orgId}`;
		expect(org?.status).toBe("trial");
		expect(new Date(org?.trial_ends_at ?? 0).toISOString()).toBe(
			at(TRIAL_DAYS).toISOString(),
		);
		const meRes = await h.app.request("/v1/admin/me", {
			headers: { cookie: s.cookie, origin: ADMIN_ORIGIN, "x-org-id": orgId },
		});
		const body = (await meRes.json()) as { entitlements: unknown };
		expect(Entitlements.parse(body.entitlements)).toMatchObject({
			plan: "pro",
			source: "trial",
		});
	});
});
