/**
 * Guest-side pricing, all through @bite/core so the browser shows exactly
 * what the server will charge (same promotions, modifiers, VAT, rounding).
 * The server still re-prices on submit; these numbers are display only.
 */
import {
	bps,
	buildCatalog,
	type Catalog,
	type LocalizedText as CoreText,
	type LineInput,
	type LocalClock,
	localClock,
	minor,
	type PricedOrder,
	type PricingContext,
	type Promotion,
	priceCart,
	priceLines,
	promotedUnitPrice,
} from "@bite/core";
import { useEffect, useState } from "react";
import type { Cart } from "./cart";
import type { LocalizedText, MenuProduct, MenuSnapshot } from "./contracts";

export type MenuPricing = {
	catalog: Catalog;
	promotions: Promotion[];
	menu: MenuSnapshot;
};

/** Brand the wire numbers as core money types (the contracts already validated them). */
const text = (x: LocalizedText): CoreText =>
	x.ar ? { en: x.en, ar: x.ar } : { en: x.en };

export function menuPricing(menu: MenuSnapshot): MenuPricing {
	const catalog = buildCatalog(
		menu.products.map((p) => ({
			id: p.id,
			categoryId: p.categoryId,
			name: text(p.name),
			price: minor(p.price),
			taxBps: p.taxBps === null ? null : bps(p.taxBps),
			isAvailable: p.isAvailable,
			modifierGroupIds: p.modifierGroupIds,
		})),
		menu.modifierGroups.map((g) => ({
			id: g.id,
			name: text(g.name),
			minSelect: g.minSelect,
			maxSelect: g.maxSelect,
			options: g.options.map((o) => ({
				id: o.id,
				name: text(o.name),
				priceDelta: minor(o.priceDelta),
				isAvailable: o.isAvailable,
			})),
		})),
	);
	return { catalog, promotions: menu.promotions, menu };
}

function context(mp: MenuPricing, at: LocalClock): PricingContext {
	const loc = mp.menu.location;
	return {
		settings: {
			pricesIncludeTax: loc.pricesIncludeTax,
			taxBps: bps(loc.taxBps),
			locationId: loc.locationId,
		},
		promotions: mp.promotions,
		at,
	};
}

export function clockFor(mp: MenuPricing, epochMs: number): LocalClock {
	return localClock(epochMs, mp.menu.location.timezone);
}

/** Price shown on a menu card: promoted unit price before modifiers. */
export function cardPrice(
	mp: MenuPricing,
	product: MenuProduct,
	at: LocalClock,
) {
	return promotedUnitPrice(
		{
			id: product.id,
			categoryId: product.categoryId,
			price: minor(product.price),
		},
		mp.promotions,
		at,
		mp.menu.location.locationId,
	);
}

/**
 * Price one product with a (possibly incomplete) modifier selection, for the
 * product sheet. Doesn't enforce min/max: that is validated on add.
 */
export function priceSelection(
	mp: MenuPricing,
	productId: string,
	optionIds: readonly string[],
	quantity: number,
	at: LocalClock,
): PricedOrder | null {
	const p = mp.catalog.get(productId);
	if (!p) return null;
	const modifiers = p.modifierGroups.flatMap((g) =>
		g.options
			.filter((o) => optionIds.includes(o.id))
			.map((o) => ({
				groupId: g.id,
				optionId: o.id,
				name: o.name,
				priceDelta: o.priceDelta,
			})),
	);
	const line: LineInput = {
		productId: p.id,
		categoryId: p.categoryId,
		name: p.name,
		quantity,
		listUnitPrice: p.price,
		taxBps: p.taxBps,
		modifiers,
	};
	const r = priceLines([line], context(mp, at));
	return r.ok ? r.value : null;
}

export type CartQuote = {
	/** Priced valid lines; null when nothing in the cart can be priced. */
	order: PricedOrder | null;
	/** Priced line per cart line index (undefined for bad lines). */
	lineAt: (index: number) => PricedOrder["lines"][number] | undefined;
	/** Cart line indexes core rejected (86'd, bad modifiers, ...). */
	badIndexes: Set<number>;
};

/** Price the cart; lines core rejects are reported and left out of the total. */
export function quoteCart(
	mp: MenuPricing,
	cart: Cart,
	at: LocalClock,
): CartQuote {
	const lines = cart.lines.map((l) => ({
		productId: l.productId,
		quantity: l.quantity,
		modifierOptionIds: l.modifierOptionIds,
		note: l.note ?? null,
	}));
	const ctx = context(mp, at);
	let r = priceCart(lines, mp.catalog, ctx);
	const bad = new Set<number>();
	if (!r.ok) {
		for (const e of r.errors)
			if (e.lineIndex !== undefined) bad.add(e.lineIndex);
		const keep = lines.flatMap((l, i) => (bad.has(i) ? [] : [l]));
		r = keep.length ? priceCart(keep, mp.catalog, ctx) : r;
	}
	if (!r.ok) {
		return { order: null, lineAt: () => undefined, badIndexes: bad };
	}
	const order = r.value;
	// Map priced lines back to cart indexes (bad lines were skipped).
	const byIndex: (PricedOrder["lines"][number] | undefined)[] = [];
	let j = 0;
	for (let i = 0; i < lines.length; i++)
		byIndex[i] = bad.has(i) ? undefined : order.lines[j++];
	return { order, lineAt: (i) => byIndex[i], badIndexes: bad };
}

/**
 * Pricing clock. Server render and hydration use the menu's generatedAt so
 * markup matches; after mount it follows the real clock, ticking each minute
 * so a promotion window opening or closing shows up.
 */
export function usePricingClock(mp: MenuPricing): LocalClock {
	const [ms, setMs] = useState(() => Date.parse(mp.menu.generatedAt));
	useEffect(() => {
		setMs(Date.now());
		const id = setInterval(() => setMs(Date.now()), 60_000);
		return () => clearInterval(id);
	}, []);
	return clockFor(mp, ms);
}
