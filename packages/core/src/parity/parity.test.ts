/**
 * Parity harness: the same carts priced by the legacy Laravel app (fixtures
 * produced by tools/parity/export-legacy.sh, which runs the REAL
 * GuestOrderService::buildOrderItems) and by @bite/core.
 *
 * - taxMode "legacy" must match legacy to the baisa on every comparable cart.
 * - Carts where legacy STACKED a product sale discount and a pricing rule are
 *   a deliberate difference (no stacking in Bite) and are only counted.
 * - per_line mode (what new orders use) may differ from legacy only in tax,
 *   by at most 1 baisa per line.
 */
import { describe, expect, it } from "vitest";
import { buildCatalog, type CatalogModifierGroup, priceCart } from "../cart.js";
import { clockAt } from "../clock.js";
import { bps, minor, parseDecimal } from "../money.js";
import type { PricedOrder, TaxMode } from "../pricing.js";
import { isPromotionActive, type Promotion } from "../promotions.js";
import fixtures from "./legacy-cases.json" with { type: "json" };

type Id = number;
interface LegacyCase {
	n: number;
	now: string;
	weekday: number;
	shopTaxRate: string;
	products: {
		id: Id;
		categoryId: Id;
		price: string;
		taxRate: string | null;
		isOnSale: boolean;
		discountType: string;
		discountValue: string | null;
		modifierGroupIds: Id[];
	}[];
	modifierGroups: {
		id: Id;
		max: number;
		options: { id: Id; priceAdjustment: string }[];
	}[];
	rules: {
		id: Id;
		productId: Id | null;
		categoryId: Id | null;
		discountType: string;
		discountValue: string;
		startTime: string;
		endTime: string;
		daysOfWeek: (number | string)[] | null;
		isActive: boolean;
	}[];
	activeRuleIds: Id[];
	cart: { productId: Id; quantity: number; modifierOptionIds: Id[] }[];
	legacy: {
		items: { productId: Id; priceSnapshot: string; quantity: number }[];
		subtotal: string;
		tax: string;
		total: string;
	};
}

const cases = (fixtures as unknown as { cases: LegacyCase[] }).cases;

/** "1.05" → 1050 baisa; "12.25" percent → 1225 bps. */
const baisa = (s: string) => parseDecimal(s, 3);
const percentToBps = (s: string) => bps(parseDecimal(s, 2));
const hms = (t: string) => (t.length === 5 ? `${t}:00` : t);
const ruleId = (id: Id) => `rule-${String(id).padStart(8, "0")}`;

/** Migration mapping: product sale discounts and pricing rules both become promotions. */
function promotionsFor(c: LegacyCase): Promotion[] {
	const sales: Promotion[] = c.products
		.filter((p) => p.isOnSale && p.discountValue !== null)
		.map((p) => ({
			id: `sale-${p.id}`,
			kind: p.discountType === "percentage" ? "percent" : "fixed",
			value:
				p.discountType === "percentage"
					? percentToBps(p.discountValue ?? "0")
					: baisa(p.discountValue ?? "0"),
			productId: String(p.id),
		}));
	// Legacy took the FIRST active rule per tier (product > category > shop) in
	// whatever order the DB returned them: there is no ORDER BY. Replay that
	// order as explicit priorities; Bite itself is deterministic.
	const tier = (r: LegacyCase["rules"][number]) =>
		r.productId !== null ? 2 : r.categoryId !== null ? 1 : 0;
	const dbOrder = (id: Id) => {
		const i = c.activeRuleIds.indexOf(id);
		return i === -1 ? 0 : c.activeRuleIds.length - i;
	};
	const rules: Promotion[] = c.rules.map((r) => ({
		id: ruleId(r.id),
		priority: tier(r) * 1000 + dbOrder(r.id),
		kind: r.discountType === "percentage" ? "percent" : "fixed",
		value:
			r.discountType === "percentage"
				? percentToBps(r.discountValue)
				: baisa(r.discountValue),
		productId: r.productId === null ? null : String(r.productId),
		categoryId: r.categoryId === null ? null : String(r.categoryId),
		dailyStart: hms(r.startTime),
		dailyEnd: hms(r.endTime),
		daysOfWeek: r.daysOfWeek === null ? null : r.daysOfWeek.map(Number),
		isActive: r.isActive,
	}));
	return [...sales, ...rules].filter((p) => p.value > 0);
}

function clockFor(c: LegacyCase) {
	const [date = "", time = ""] = c.now.split(" ");
	return clockAt(date, time);
}

