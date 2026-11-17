import type { LocalClock } from "./clock.js";
import { parseTimeOfDay } from "./clock.js";
import { divRound, type Minor, minor } from "./money.js";

/**
 * Mirrors the `promotions` table. Replaces legacy product discounts AND
 * legacy pricing_rules. Several can match one line: highest `priority`
 * wins, they never stack.
 */
export interface Promotion {
	readonly id: string;
	readonly kind: "percent" | "fixed";
	/** Basis points when kind=percent (1..10000), minor units off the unit price when kind=fixed. */
	readonly value: number;
	/** Target: productId, else categoryId, else (both null) the whole menu. */
	readonly productId?: string | null;
	readonly categoryId?: string | null;
	/** Null/absent = every location of the org. */
	readonly locationId?: string | null;
	/** Absolute window: epoch ms or ISO-8601 with offset. Inclusive start, exclusive end. */
	readonly startsAt?: number | string | null;
	readonly endsAt?: number | string | null;
	/** Daily wall-clock window, "HH:MM[:SS]", inclusive at both ends. May wrap midnight. */
	readonly dailyStart?: string | null;
	readonly dailyEnd?: string | null;
	/** 0 = Sunday .. 6 = Saturday. Null/absent = every day. */
	readonly daysOfWeek?: readonly number[] | null;
	readonly priority?: number;
	readonly isActive?: boolean;
}

/** What a promotion needs to know about the line it might apply to. */
export interface PromotionTarget {
	readonly productId: string | null;
	readonly categoryId: string | null;
}

/**
 * Is the promotion live at `at` for `locationId`?
 *
 * Daily window that wraps midnight (22:00–02:00): the weekday that counts is
 * the day the window opened, so a Thursday-night promo still applies at 01:00
 * on Friday, and a Friday-only one does not.
 */
export function isPromotionActive(
	p: Promotion,
	at: LocalClock,
	locationId: string | null = null,
): boolean {
	if (p.isActive === false) return false;
	if (p.locationId != null && p.locationId !== locationId) return false;
	if (p.startsAt != null && at.epochMs < instant(p.startsAt)) return false;
	if (p.endsAt != null && at.epochMs >= instant(p.endsAt)) return false;

	let weekday = at.weekday;
	if (p.dailyStart != null || p.dailyEnd != null) {
		if (p.dailyStart == null || p.dailyEnd == null) return false;
		const start = parseTimeOfDay(p.dailyStart);
		const end = parseTimeOfDay(p.dailyEnd);
		const t = at.secondOfDay;
		if (start <= end) {
			if (t < start || t > end) return false;
		} else if (t >= start) {
			// evening part of a wrapping window: today's weekday
		} else if (t <= end) {
			weekday = (weekday + 6) % 7; // after midnight: window opened yesterday
		} else {
			return false;
		}
	}

	if (p.daysOfWeek != null && !p.daysOfWeek.includes(weekday)) return false;
	return true;
}

function instant(v: number | string): number {
	const ms = typeof v === "number" ? v : Date.parse(v);
	if (!Number.isFinite(ms)) throw new RangeError(`Bad promotion instant: ${v}`);
	return ms;
}

function specificity(p: Promotion): number {
	if (p.productId != null) return 2;
	if (p.categoryId != null) return 1;
	return 0;
}

function targets(p: Promotion, line: PromotionTarget): boolean {
	if (p.productId != null) return p.productId === line.productId;
	if (p.categoryId != null) return p.categoryId === line.categoryId;
	return line.productId !== null; // menu-wide promos skip open/custom items
}

/**
 * Pick the one promotion for a line. Order: highest priority, then most
 * specific target (product > category > whole menu), then smallest id so the
 * choice is deterministic everywhere.
 */
export function selectPromotion(
	promotions: readonly Promotion[],
	line: PromotionTarget,
	at: LocalClock,
	locationId: string | null = null,
): Promotion | null {
	let best: Promotion | null = null;
	for (const p of promotions) {
		if (!targets(p, line) || !isPromotionActive(p, at, locationId)) continue;
		if (best === null || compare(p, best) < 0) best = p;
	}
	return best;
}

function compare(a: Promotion, b: Promotion): number {
	const pa = a.priority ?? 0;
	const pb = b.priority ?? 0;
	if (pa !== pb) return pb - pa;
	const sa = specificity(a);
	const sb = specificity(b);
	if (sa !== sb) return sb - sa;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Promoted unit price, never below zero.
 * Percent: round(price × (1 − rate)), half away from zero. This rounds the
 * RESULT, not the discount, which is what legacy `PricingRule::applyTo` does
 * (they differ by 1 baisa on exact halves).
 */
export function applyPromotion(unitPrice: Minor, p: Promotion): Minor {
	if (!Number.isSafeInteger(p.value) || p.value <= 0) {
		throw new RangeError(`Promotion ${p.id} value must be a positive integer`);
	}
	if (p.kind === "percent") {
		if (p.value > 10_000)
			throw new RangeError(`Promotion ${p.id} is over 100%`);
		return minor(divRound(unitPrice * (10_000 - p.value), 10_000));
	}
	return minor(Math.max(0, unitPrice - p.value));
}
