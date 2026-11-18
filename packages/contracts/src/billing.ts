import { z } from "zod";
import { Instant } from "./common.js";

/**
 * Subscription plans on the wire. The catalog itself (what each plan
 * includes, prices) lives in @bite/core `plans.ts`; these schemas mirror its
 * keys, and an API test fails if the two drift apart.
 */
export const PlanId = z.enum(["free", "essentials", "pro"]);
export type PlanId = z.infer<typeof PlanId>;

export const PlanFeature = z.enum([
	"integrated_payments",
	"qr_ordering",
	"custom_branding",
	"kds",
	"fawtara",
	"full_reports",
	"multi_branch",
	"tables",
	"loyalty",
	"audit_log",
]);
export type PlanFeature = z.infer<typeof PlanFeature>;

/** null = unlimited. */
const Limit = z.int().min(0).nullable();
export const PlanLimits = z.object({
	locations: Limit,
	devicesPerLocation: Limit,
	staff: Limit,
	activePromotions: Limit,
	reportHistoryDays: Limit,
});
export type PlanLimits = z.infer<typeof PlanLimits>;
export const PlanLimitKey = PlanLimits.keyof();
export type PlanLimitKey = z.infer<typeof PlanLimitKey>;

/**
 * What an org may use right now. Sent on GET /v1/admin/me and on every sync
 * pull. Clients use it to show, hide or upsell features; the server enforces
 * the limits regardless.
 *
 * Whatever this says, a till must always be able to sell for cash, print,
 * close its drawer and sync.
 */
export const Entitlements = z.object({
	plan: PlanId,
	/** `unenforced` = billing is switched off server-side: everything is on. */
	source: z.enum([
		"unenforced",
		"override",
		"subscription",
		"grace",
		"trial",
		"free",
	]),
	features: z.record(PlanFeature, z.boolean()),
	limits: PlanLimits,
	trialEndsAt: Instant.nullable(),
	paidUntil: Instant.nullable(),
	/** Set while a lapsed subscription is still being honoured. */
	graceEndsAt: Instant.nullable(),
	/** An offline cache must fall back to free after this instant. */
	validUntil: Instant,
});
export type Entitlements = z.infer<typeof Entitlements>;

/** `details` of a 402 `plan_limit` error. */
export const PlanLimitDetails = z.discriminatedUnion("reason", [
	z.object({
		reason: z.literal("limit"),
		limit: PlanLimitKey,
		max: z.int().min(0),
		plan: PlanId,
		/** Cheapest plan that lifts it; null if no plan does. */
		upgradeTo: PlanId.nullable(),
	}),
	z.object({
		reason: z.literal("feature"),
		feature: PlanFeature,
		plan: PlanId,
		upgradeTo: PlanId,
	}),
]);
export type PlanLimitDetails = z.infer<typeof PlanLimitDetails>;
