import { describe, expect, it } from "vitest";
import {
	cartReducer,
	EMPTY_CART,
	estimateCart,
	indexMenu,
	itemCount,
	lineKey,
	parseStoredCart,
	toLineInputs,
	validateSelection,
} from "./cart";
import { demoMenu } from "./fixtures.server";

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
	it("sums list price + deltas in integer baisa", () => {
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
		// 3 × 1.200 + (1.600 + 0.300 + 0.400)
		expect(estimateCart(c, idx)).toBe(3600 + 2300);
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
