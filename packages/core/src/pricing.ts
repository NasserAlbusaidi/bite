import { allocate } from "./allocate.js";
import type { LocalClock } from "./clock.js";
import {
	applyRate,
	type BasisPoints,
	divRound,
	type Minor,
	minor,
	sum,
	taxFromInclusive,
	times,
	ZERO,
} from "./money.js";
import {
	applyPromotion,
	type Promotion,
	selectPromotion,
} from "./promotions.js";

/** Same shape as the db's LocalizedText. */
export type LocalizedText = { en: string; ar?: string };

/** A chosen modifier, already resolved. Snapshots into order_lines.modifiers. */
export interface ModifierSnapshot {
	readonly groupId: string;
	readonly optionId: string;
	readonly name: LocalizedText;
	/** Added to the unit price. May be negative ("no cheese"). */
	readonly priceDelta: Minor;
}

/** A line whose product data the caller already resolved (POS, or resolveCart). */
export interface LineInput {
	/** Null for open/custom items; those never get a promotion. */
	readonly productId: string | null;
	readonly categoryId: string | null;
	readonly name: LocalizedText;
	/** Positive integer. */
	readonly quantity: number;
	/** Menu price for this location, before promotion and modifiers. >= 0. */
	readonly listUnitPrice: Minor;
	/** Product override; null = the location default (settings.taxBps). */
	readonly taxBps: BasisPoints | null;
	readonly modifiers: readonly ModifierSnapshot[];
	readonly note?: string | null;
}

export interface OrderLimits {
	readonly maxLines: number;
	readonly maxQuantityPerLine: number;
	/** Cap on the priced order total. */
	readonly maxOrderTotal: Minor;
}

/** Legacy config/ordering.php defaults (50 lines, 99 per line, 1000.000 OMR). */
export const DEFAULT_LIMITS: OrderLimits = {
	maxLines: 50,
	maxQuantityPerLine: 99,
	maxOrderTotal: minor(1_000_000),
};

/**
 * - `per_line` (default): tax is rounded per line and the order tax is the sum
 *   of line taxes. Works for exclusive and inclusive prices.
 * - `legacy`: reproduces the Laravel app: prices are tax-exclusive, the order
 *   tax is rounded ONCE over the unrounded sum, and then allocated back to the
 *   lines so Σ lineTax still equals taxTotal. Use only for parity/migration.
 */
export type TaxMode = "per_line" | "legacy";

export interface PricingSettings {
	/** Location setting, snapshotted onto the order. */
	readonly pricesIncludeTax: boolean;
	/** Location default VAT rate (Oman: 500). */
	readonly taxBps: BasisPoints;
	/** Location being priced, for location-scoped promotions. */
	readonly locationId?: string | null;
	readonly taxMode?: TaxMode;
	/** Defaults to DEFAULT_LIMITS. */
	readonly limits?: OrderLimits;
}

export interface PricingContext {
	readonly settings: PricingSettings;
	readonly promotions: readonly Promotion[];
	/** When the order is priced. Decides which promotions are live. */
	readonly at: LocalClock;
}

/** Maps 1:1 onto order_lines columns. */
export interface PricedLine {
	readonly productId: string | null;
	readonly categoryId: string | null;
	readonly name: LocalizedText;
	readonly quantity: number;
	readonly listUnitPrice: Minor;
	/** After promotion, before modifiers. */
	readonly unitPrice: Minor;
	readonly promotionId: string | null;
	readonly modifiers: readonly ModifierSnapshot[];
	/** max(0, unitPrice + Σ modifier deltas). */
	readonly unitTotal: Minor;
	readonly taxBps: BasisPoints;
	/** unitTotal × quantity, gross or net per pricesIncludeTax. */
	readonly lineTotal: Minor;
	/** What the promotion saved on this line (already netted out of lineTotal). */
	readonly lineDiscount: Minor;
	readonly lineTax: Minor;
	/** lineTotal without tax. */
	readonly lineNet: Minor;
	/** lineTotal with tax: what the guest pays for this line. */
	readonly lineGross: Minor;
	readonly note: string | null;
}

/** Maps 1:1 onto orders columns. */
export interface PricedOrder {
	readonly pricesIncludeTax: boolean;
	readonly taxMode: TaxMode;
	readonly lines: readonly PricedLine[];
	/** Σ lineTotal (after promotions; net if exclusive, gross if inclusive). */
	readonly subtotal: Minor;
	/** Σ lineDiscount. Informational, already netted out of subtotal. */
	readonly discountTotal: Minor;
	readonly taxTotal: Minor;
	/** What the guest pays: subtotal + tax when exclusive, subtotal when inclusive. */
	readonly total: Minor;
}

export type PricingErrorCode =
	| "empty_cart"
	| "too_many_lines"
	| "invalid_quantity"
	| "quantity_too_large"
	| "invalid_price"
	| "total_too_large"
	| "legacy_mode_requires_exclusive"
	// resolveCart only:
	| "unknown_product"
	| "product_unavailable"
	| "invalid_modifier"
	| "duplicate_modifier"
	| "modifier_unavailable"
	| "modifier_below_min"
	| "modifier_above_max";

