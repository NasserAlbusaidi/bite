import type { PlanLimitDetails } from "@bite/contracts";
import {
	cheapestPlanAllowing,
	cheapestPlanWith,
	type EntitlementOverrides,
	type Entitlements,
	type Feature,
	type LimitKey,
	limitReached,
	resolveEntitlements,
} from "@bite/core";
import { schema, type Tx } from "@bite/db";
import { desc, eq, inArray, sql } from "@bite/db/orm";
import type { Deps } from "../env.js";
import { ApiError } from "./errors.js";

const { orgs, billingSubscriptions } = schema;

/**
 * Subscription rows that can still grant a plan. `canceled` runs to the end
 * of what was paid and gets no grace period.
 */
export const LIVE = ["active", "past_due", "canceled"];

/**
 * What the org in this tenant transaction may use right now.
 *
 * With PLAN_ENFORCEMENT off (the default) this touches no tables and returns
 * everything unlimited, so nothing changes for anyone until billing is
 * switched on.
 */
export async function loadEntitlements(
	tx: Tx,
	deps: Pick<Deps, "planEnforcement" | "now">,
	orgId: string,
): Promise<Entitlements> {
	const now = deps.now?.() ?? new Date();
	if (!deps.planEnforcement) {
		return resolveEntitlements({
			enforce: false,
			now,
			orgStatus: "active",
			trialEndsAt: null,
			subscription: null,
		});
	}
	const [org] = await tx
		.select({
			status: orgs.status,
			trialEndsAt: orgs.trialEndsAt,
			overrides: orgs.entitlementOverrides,
		})
		.from(orgs)
		.where(eq(orgs.id, orgId));
	if (!org) throw new ApiError("not_found", "no such org");
	// The one that runs longest wins; an open-ended grant sorts first.
	const [sub] = await tx
		.select({
			plan: billingSubscriptions.plan,
			status: billingSubscriptions.status,
			currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
		})
		.from(billingSubscriptions)
		.where(inArray(billingSubscriptions.status, LIVE))
		.orderBy(
			sql`${billingSubscriptions.currentPeriodEnd} desc nulls first`,
			desc(billingSubscriptions.id),
		)
		.limit(1);
	const lapsedCancel =
		sub?.status === "canceled" &&
		sub.currentPeriodEnd !== null &&
		sub.currentPeriodEnd.getTime() < now.getTime();
	return resolveEntitlements({
		enforce: true,
		now,
		orgStatus: org.status,
		trialEndsAt: org.trialEndsAt,
		subscription:
			sub && !lapsedCancel
				? { plan: sub.plan, currentPeriodEnd: sub.currentPeriodEnd }
				: null,
		overrides: org.overrides as EntitlementOverrides | null,
	});
}

/** 402 unless one more fits under the plan's limit. `current` = how many exist now. */
export function requireRoom(e: Entitlements, key: LimitKey, current: number) {
	const max = e.limits[key];
	if (!limitReached(max, current)) return;
	const details: PlanLimitDetails = {
		reason: "limit",
		limit: key,
		max: max as number,
		plan: e.plan,
		upgradeTo: cheapestPlanAllowing(key, current + 1),
	};
	throw new ApiError("plan_limit", `plan limit reached: ${key}`, details);
}

/** 402 unless the plan includes the feature. */
export function requireFeature(e: Entitlements, feature: Feature) {
	if (e.features[feature]) return;
	const details: PlanLimitDetails = {
		reason: "feature",
		feature,
		plan: e.plan,
		upgradeTo: cheapestPlanWith(feature),
	};
	throw new ApiError("plan_limit", `not included in plan: ${feature}`, details);
}

/**
 * Guard for "add one more X". Counts inside the caller's transaction under a
 * per-org lock, so two requests racing for the last slot can't both win.
 * A no-op (no queries) while enforcement is off or the plan is unlimited.
 */
export async function requireRoomFor(
	tx: Tx,
	deps: Pick<Deps, "planEnforcement" | "now">,
	orgId: string,
	key: LimitKey,
	count: () => Promise<number>,
	/** Narrows the lock, e.g. to one location. */
	scope = "",
) {
	if (!deps.planEnforcement) return;
	const e = await loadEntitlements(tx, deps, orgId);
	if (e.limits[key] === null) return;
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`plan:${orgId}:${key}:${scope}`}, 0))`,
	);
	requireRoom(e, key, await count());
}

/**
 * 402 when a report or order-history range starts before the plan's history
 * window. One day of slack covers the location's timezone. The older data is
 * kept; a plan with a longer window shows it again.
 */
export async function requireHistory(
	tx: Tx,
	deps: Pick<Deps, "planEnforcement" | "now">,
	orgId: string,
	/** Business date, YYYY-MM-DD. */
	from: string,
) {
	if (!deps.planEnforcement) return;
	const e = await loadEntitlements(tx, deps, orgId);
	const max = e.limits.reportHistoryDays;
	if (max === null) return;
	const now = deps.now?.() ?? new Date();
	const ageDays = Math.floor((now.getTime() - Date.parse(from)) / 86_400_000);
	if (ageDays <= max + 1) return;
	const details: PlanLimitDetails = {
		reason: "limit",
		limit: "reportHistoryDays",
		max,
		plan: e.plan,
		upgradeTo: cheapestPlanAllowing("reportHistoryDays", ageDays),
	};
	throw new ApiError(
		"plan_limit",
		`this plan shows the last ${max} days`,
		details,
	);
}
