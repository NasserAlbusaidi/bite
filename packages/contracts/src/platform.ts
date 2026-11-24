import { z } from "zod";
import { Entitlements, PlanId } from "./billing.js";
import { Id, Instant, Minor } from "./common.js";

/**
 * Platform console (Bite's own operators), under /v1/platform. Cross-tenant
 * on purpose: a platform admin sees every business. Every write is recorded
 * in that org's audit log as `platform.*`.
 */

const Slug = z
	.string()
	.min(3)
	.max(48)
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and dashes");

export const OrgStatus = z.enum(["trial", "active", "suspended"]);

/** GET /v1/platform/me. 404 for anyone who is not a platform admin. */
export const PlatformMe = z.object({
	userId: z.string(),
	email: z.email(),
	name: z.string(),
});

/** Usage numbers, for an org or one of its branches. Money in minor units. */
export const PlatformUsage = z.object({
	/** Orders placed in the last 30 days, cancelled ones left out. */
	orders30d: z.int(),
	/** Sum of those orders' totals. */
	sales30d: Minor,
	ordersToday: z.int(),
	lastOrderAt: Instant.nullable(),
	/** Paired tablets that are not revoked. */
	devices: z.int(),
});

/** One row of GET /v1/platform/orgs. */
export const PlatformOrgRow = z.object({
	id: Id,
	name: z.string(),
	slug: z.string(),
	status: OrgStatus,
	trialEndsAt: Instant.nullable(),
	createdAt: Instant,
	/** What the org would get with plan enforcement on. */
	plan: PlanId,
	planSource: z.string(),
	ownerEmail: z.string().nullable(),
	locationCount: z.int(),
	memberCount: z.int(),
	usage: PlatformUsage,
});

export const PlatformTotals = z.object({
	orgs: z.int(),
	byStatus: z.record(OrgStatus, z.int()),
	byPlan: z.record(PlanId, z.int()),
	locations: z.int(),
	orders30d: z.int(),
	sales30d: Minor,
	ordersToday: z.int(),
});

/** GET /v1/platform/orgs?q=&status=&plan= */
export const PlatformOrgList = z.object({
	items: z.array(PlatformOrgRow),
	/** Over every org, not just the filtered ones. */
	totals: PlatformTotals,
	/** True when plan limits are enforced on this API (PLAN_ENFORCEMENT=on). */
	planEnforcement: z.boolean(),
});

export const PlatformOrgQuery = z.object({
	q: z.string().trim().max(80).optional(),
	status: OrgStatus.optional(),
	plan: PlanId.optional(),
});

/** GET /v1/platform/orgs/:id */
export const PlatformOrgDetail = PlatformOrgRow.extend({
	entitlements: Entitlements,
	entitlementOverrides: z.record(z.string(), z.unknown()).nullable(),
	locations: z.array(
		z.object({
			id: Id,
			name: z.string(),
			slug: z.string(),
			timezone: z.string(),
			isActive: z.boolean(),
			ordersPausedUntil: Instant.nullable(),
			usage: PlatformUsage,
		}),
	),
	members: z.array(
		z.object({
			id: Id,
			displayName: z.string(),
			email: z.string().nullable(),
			orgRole: z.enum(["owner", "admin", "staff"]),
			isActive: z.boolean(),
			hasLogin: z.boolean(),
		}),
	),
	subscriptions: z.array(
		z.object({
			id: Id,
			provider: z.string(),
			plan: z.string(),
			status: z.string(),
			currentPeriodEnd: Instant.nullable(),
			createdAt: Instant,
		}),
	),
	/** Newest first, platform actions and other audit entries. */
	activity: z.array(
		z.object({
			id: Id,
			action: z.string(),
			data: z.record(z.string(), z.unknown()).nullable(),
			createdAt: Instant,
		}),
	),
});

/** POST /v1/platform/orgs: a new business, its first branch, an owner invite. */
export const PlatformCreateOrg = z.object({
	orgName: z.string().trim().min(1).max(80),
	orgSlug: Slug,
	locationName: z.string().trim().min(1).max(80),
	locationSlug: Slug,
	timezone: z.string().min(1).max(64).default("Asia/Muscat"),
	ownerName: z.string().trim().min(1).max(80),
	ownerEmail: z.email().max(200),
	/** Trial length. 0 starts the org active on the free plan. */
	trialDays: z.int().min(0).max(365).default(30),
});
export const PlatformCreatedOrg = z.object({
	orgId: Id,
	locationId: Id,
	memberId: Id,
	/** Send to the owner: /accept-invite?token=... in the back office. */
	inviteToken: z.string(),
	inviteExpiresAt: Instant,
});

/** POST /v1/platform/orgs/:id/status */
export const PlatformSetStatus = z.object({
	status: OrgStatus,
	note: z.string().trim().max(200).optional(),
});

/**
 * POST /v1/platform/orgs/:id/plan. A manual subscription, open-ended or
 * until `until`. "free" ends the manual subscription.
 */
export const PlatformSetPlan = z.object({
	plan: PlanId,
	until: Instant.optional(),
	note: z.string().trim().max(200).optional(),
});

/** POST /v1/platform/orgs/:id/trial: trial status, ending `days` from now. */
export const PlatformExtendTrial = z.object({ days: z.int().min(1).max(365) });

export type OrgStatus = z.infer<typeof OrgStatus>;
export type PlatformMe = z.infer<typeof PlatformMe>;
export type PlatformUsage = z.infer<typeof PlatformUsage>;
export type PlatformOrgRow = z.infer<typeof PlatformOrgRow>;
export type PlatformTotals = z.infer<typeof PlatformTotals>;
export type PlatformOrgList = z.infer<typeof PlatformOrgList>;
export type PlatformOrgQuery = z.infer<typeof PlatformOrgQuery>;
export type PlatformOrgDetail = z.infer<typeof PlatformOrgDetail>;
export type PlatformCreateOrg = z.infer<typeof PlatformCreateOrg>;
export type PlatformCreatedOrg = z.infer<typeof PlatformCreatedOrg>;
export type PlatformSetStatus = z.infer<typeof PlatformSetStatus>;
export type PlatformSetPlan = z.infer<typeof PlatformSetPlan>;
export type PlatformExtendTrial = z.infer<typeof PlatformExtendTrial>;