export interface PricingError {
	readonly code: PricingErrorCode;
	/** Index into the input cart, when the error is about one line. */
	readonly lineIndex?: number;
	readonly productId?: string;
	readonly groupId?: string;
	readonly optionId?: string;
	readonly min?: number;
	readonly max?: number;
}

export type Result<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly errors: readonly PricingError[] };

/**
 * Price already-resolved lines: promotions, modifiers, VAT, totals.
 * Pure and synchronous; the same call runs on the server and offline on the
 * tablet. Never trusts client totals: everything is recomputed from inputs.
 */
export function priceLines(
	lines: readonly LineInput[],
	ctx: PricingContext,
): Result<PricedOrder> {
	const { settings } = ctx;
	const limits = settings.limits ?? DEFAULT_LIMITS;
	const taxMode = settings.taxMode ?? "per_line";
	const errors: PricingError[] = [];

	if (lines.length === 0) errors.push({ code: "empty_cart" });
	if (lines.length > limits.maxLines)
		errors.push({ code: "too_many_lines", max: limits.maxLines });
	if (taxMode === "legacy" && settings.pricesIncludeTax) {
		errors.push({ code: "legacy_mode_requires_exclusive" });
	}
	lines.forEach((l, lineIndex) => {
		if (!Number.isSafeInteger(l.quantity) || l.quantity < 1) {
			errors.push({ code: "invalid_quantity", lineIndex });
		} else if (l.quantity > limits.maxQuantityPerLine) {
			errors.push({
				code: "quantity_too_large",
				lineIndex,
				max: limits.maxQuantityPerLine,
			});
		}
		if (!Number.isSafeInteger(l.listUnitPrice) || l.listUnitPrice < 0) {
			errors.push({ code: "invalid_price", lineIndex });
		}
	});
	if (errors.length > 0) return { ok: false, errors };

	const locationId = settings.locationId ?? null;
	const base = lines.map((l) => {
		const promo =
			l.productId === null
				? null
				: selectPromotion(ctx.promotions, l, ctx.at, locationId);
		const unitPrice = promo
			? applyPromotion(l.listUnitPrice, promo)
			: l.listUnitPrice;
		const deltas = sum(l.modifiers.map((m) => m.priceDelta));
		const unitTotal = minor(Math.max(0, unitPrice + deltas));
		const listUnitTotal = minor(Math.max(0, l.listUnitPrice + deltas));
		return {
			line: l,
			promotionId: promo?.id ?? null,
			unitPrice,
			unitTotal,
			taxBps: l.taxBps ?? settings.taxBps,
			lineTotal: times(unitTotal, l.quantity),
			lineDiscount: times(minor(listUnitTotal - unitTotal), l.quantity),
		};
	});

	const taxes =
		taxMode === "legacy"
			? legacyLineTaxes(base)
			: base.map((b) =>
					lineTax(b.lineTotal, b.taxBps, settings.pricesIncludeTax),
				);

	const priced: PricedLine[] = base.map((b, i) => {
		const tax = taxes[i] ?? ZERO;
		const lineNet = settings.pricesIncludeTax
			? minor(b.lineTotal - tax)
			: b.lineTotal;
		const lineGross = settings.pricesIncludeTax
			? b.lineTotal
			: minor(b.lineTotal + tax);
		return {
			productId: b.line.productId,
			categoryId: b.line.categoryId,
			name: b.line.name,
			quantity: b.line.quantity,
			listUnitPrice: b.line.listUnitPrice,
			unitPrice: b.unitPrice,
			promotionId: b.promotionId,
			modifiers: b.line.modifiers,
			unitTotal: b.unitTotal,
			taxBps: b.taxBps,
			lineTotal: b.lineTotal,
			lineDiscount: b.lineDiscount,
			lineTax: tax,
			lineNet,
			lineGross,
			note: b.line.note ?? null,
		};
	});

	const subtotal = sum(priced.map((l) => l.lineTotal));
	const taxTotal = sum(priced.map((l) => l.lineTax));
	const order: PricedOrder = {
		pricesIncludeTax: settings.pricesIncludeTax,
		taxMode,
		lines: priced,
		subtotal,
		discountTotal: sum(priced.map((l) => l.lineDiscount)),
		taxTotal,
		total: settings.pricesIncludeTax ? subtotal : minor(subtotal + taxTotal),
	};

	if (order.total > limits.maxOrderTotal) {
		return {
			ok: false,
			errors: [{ code: "total_too_large", max: limits.maxOrderTotal }],
		};
	}
	return { ok: true, value: order };
}

/** VAT on one line amount, rounded half away from zero. */
export function lineTax(
	amount: Minor,
	rate: BasisPoints,
	pricesIncludeTax: boolean,
): Minor {
	return pricesIncludeTax
		? taxFromInclusive(amount, rate)
		: applyRate(amount, rate);
}

/**
 * Legacy: tax = round(Σ lineTotal × rate) once at the order level, computed
 * exactly in integers. Then spread across lines by largest remainder so the
 * per-line column still sums to the order tax.
 */
function legacyLineTaxes(
	base: readonly { lineTotal: Minor; taxBps: BasisPoints }[],
): Minor[] {
	const exact = base.map((b) => b.lineTotal * b.taxBps); // tax × 10_000 per line
	const exactSum = exact.reduce((a, b) => a + b, 0);
	const total = minor(divRound(exactSum, 10_000));
	return allocate(total, exact);
}
