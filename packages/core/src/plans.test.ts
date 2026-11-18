import { describe, expect, it } from "vitest";
import {
	cheapestPlanAllowing,
	cheapestPlanWith,
	type EntitlementInput,
	FEATURES,
	GRACE_DAYS,
	LIMIT_KEYS,
	limitReached,
	OFFLINE_TRUST_DAYS,
	PLAN_IDS,
	PLANS,
	resolveEntitlements,
	TRIAL_PLAN,
} from "./plans.js";

const NOW = new Date("2027-01-15T10:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

function input(over: Partial<EntitlementInput> = {}): EntitlementInput {
	return {
		enforce: true,
		now: NOW,
		orgStatus: "active",
		trialEndsAt: null,
		subscription: null,
		overrides: null,
		...over,
	};
}

describe("plan catalog", () => {
	it("ranks plans in order and never takes a feature away going up", () => {
		const { free, essentials, pro } = PLANS;
		expect(free.rank).toBeLessThan(essentials.rank);
		expect(essentials.rank).toBeLessThan(pro.rank);
		for (const f of free.features) expect(essentials.features).toContain(f);
		for (const f of essentials.features) expect(pro.features).toContain(f);
		expect([...pro.features].sort()).toEqual([...FEATURES].sort());
	});

	it("never tightens a limit going up", () => {
		const loose = (n: number | null) => n ?? Number.POSITIVE_INFINITY;
		for (const k of LIMIT_KEYS) {
			expect(loose(PLANS.free.limits[k])).toBeLessThanOrEqual(
				loose(PLANS.essentials.limits[k]),
			);
			expect(loose(PLANS.essentials.limits[k])).toBeLessThanOrEqual(
				loose(PLANS.pro.limits[k]),
			);
		}
	});

	it("prices are whole baisa and a year costs ten months", () => {
		expect(PLANS.free.monthlyPrice).toBe(0);
		for (const id of PLAN_IDS) {
			const p = PLANS[id];
			expect(Number.isSafeInteger(p.monthlyPrice)).toBe(true);
			expect(p.annualPrice).toBe(p.monthlyPrice * 10);
		}
	});
});

describe("resolveEntitlements", () => {
	it("gives everything, unlimited, while billing is switched off", () => {
		const e = resolveEntitlements(
			input({ enforce: false, orgStatus: "suspended" }),
		);
		expect(e.source).toBe("unenforced");
		expect(e.plan).toBe("pro");
		for (const f of FEATURES) expect(e.features[f]).toBe(true);
		for (const k of LIMIT_KEYS) expect(e.limits[k]).toBeNull();
	});

	it("falls to free with no trial, subscription or override", () => {
		const e = resolveEntitlements(input());
		expect(e.plan).toBe("free");
		expect(e.source).toBe("free");
		expect(e.limits).toEqual(PLANS.free.limits);
		for (const f of FEATURES) expect(e.features[f]).toBe(false);
	});

	it("runs the trial plan until the trial ends, then free", () => {
		const live = resolveEntitlements(
			input({ orgStatus: "trial", trialEndsAt: at(1) }),
		);
		expect(live.plan).toBe(TRIAL_PLAN);
		expect(live.source).toBe("trial");
		expect(live.trialEndsAt).toBe(at(1).toISOString());

		const over = resolveEntitlements(
			input({ orgStatus: "trial", trialEndsAt: at(0) }),
		);
		expect(over.plan).toBe("free");
		expect(over.trialEndsAt).toBeNull();

		// A trial with no end date is not a free pass.
		expect(resolveEntitlements(input({ orgStatus: "trial" })).plan).toBe(
			"free",
		);
	});

	it("honours a paid subscription up to and including its last instant", () => {
		const e = resolveEntitlements(
			input({ subscription: { plan: "essentials", currentPeriodEnd: at(0) } }),
		);
		expect(e.plan).toBe("essentials");
		expect(e.source).toBe("subscription");
		expect(e.paidUntil).toBe(at(0).toISOString());
		expect(e.features.fawtara).toBe(true);
		expect(e.features.tables).toBe(false);
	});

	it("treats an open-ended subscription as paid", () => {
		const e = resolveEntitlements(
			input({ subscription: { plan: "pro", currentPeriodEnd: null } }),
		);
		expect(e.plan).toBe("pro");
		expect(e.paidUntil).toBeNull();
	});

	it("keeps the plan through the grace period, then drops to free", () => {
		const inGrace = resolveEntitlements(
			input({
				subscription: { plan: "pro", currentPeriodEnd: at(-GRACE_DAYS) },
			}),
		);
		expect(inGrace.plan).toBe("pro");
		expect(inGrace.source).toBe("grace");
		expect(inGrace.graceEndsAt).toBe(NOW.toISOString());

		const lapsed = resolveEntitlements(
			input({
				subscription: {
					plan: "pro",
					currentPeriodEnd: new Date(at(-GRACE_DAYS).getTime() - 1),
				},
			}),
		);
		expect(lapsed.plan).toBe("free");
		expect(lapsed.source).toBe("free");
	});

	it("takes the better of trial and subscription", () => {
		const e = resolveEntitlements(
			input({
				orgStatus: "trial",
				trialEndsAt: at(5),
				subscription: { plan: "essentials", currentPeriodEnd: at(300) },
			}),
		);
		expect(e.plan).toBe("pro");
		expect(e.source).toBe("trial");
		// Still records what was paid for.
		expect(e.paidUntil).toBe(at(300).toISOString());
	});

	it("ignores a subscription with an unknown plan name", () => {
		const e = resolveEntitlements(
			input({ subscription: { plan: "platinum", currentPeriodEnd: null } }),
		);
		expect(e.plan).toBe("free");
	});

	it("applies a plan override until it expires", () => {
		const live = resolveEntitlements(
			input({
				overrides: { plan: "pro", expiresAt: at(1).toISOString() },
			}),
		);
		expect(live.plan).toBe("pro");
		expect(live.source).toBe("override");

		const expired = resolveEntitlements(
			input({ overrides: { plan: "pro", expiresAt: at(0).toISOString() } }),
		);
		expect(expired.plan).toBe("free");

		const garbage = resolveEntitlements(
			input({ overrides: { plan: "pro", expiresAt: "soon" } }),
		);
		expect(garbage.plan).toBe("free");
	});

	it("an override never lowers a plan that was paid for", () => {
		const e = resolveEntitlements(
			input({
				subscription: { plan: "pro", currentPeriodEnd: at(10) },
				overrides: { plan: "essentials" },
			}),
		);
		expect(e.plan).toBe("pro");
		expect(e.source).toBe("subscription");
	});

	it("applies per-feature and per-limit overrides on top of the plan", () => {
		const e = resolveEntitlements(
			input({
				overrides: {
					features: { kds: true },
					limits: { devicesPerLocation: 2, staff: null },
				},
			}),
		);
		expect(e.plan).toBe("free");
		expect(e.features.kds).toBe(true);
		expect(e.features.fawtara).toBe(false);
		expect(e.limits.devicesPerLocation).toBe(2);
		expect(e.limits.staff).toBeNull();
		expect(e.limits.locations).toBe(PLANS.free.limits.locations);
	});

	it("drops junk in limit overrides", () => {
		const e = resolveEntitlements(
			input({
				overrides: {
					limits: {
						staff: -1,
						devicesPerLocation: 1.5,
						locations: "9" as unknown as number,
					},
				},
			}),
		);
		expect(e.limits).toEqual(PLANS.free.limits);
	});

	it("gives a suspended org nothing beyond free", () => {
		const e = resolveEntitlements(
			input({
				orgStatus: "suspended",
				subscription: { plan: "pro", currentPeriodEnd: at(10) },
				overrides: { plan: "pro", features: { kds: true } },
			}),
		);
		expect(e.plan).toBe("free");
		expect(e.features.kds).toBe(false);
	});

	it("tells offline caches when to stop trusting the answer", () => {
		const e = resolveEntitlements(input());
		expect(e.validUntil).toBe(at(OFFLINE_TRUST_DAYS).toISOString());
	});
});

describe("limit helpers", () => {
	it("limitReached", () => {
		expect(limitReached(null, 1_000)).toBe(false);
		expect(limitReached(3, 2)).toBe(false);
		expect(limitReached(3, 3)).toBe(true);
		expect(limitReached(0, 0)).toBe(true);
	});

	it("names the cheapest plan to upgrade to", () => {
		expect(cheapestPlanWith("kds")).toBe("essentials");
		expect(cheapestPlanWith("tables")).toBe("pro");
		expect(cheapestPlanAllowing("devicesPerLocation", 1)).toBe("free");
		expect(cheapestPlanAllowing("devicesPerLocation", 2)).toBe("essentials");
		expect(cheapestPlanAllowing("devicesPerLocation", 8)).toBe("pro");
		expect(cheapestPlanAllowing("devicesPerLocation", 9)).toBeNull();
		expect(cheapestPlanAllowing("locations", 2)).toBe("pro");
	});
});
