import { type Minor, minor } from "./money.js";

/**
 * Subscription plans and what each one unlocks.
 *
 * This file is the single place where a tier boundary lives. The API resolves
 * an org's entitlements from it and enforces the hard limits; the tablet and
 * the back office read the resolved entitlements to show or hide features.
 * Pure data and functions, so it runs offline on the tablet too.
 *
 * Rules that are NOT negotiable, whatever the plan:
 * - selling, taking cash, printing a receipt, closing a drawer, syncing and
 *   exporting data are never gated;
 * - limits stop NEW things being added. They never delete or hide existing
 *   rows, so a downgrade leaves the data intact.
 */

export const PLAN_IDS = ["free", "essentials", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const FEATURES = [
	/** Card terminal / SoftPOS / Thawani. Free can still record a card sale by hand. */
	"integrated_payments",
	/** Guests order from the QR menu. Without it the menu is view-only. */
	"qr_ordering",
	/** Own logo and colours, no "Powered by Bite" badge. */
	"custom_branding",
	/** Kitchen display devices. */
	"kds",
	/** Fawtara e-invoicing. Has a per-receipt provider cost, so never free. */
	"fawtara",
	/** Reports past the free history window, CSV export. */
	"full_reports",
	"multi_branch",
	/** Floor plan, open tabs, waiter mode. */
	"tables",
	"loyalty",
	"audit_log",
] as const;
export type Feature = (typeof FEATURES)[number];

/** null = unlimited. */
export type Limits = {
	locations: number | null;
	/** Active (not revoked) devices at one location, tills and kitchen displays together. */
	devicesPerLocation: number | null;
	/** Active staff across the org. */
	staff: number | null;
	activePromotions: number | null;
	/** How far back reports and order history go, in days. */
	reportHistoryDays: number | null;
};
export type LimitKey = keyof Limits;
export const LIMIT_KEYS = [
	"locations",
	"devicesPerLocation",
	"staff",
	"activePromotions",
	"reportHistoryDays",
] as const satisfies readonly LimitKey[];

export type PlanDef = {
	id: PlanId;
	/** Higher = more. Used to pick the better of two plans. */
	rank: number;
	/** Per location, before VAT, in baisa. */
	monthlyPrice: Minor;
	/** Per location, before VAT, in baisa. A year for the price of ten months. */
	annualPrice: Minor;
	features: readonly Feature[];
	limits: Limits;
};

export const PLANS: Record<PlanId, PlanDef> = {
	free: {
		id: "free",
		rank: 0,
		monthlyPrice: minor(0),
		annualPrice: minor(0),
		features: [],
		limits: {
			locations: 1,
			devicesPerLocation: 1,
			staff: 3,
			activePromotions: 1,
			reportHistoryDays: 31,
		},
	},
	essentials: {
		id: "essentials",
		rank: 1,
		monthlyPrice: minor(15_000),
		annualPrice: minor(150_000),
		features: [
			"integrated_payments",
			"qr_ordering",
			"custom_branding",
			"kds",
			"fawtara",
			"full_reports",
		],
		limits: {
			locations: 1,
			devicesPerLocation: 3,
			staff: null,
			activePromotions: null,
			reportHistoryDays: null,
		},
	},
	pro: {
		id: "pro",
		rank: 2,
		monthlyPrice: minor(29_000),
		annualPrice: minor(290_000),
		features: FEATURES,
		limits: {
			locations: null,
			devicesPerLocation: 8,
			staff: null,
			activePromotions: null,
			reportHistoryDays: null,
		},
	},
};

/** New accounts get this plan for TRIAL_DAYS, then fall to free on their own. */
export const TRIAL_PLAN: PlanId = "pro";
export const TRIAL_DAYS = 30;
/** After a paid period ends unpaid, everything keeps working this long. */
export const GRACE_DAYS = 14;
/** A tablet trusts its cached entitlements this long without reaching the server. */
export const OFFLINE_TRUST_DAYS = 14;

const DAY_MS = 86_400_000;

export function isPlanId(v: unknown): v is PlanId {
	return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

/**
 * A hand-set exception for one org: the founding customers, a goodwill
 * extension after an outage, a custom deal. Stored on the org row; only the
 * system role can write it.
 */
export type EntitlementOverrides = {
	/** Treat the org as at least this plan. */
	plan?: PlanId;
	features?: Partial<Record<Feature, boolean>>;
	limits?: Partial<Limits>;
	/** ISO instant. Absent or null = no expiry. */
	expiresAt?: string | null;
	note?: string;
};

export type EntitlementInput = {
	/** False = billing is not switched on: every org gets everything. */
	enforce: boolean;
	now: Date;
	orgStatus: "trial" | "active" | "suspended";
	trialEndsAt: Date | null;
	/** The org's current paid subscription, if any. */
	subscription: {
		plan: string;
		/** null = open-ended (a manual grant with no end date). */
		currentPeriodEnd: Date | null;
	} | null;
	overrides?: EntitlementOverrides | null;
};

export type EntitlementSource =
	| "unenforced"
	| "override"
	| "subscription"
	| "grace"
	| "trial"
	| "free";

export type Entitlements = {
	plan: PlanId;
	/** Why the org is on this plan. */
	source: EntitlementSource;
	features: Record<Feature, boolean>;
	limits: Limits;
	/** ISO instants; null when not applicable. */
	trialEndsAt: string | null;
	paidUntil: string | null;
	graceEndsAt: string | null;
	/** Offline caches must stop trusting this copy after this instant. */
	validUntil: string;
};

function featureMap(plan: PlanDef): Record<Feature, boolean> {
	const on = new Set<Feature>(plan.features);
	const out = {} as Record<Feature, boolean>;
	for (const f of FEATURES) out[f] = on.has(f);
	return out;
}

function overridesLive(o: EntitlementOverrides | null | undefined, now: Date) {
	if (!o) return null;
	if (o.expiresAt) {
		const end = Date.parse(o.expiresAt);
		// An unreadable date fails closed: the override does not apply.
		if (!Number.isFinite(end) || end <= now.getTime()) return null;
	}
	return o;
}

/**
 * Work out what an org may use right now. The best of: a live subscription
 * (or its grace period), a running trial, a plan override; otherwise free.
 * Per-feature and per-limit overrides are applied on top.
 */
export function resolveEntitlements(input: EntitlementInput): Entitlements {
	const { now } = input;
	const validUntil = new Date(
		now.getTime() + OFFLINE_TRUST_DAYS * DAY_MS,
	).toISOString();

	if (!input.enforce) {
		return {
			plan: "pro",
			source: "unenforced",
			features: featureMap(PLANS.pro),
			limits: {
				locations: null,
				devicesPerLocation: null,
				staff: null,
				activePromotions: null,
				reportHistoryDays: null,
			},
			trialEndsAt: null,
			paidUntil: null,
			graceEndsAt: null,
			validUntil,
		};
	}

	let plan: PlanId = "free";
	let source: EntitlementSource = "free";
	const better = (p: PlanId, s: EntitlementSource) => {
		if (PLANS[p].rank > PLANS[plan].rank) {
			plan = p;
			source = s;
		}
	};

	let paidUntil: string | null = null;
	let graceEndsAt: string | null = null;
	const sub = input.subscription;
	// A suspended org keeps its data but gets nothing beyond free.
	const suspended = input.orgStatus === "suspended";
	if (sub && isPlanId(sub.plan) && !suspended) {
		const end = sub.currentPeriodEnd;
		if (!end || now.getTime() <= end.getTime()) {
			better(sub.plan, "subscription");
			paidUntil = end ? end.toISOString() : null;
		} else {
			const graceEnd = new Date(end.getTime() + GRACE_DAYS * DAY_MS);
			if (now.getTime() <= graceEnd.getTime()) {
				better(sub.plan, "grace");
				paidUntil = end.toISOString();
				graceEndsAt = graceEnd.toISOString();
			}
		}
	}

	const trialLive =
		input.orgStatus === "trial" &&
		input.trialEndsAt !== null &&
		now.getTime() < input.trialEndsAt.getTime();
	if (trialLive) better(TRIAL_PLAN, "trial");

	const o = suspended ? null : overridesLive(input.overrides, now);
	if (o?.plan && isPlanId(o.plan)) better(o.plan, "override");

	const def = PLANS[plan];
	const features = featureMap(def);
	const limits: Limits = { ...def.limits };
	if (o?.features) {
		for (const f of FEATURES) {
			const v = o.features[f];
			if (typeof v === "boolean") features[f] = v;
		}
	}
	if (o?.limits) {
		for (const k of LIMIT_KEYS) {
			const v = o.limits[k];
			if (v === null || (Number.isSafeInteger(v) && (v as number) >= 0)) {
				limits[k] = v as number | null;
			}
		}
	}

	return {
		plan,
		source,
		features,
		limits,
		trialEndsAt:
			trialLive && input.trialEndsAt ? input.trialEndsAt.toISOString() : null,
		paidUntil,
		graceEndsAt,
		validUntil,
	};
}

/** True when adding one more would go over the limit. */
export function limitReached(limit: number | null, current: number): boolean {
	return limit !== null && current >= limit;
}

/** The cheapest plan that includes a feature; for "upgrade to X" prompts. */
export function cheapestPlanWith(feature: Feature): PlanId {
	for (const id of PLAN_IDS) {
		if (PLANS[id].features.includes(feature)) return id;
	}
	return "pro";
}

/** The cheapest plan whose limit allows `needed`; null if none does. */
export function cheapestPlanAllowing(
	key: LimitKey,
	needed: number,
): PlanId | null {
	for (const id of PLAN_IDS) {
		const max = PLANS[id].limits[key];
		if (max === null || needed <= max) return id;
	}
	return null;
}
