import { describe, expect, it } from "vitest";
import type { AdminProduct } from "./contracts";
import { demoState, fixtureAdminApi } from "./fixtures";
import {
	duplicateOf,
	endOf,
	filterCounts,
	matchesFilter,
	matchesQuery,
	moveBy,
	moveTo,
	reorderBody,
} from "./menu-view";

const product = (over: Partial<AdminProduct> = {}): AdminProduct => ({
	id: "p1",
	categoryId: "c1",
	name: { en: "Butter croissant", ar: "كرواسون بالزبدة" },
	description: null,
	price: 1200,
	taxBps: null,
	imageUrl: "https://img.example/c.jpg",
	isVisible: true,
	sortOrder: 0,
	modifierGroupIds: [],
	archivedAt: null,
	...over,
});

describe("menu search and filters", () => {
	it("searches both languages and descriptions, case-insensitively", () => {
		const p = product({ description: { en: "Laminated, French butter" } });
		expect(matchesQuery(p, "CROISS")).toBe(true);
		expect(matchesQuery(p, "بالزبدة")).toBe(true);
		expect(matchesQuery(p, "french")).toBe(true);
		expect(matchesQuery(p, "rye")).toBe(false);
		expect(matchesQuery(p, "  ")).toBe(true);
	});

	it("flags hidden, photo-less and untranslated products", () => {
		expect(matchesFilter(product({ isVisible: false }), "hidden")).toBe(true);
		expect(matchesFilter(product(), "hidden")).toBe(false);
		expect(matchesFilter(product({ imageUrl: null }), "no_photo")).toBe(true);
		expect(matchesFilter(product({ name: { en: "Rye" } }), "no_arabic")).toBe(
			true,
		);
		// An English description without its Arabic twin counts too.
		expect(
			matchesFilter(product({ description: { en: "Flaky" } }), "no_arabic"),
		).toBe(true);
		expect(matchesFilter(product(), "no_arabic")).toBe(false);
	});

	it("counts every filter", () => {
		const counts = filterCounts([
			product(),
			product({ id: "p2", isVisible: false, imageUrl: null }),
		]);
		expect(counts).toEqual({ all: 2, hidden: 1, no_photo: 1, no_arabic: 0 });
	});
});

describe("reordering", () => {
	const ids = ["a", "b", "c", "d"];
	it("drops an item into another's slot", () => {
		expect(moveTo(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
		expect(moveTo(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
		expect(moveTo(ids, "a", "a")).toBe(ids);
		expect(moveTo(ids, "x", "a")).toBe(ids);
	});
	it("steps up and down and stops at the ends", () => {
		expect(moveBy(ids, "b", -1)).toEqual(["b", "a", "c", "d"]);
		expect(moveBy(ids, "b", 1)).toEqual(["a", "c", "b", "d"]);
		expect(moveBy(ids, "a", -1)).toBe(ids);
		expect(moveBy(ids, "d", 1)).toBe(ids);
	});
	it("numbers the new order from zero", () => {
		expect(reorderBody(["b", "a"])).toEqual([
			{ id: "b", sortOrder: 0 },
			{ id: "a", sortOrder: 1 },
		]);
	});

	it("demo api applies a reorder and refuses unknown ids", async () => {
		const api = fixtureAdminApi(demoState(), null);
		const menu = await api.menu();
		const [first, second] = menu.categories;
		if (!first || !second) throw new Error("demo menu has categories");
		await api.reorderCategories([
			{ id: first.id, sortOrder: 1 },
			{ id: second.id, sortOrder: 0 },
		]);
		const after = await api.menu();
		expect(after.categories.find((c) => c.id === second.id)?.sortOrder).toBe(0);
		await expect(
			api.reorderProducts([
				{ id: "00000000-0000-7000-8000-000000000999", sortOrder: 0 },
			]),
		).rejects.toMatchObject({ code: "not_found" });
	});
});

describe("duplicate", () => {
	it("copies everything but starts hidden, at the end of its category", () => {
		const src = product({ modifierGroupIds: ["g1"], taxBps: 0 });
		const copy = duplicateOf(src, 7, { en: "(copy)", ar: "(نسخة)" });
		expect(copy).toMatchObject({
			name: { en: "Butter croissant (copy)", ar: "كرواسون بالزبدة (نسخة)" },
			price: 1200,
			taxBps: 0,
			isVisible: false,
			sortOrder: 7,
			modifierGroupIds: ["g1"],
		});
		expect(copy.modifierGroupIds).not.toBe(src.modifierGroupIds);
	});
	it("finds the end of a category, ignoring archived products", () => {
		const list = [
			product({ id: "a", sortOrder: 3 }),
			product({ id: "b", sortOrder: 9, archivedAt: "2026-01-01T00:00:00Z" }),
			product({ id: "c", categoryId: "c2", sortOrder: 20 }),
		];
		expect(endOf(list, "c1")).toBe(4);
		expect(endOf(list, "empty")).toBe(0);
	});
});