function price(c: LegacyCase, taxMode: TaxMode): PricedOrder {
	const groups: CatalogModifierGroup[] = c.modifierGroups.map((g) => ({
		id: String(g.id),
		name: { en: `g${g.id}` },
		minSelect: 0,
		maxSelect: g.max,
		options: g.options.map((o) => ({
			id: String(o.id),
			name: { en: `o${o.id}` },
			priceDelta: baisa(o.priceAdjustment),
			isAvailable: true,
		})),
	}));
	const catalog = buildCatalog(
		c.products.map((p) => ({
			id: String(p.id),
			categoryId: String(p.categoryId),
			name: { en: `p${p.id}` },
			price: baisa(p.price),
			taxBps: p.taxRate === null ? null : percentToBps(p.taxRate),
			isAvailable: true,
			modifierGroupIds: p.modifierGroupIds.map(String),
		})),
		groups,
	);
	const result = priceCart(
		c.cart.map((l) => ({
			productId: String(l.productId),
			quantity: l.quantity,
			modifierOptionIds: l.modifierOptionIds.map(String),
		})),
		catalog,
		{
			settings: {
				pricesIncludeTax: false,
				taxBps: percentToBps(c.shopTaxRate),
				taxMode,
				limits: {
					maxLines: 50,
					maxQuantityPerLine: 99,
					maxOrderTotal: minor(Number.MAX_SAFE_INTEGER),
				},
			},
			promotions: promotionsFor(c),
			at: clockFor(c),
		},
	);
	if (!result.ok)
		throw new Error(`case ${c.n}: ${JSON.stringify(result.errors)}`);
	return result.value;
}

/** Legacy applied a pricing rule ON TOP of a product's sale price. Bite never stacks. */
function stacks(c: LegacyCase): boolean {
	const active = c.rules.filter((r) => c.activeRuleIds.includes(r.id));
	return c.cart.some((l) => {
		const p = c.products.find((x) => x.id === l.productId);
		if (!p?.isOnSale) return false;
		return active.some(
			(r) =>
				r.productId === p.id ||
				(r.productId === null &&
					(r.categoryId === p.categoryId || r.categoryId === null)),
		);
	});
}

describe("parity with legacy GuestOrderService", () => {
	it("has a meaningful fixture set", () => {
		expect(cases.length).toBeGreaterThanOrEqual(400);
		expect(
			cases.filter((c) => c.activeRuleIds.length > 0).length,
		).toBeGreaterThan(100);
	});

	it("promotion windows agree with legacy PricingRule::activeNow", () => {
		for (const c of cases) {
			const at = clockFor(c);
			expect(at.weekday, `case ${c.n} weekday`).toBe(c.weekday);
			for (const r of c.rules) {
				const promo = promotionsFor(c).find((p) => p.id === ruleId(r.id));
				if (!promo) continue;
				expect(isPromotionActive(promo, at), `case ${c.n} rule ${r.id}`).toBe(
					c.activeRuleIds.includes(r.id),
				);
			}
		}
	});

	const comparable = cases.filter((c) => !stacks(c));

	it("legacy tax mode matches to the baisa on every non-stacking cart", () => {
		expect(comparable.length).toBeGreaterThan(300);
		for (const c of comparable) {
			const o = price(c, "legacy");
			const tag = `case ${c.n}`;
			expect(
				o.lines.map((l) => l.unitTotal),
				`${tag} unit prices`,
			).toEqual(c.legacy.items.map((i) => baisa(i.priceSnapshot)));
			expect(o.subtotal, `${tag} subtotal`).toBe(baisa(c.legacy.subtotal));
			expect(o.taxTotal, `${tag} tax`).toBe(baisa(c.legacy.tax));
			expect(o.total, `${tag} total`).toBe(baisa(c.legacy.total));
		}
	});

	it("per-line tax (new orders) differs from legacy only in tax, by at most 1 baisa per line", () => {
		let differing = 0;
		for (const c of comparable) {
			const o = price(c, "per_line");
			expect(o.subtotal).toBe(baisa(c.legacy.subtotal));
			const diff = Math.abs(o.taxTotal - baisa(c.legacy.tax));
			expect(diff, `case ${c.n}`).toBeLessThanOrEqual(o.lines.length);
			if (diff > 0) differing++;
		}
		// Not a target, just visibility: how often per-line rounding moves the bill.
		expect(differing).toBeLessThan(comparable.length);
	});

	it("stacking carts still price every line at or under list price", () => {
		for (const c of cases.filter(stacks)) {
			const o = price(c, "legacy");
			for (const l of o.lines) {
				expect(l.unitPrice).toBeLessThanOrEqual(l.listUnitPrice);
			}
		}
	});
});
