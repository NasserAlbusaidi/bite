import { describe, expect, it } from "vitest";
import {
	buildCatalog,
	type CatalogModifierGroup,
	priceCart,
	promotedUnitPrice,
	resolveCart,
} from "./cart.js";
import { bps } from "./money.js";
import { ctx, m, THU_2PM } from "./test-helpers.js";

const size: CatalogModifierGroup = {
	id: "size",
	name: { en: "Size" },
	minSelect: 1,
	maxSelect: 1,
	options: [
		{ id: "small", name: { en: "Small" }, priceDelta: m(0), isAvailable: true },
		{
			id: "large",
			name: { en: "Large" },
			priceDelta: m(400),
			isAvailable: true,
		},
	],
};
const extras: CatalogModifierGroup = {
	id: "extras",
	name: { en: "Extras" },
	minSelect: 0,
	maxSelect: 2,
	options: [
		{ id: "shot", name: { en: "Shot" }, priceDelta: m(300), isAvailable: true },
		{ id: "oat", name: { en: "Oat" }, priceDelta: m(200), isAvailable: false },
		{
			id: "syrup",
			name: { en: "Syrup" },
			priceDelta: m(150),
			isAvailable: true,
		},
		{
			id: "cream",
			name: { en: "Cream" },
			priceDelta: m(100),
			isAvailable: true,
		},
	],
};
const catalog = buildCatalog(
	[
		{
			id: "latte",
			categoryId: "coffee",
			name: { en: "Latte" },
			price: m(1500),
			taxBps: null,
			isAvailable: true,
			modifierGroupIds: ["size", "extras", "nope"],
		},
		{
			id: "cake",
			categoryId: "sweets",
			name: { en: "Cake" },
			price: m(2000),
			taxBps: bps(0),
			isAvailable: false,
			modifierGroupIds: [],
		},
	],
	[size, extras],
);

describe("resolveCart / priceCart", () => {
	it("prices a valid cart with modifiers in menu order", () => {
		const r = priceCart(
			[
				{
					productId: "latte",
					quantity: 2,
					modifierOptionIds: ["shot", "large"],
				},
			],
			catalog,
			ctx({ taxBps: bps(500) }),
		);
		if (!r.ok) throw new Error(JSON.stringify(r.errors));
		const l = r.value.lines[0];
		expect(l?.modifiers.map((x) => x.optionId)).toEqual(["large", "shot"]);
		expect([l?.unitTotal, l?.lineTotal, l?.lineTax]).toEqual([2200, 4400, 220]);
		expect(r.value.total).toBe(4620);
	});

	it("collects every error, not just the first", () => {
		const r = resolveCart(
			[
				{ productId: "ghost", quantity: 1, modifierOptionIds: [] },
				{ productId: "cake", quantity: 1, modifierOptionIds: [] },
				{ productId: "latte", quantity: 1, modifierOptionIds: [] },
				{
					productId: "latte",
					quantity: 1,
					modifierOptionIds: ["small", "small"],
				},
				{
					productId: "latte",
					quantity: 1,
					modifierOptionIds: ["small", "oat"],
				},
				{
					productId: "latte",
					quantity: 1,
					modifierOptionIds: ["small", "bogus"],
				},
				{
					productId: "latte",
					quantity: 1,
					modifierOptionIds: ["small", "large"],
				},
				{
					productId: "latte",
					quantity: 1,
					modifierOptionIds: ["small", "shot", "syrup", "cream"],
				},
			],
			catalog,
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.errors.map((e) => [e.lineIndex, e.code])).toEqual([
			[0, "unknown_product"],
			[1, "product_unavailable"],
			[2, "modifier_below_min"],
			[3, "duplicate_modifier"],
			[4, "modifier_unavailable"],
			[5, "invalid_modifier"],
			[6, "modifier_above_max"],
			[7, "modifier_above_max"],
		]);
	});

	it("promotedUnitPrice for menu cards", () => {
		expect(
			promotedUnitPrice(
				{ id: "latte", categoryId: "coffee", price: m(1500) },
				[{ id: "hh", kind: "percent", value: 2000, categoryId: "coffee" }],
				THU_2PM,
			),
		).toEqual({ unitPrice: 1200, listUnitPrice: 1500, promotionId: "hh" });
	});
});
