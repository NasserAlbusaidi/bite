import { describe, expect, it } from "vitest";
import {
	cartReducer,
	EMPTY_CART,
	indexMenu,
	itemCount,
	lineKey,
	parseStoredCart,
	toLineInputs,
	validateSelection,
} from "./cart";
import { demoMenu } from "./fixtures.server";
import { clockFor, menuPricing, priceSelection, quoteCart } from "./pricing";

const { menu } = demoMenu();
const idx = indexMenu(menu);
const croissant = menu.products.find((p) => p.name.en === "Butter croissant")!;
const flatWhite = menu.products.find((p) => p.name.en === "Flat white")!;
const [milk, extras] = menu.modifierGroups;
const opt = (g: typeof milk, en: string) =>
	g!.options.find((o) => o.name.en === en)!.id;

describe("cart reducer", () => {
	it("merges identical lines regardless of modifier order and caps at 99", () => {
		let c = cartReducer(EMPTY_CART, {
			type: "add",
			productId: "p",
			modifierOptionIds: ["b", "a"],
		});
		c = cartReducer(c, {
			type: "add",
			productId: "p",
			modifierOptionIds: ["a", "b"],
			quantity: 120,
		});
		expect(c.lines).toHaveLength(1);
		expect(c.lines[0]!.quantity).toBe(99);
		expect(c.lines[0]!.modifierOptionIds).toEqual(["a", "b"]);
	});

	it("keeps lines with different notes apart", () => {
		let c = cartReducer(EMPTY_CART, {
			type: "add",
			productId: "p",
			modifierOptionIds: [],
		});
		c = cartReducer(c, {
			type: "add",
			productId: "p",
			modifierOptionIds: [],
			note: "no nuts",
		});
		expect(c.lines).toHaveLength(2);
		expect(itemCount(c)).toBe(2);
	});

	it("drops a line when decremented to zero", () => {
		const c = cartReducer(EMPTY_CART, {
			type: "add",
			productId: "p",
			modifierOptionIds: [],
		});
		expect(
			cartReducer(c, { type: "decrement", key: lineKey("p", []) }).lines,
		).toEqual([]);
	});
});

describe("stored cart", () => {
	it("survives garbage and drops malformed lines", () => {
		expect(parseStoredCart("{nope")).toEqual(EMPTY_CART);
		expect(parseStoredCart(JSON.stringify({ lines: "x" }))).toEqual(EMPTY_CART);
		const c = parseStoredCart(
			JSON.stringify({
				lines: [
					{ productId: "p", quantity: 2, modifierOptionIds: [] },
					{ productId: "q", quantity: 1.5, modifierOptionIds: [] },
					{ productId: "r", quantity: 1, modifierOptionIds: [1] },
					{ productId: "s", quantity: 1, modifierOptionIds: [], price: 0 },
				],
			}),
		);
		expect(c.lines.map((l) => l.productId)).toEqual(["p", "s"]);
		expect(c.lines[1]).not.toHaveProperty("price");
	});
});

describe("modifier validation", () => {
	it("enforces min, max, membership and availability", () => {
		expect(validateSelection(flatWhite, idx, [])).toMatchObject({
			kind: "min",
			groupId: milk!.id,
		});
		expect(validateSelection(flatWhite, idx, [opt(milk, "Oat")])).toBeNull();
		expect(
			validateSelection(flatWhite, idx, [
				opt(milk, "Oat"),
				opt(milk, "Full cream"),
			]),
		).toMatchObject({
			kind: "max",
		});
		expect(validateSelection(flatWhite, idx, [opt(milk, "Almond")])).toEqual({
			kind: "invalid",
		});
		expect(validateSelection(croissant, idx, [opt(milk, "Oat")])).toEqual({
			kind: "invalid",
		});
		expect(
			validateSelection(flatWhite, idx, [opt(milk, "Oat"), opt(milk, "Oat")]),
		).toEqual({
			kind: "invalid",
		});
	});
});

describe("estimates and line inputs", () => {
	it("prices through core: promotion on the base, modifiers on top, VAT included", () => {
		const pricing = menuPricing(menu);
		const at = clockFor(pricing, Date.parse("2026-11-17T10:00:00Z"));
		let c = cartReducer(EMPTY_CART, {
			type: "add",
			productId: croissant.id,
			modifierOptionIds: [],
			quantity: 3,
		});
		c = cartReducer(c, {
			type: "add",
			productId: flatWhite.id,
			modifierOptionIds: [opt(milk, "Oat"), opt(extras, "Extra shot")],
		});
		const q = quoteCart(pricing, c, at);
		// Croissant 1.200 with 20% pastry promo = 0.960 x 3; flat white 1.600 + 0.300 + 0.400.
		expect(q.order?.total).toBe(2880 + 2300);
		expect(q.order?.discountTotal).toBe(720);
		expect(q.lineAt(0)?.lineGross).toBe(2880);
		expect(q.badIndexes.size).toBe(0);
		expect(
			priceSelection(pricing, flatWhite.id, [opt(milk, "Oat")], 2, at)?.total,
		).toBe(3800);
	});

	it("leaves sold-out lines out of the total and reports them", () => {
		const pricing = menuPricing(menu);
		const at = clockFor(pricing, Date.parse("2026-11-17T10:00:00Z"));
		const rye = menu.products.find((p) => !p.isAvailable)!;
		let c = cartReducer(EMPTY_CART, {
			type: "add",
			productId: rye.id,
			modifierOptionIds: [],
		});
		c = cartReducer(c, {
			type: "add",
			productId: croissant.id,
			modifierOptionIds: [],
		});
		const q = quoteCart(pricing, c, at);
		expect([...q.badIndexes]).toEqual([0]);
		expect(q.order?.total).toBe(960);
		expect(q.lineAt(0)).toBeUndefined();
		expect(q.lineAt(1)?.lineGross).toBe(960);
	});

	it("sends no prices and gives each line a fresh id mapped back to its key", () => {
		const c = cartReducer(EMPTY_CART, {
			type: "add",
			productId: croissant.id,
			modifierOptionIds: [],
		});
		const { lines, keyById } = toLineInputs(c);
		expect(Object.keys(lines[0]!).sort()).toEqual([
			"id",
			"modifierOptionIds",
			"productId",
			"quantity",
		]);
		expect(keyById.get(lines[0]!.id)).toBe(c.lines[0]!.key);
	});
});
