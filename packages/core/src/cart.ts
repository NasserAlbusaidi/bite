import type { LocalClock } from "./clock.js";
import type { BasisPoints, Minor } from "./money.js";
import {
	type LineInput,
	type LocalizedText,
	type PricedOrder,
	type PricingContext,
	type PricingError,
	priceLines,
	type Result,
} from "./pricing.js";
import {
	applyPromotion,
	type Promotion,
	selectPromotion,
} from "./promotions.js";

/** Live menu data for one location (product_location_settings already applied). */
export interface CatalogProduct {
	readonly id: string;
	readonly categoryId: string;
	readonly name: LocalizedText;
	/** Effective price at this location (override or product price). */
	readonly price: Minor;
	readonly taxBps: BasisPoints | null;
	/** False when 86'd, hidden or archived. */
	readonly isAvailable: boolean;
	readonly modifierGroups: readonly CatalogModifierGroup[];
}

export interface CatalogModifierGroup {
	readonly id: string;
	readonly name: LocalizedText;
	readonly minSelect: number;
	readonly maxSelect: number;
	readonly options: readonly CatalogModifierOption[];
}

export interface CatalogModifierOption {
	readonly id: string;
	readonly name: LocalizedText;
	readonly priceDelta: Minor;
	readonly isAvailable: boolean;
}

/** An untrusted cart line: ids and quantities only, never prices. */
export interface CartLine {
	readonly productId: string;
	readonly quantity: number;
	readonly modifierOptionIds: readonly string[];
	readonly note?: string | null;
}

export type Catalog = ReadonlyMap<string, CatalogProduct>;

/**
 * Turn an untrusted cart into priceable lines using live catalog data.
 * Collects every error (not just the first) so the UI can flag all bad lines,
 * e.g. prune all 86'd items in one go.
 */
export function resolveCart(
	cart: readonly CartLine[],
	catalog: Catalog,
): Result<LineInput[]> {
	const errors: PricingError[] = [];
	const lines: LineInput[] = [];

	cart.forEach((item, lineIndex) => {
		const product = catalog.get(item.productId);
		if (!product) {
			errors.push({
				code: "unknown_product",
				lineIndex,
				productId: item.productId,
			});
			return;
		}
		if (!product.isAvailable) {
			errors.push({
				code: "product_unavailable",
				lineIndex,
				productId: product.id,
			});
			return;
		}

		const lineErrors: PricingError[] = [];
		const seen = new Set<string>();
		const byOption = new Map<
			string,
			{ group: CatalogModifierGroup; option: CatalogModifierOption }
		>();
		for (const group of product.modifierGroups) {
			for (const option of group.options)
				byOption.set(option.id, { group, option });
		}

		const chosen: {
			group: CatalogModifierGroup;
			option: CatalogModifierOption;
		}[] = [];
		for (const optionId of item.modifierOptionIds) {
			if (seen.has(optionId)) {
				lineErrors.push({
					code: "duplicate_modifier",
					lineIndex,
					productId: product.id,
					optionId,
				});
				continue;
			}
			seen.add(optionId);
			const hit = byOption.get(optionId);
			if (!hit) {
				lineErrors.push({
					code: "invalid_modifier",
					lineIndex,
					productId: product.id,
					optionId,
				});
				continue;
			}
			if (!hit.option.isAvailable) {
				lineErrors.push({
					code: "modifier_unavailable",
					lineIndex,
					productId: product.id,
					groupId: hit.group.id,
					optionId,
				});
				continue;
			}
			chosen.push(hit);
		}

		for (const group of product.modifierGroups) {
			const count = chosen.filter((c) => c.group.id === group.id).length;
			if (count < group.minSelect) {
				lineErrors.push({
					code: "modifier_below_min",
					lineIndex,
					productId: product.id,
					groupId: group.id,
					min: group.minSelect,
				});
			} else if (count > group.maxSelect) {
				lineErrors.push({
					code: "modifier_above_max",
					lineIndex,
					productId: product.id,
					groupId: group.id,
					max: group.maxSelect,
				});
			}
		}

		if (lineErrors.length > 0) {
			errors.push(...lineErrors);
			return;
		}

		// Snapshot modifiers in menu order (group order, then option order), not click order.
		const groupOrder = new Map(product.modifierGroups.map((g, i) => [g.id, i]));
		const optionOrder = new Map(
			product.modifierGroups.flatMap((g) =>
				g.options.map((o, i) => [o.id, i] as const),
			),
		);
		chosen.sort(
			(a, b) =>
				(groupOrder.get(a.group.id) ?? 0) - (groupOrder.get(b.group.id) ?? 0) ||
				(optionOrder.get(a.option.id) ?? 0) -
					(optionOrder.get(b.option.id) ?? 0),
		);

		lines.push({
			productId: product.id,
			categoryId: product.categoryId,
			name: product.name,
			quantity: item.quantity,
			listUnitPrice: product.price,
			taxBps: product.taxBps,
			modifiers: chosen.map(({ group, option }) => ({
				groupId: group.id,
				optionId: option.id,
				name: option.name,
				priceDelta: option.priceDelta,
			})),
			note: item.note ?? null,
		});
	});

	return errors.length > 0 ? { ok: false, errors } : { ok: true, value: lines };
}

/** resolveCart + priceLines: the server path for guest/QR and group-cart orders. */
export function priceCart(
	cart: readonly CartLine[],
	catalog: Catalog,
	ctx: PricingContext,
): Result<PricedOrder> {
	const resolved = resolveCart(cart, catalog);
	if (!resolved.ok) return resolved;
	return priceLines(resolved.value, ctx);
}

/**
 * Build a Catalog from the flat MenuSnapshot shape (products carry
 * modifierGroupIds, groups are listed once). Group order follows
 * modifierGroupIds; unknown group ids are ignored.
 */
export function buildCatalog(
	products: readonly (Omit<CatalogProduct, "modifierGroups"> & {
		readonly modifierGroupIds: readonly string[];
	})[],
	modifierGroups: readonly CatalogModifierGroup[],
): Catalog {
	const groups = new Map(modifierGroups.map((g) => [g.id, g]));
	return new Map(
		products.map((p) => [
			p.id,
			{
				id: p.id,
				categoryId: p.categoryId,
				name: p.name,
				price: p.price,
				taxBps: p.taxBps,
				isAvailable: p.isAvailable,
				modifierGroups: p.modifierGroupIds.flatMap((id) => {
					const g = groups.get(id);
					return g ? [g] : [];
				}),
			},
		]),
	);
}

/** Menu card helper: the product's unit price right now, before modifiers and tax handling. */
export function promotedUnitPrice(
	product: Pick<CatalogProduct, "id" | "categoryId" | "price">,
	promotions: readonly Promotion[],
	at: LocalClock,
	locationId: string | null = null,
): { unitPrice: Minor; listUnitPrice: Minor; promotionId: string | null } {
	const promo = selectPromotion(
		promotions,
		{ productId: product.id, categoryId: product.categoryId },
		at,
		locationId,
	);
	return {
		unitPrice: promo ? applyPromotion(product.price, promo) : product.price,
		listUnitPrice: product.price,
		promotionId: promo?.id ?? null,
	};
}
