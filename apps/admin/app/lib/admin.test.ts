import { describe, expect, it } from "vitest";
import { AdminApiError } from "./api-types";
import { DEMO_ME, demoState, fixtureAdminApi } from "./fixtures";
import { fromDecimal, toDecimal } from "./money";
import { currencyDecimals } from "./places";
import { parseProductForm, productFormDefaults } from "./product-form";

const form = (entries: Record<string, string | string[]>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries))
		for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
	return f;
};

describe("money", () => {
	it("parses decimals into integer baisa without floats", () => {
		expect(fromDecimal("1.25", 3)).toBe(1250);
		expect(fromDecimal(" 2 ", 3)).toBe(2000);
		expect(fromDecimal("0.001", 3)).toBe(1);
		expect(fromDecimal("0.1", 3)).toBe(100);
	});
	it("rejects junk, negatives and too many places", () => {
		for (const bad of ["", "-1", "1.2345", "abc", "1e3", "1,5", "."])
			expect(fromDecimal(bad, 3)).toBeNull();
	});
	it("round-trips through the display format", () => {
		expect(toDecimal(1250, 3)).toBe("1.250");
		expect(fromDecimal(toDecimal(987654, 3), 3)).toBe(987654);
	});
});

describe("product form", () => {
	const base = {
		nameEn: "Croissant",
		nameAr: "كرواسون",
		price: "0.850",
		categoryId: "cat",
		sortOrder: "3",
		isVisible: "on",
	};

	it("builds a SaveProduct with integer money and bps", () => {
		const r = parseProductForm(
			form({ ...base, taxPercent: "5.25", modifierGroupIds: ["a", "b"] }),
			3,
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.price).toBe(850);
		expect(r.value.taxBps).toBe(525);
		expect(r.value.name).toEqual({ en: "Croissant", ar: "كرواسون" });
		expect(r.value.modifierGroupIds).toEqual(["a", "b"]);
		expect(r.value.isVisible).toBe(true);
		expect(r.value.description).toBeNull();
		expect(r.value.dietaryTags).toEqual([]);
	});

	it("keeps ticked dietary tags in canonical order and drops unknown ones", () => {
		const r = parseProductForm(
			form({ ...base, dietaryTags: ["spicy", "bogus", "vegan"] }),
			3,
		);
		expect(r.ok && r.value.dietaryTags).toEqual(["vegan", "spicy"]);
	});

	it("reports every bad field at once", () => {
		const r = parseProductForm(
			form({
				nameEn: "",
				price: "1.2345",
				taxPercent: "101",
				categoryId: "",
				imageUrl: "http://x",
			}),
			3,
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(Object.keys(r.errors).sort()).toEqual(
			["categoryId", "imageUrl", "nameEn", "price", "taxPercent"].sort(),
		);
	});

	it("pre-fills from an existing product", () => {
		const p = demoState().menu.products[0];
		expect(p).toBeDefined();
		if (!p) return;
		const d = productFormDefaults(p, 3);
		expect(d.nameEn).toBe(p.name.en);
		expect(fromDecimal(d.price, 3)).toBe(p.price);
	});
});

describe("demo api", () => {
	const api = () => fixtureAdminApi(demoState(), null);
	const loc = DEMO_ME.locations[0]?.location.id ?? "";

	it("creates, updates and archives products", async () => {
		const a = api();
		const menu = await a.menu();
		const categoryId = menu.categories[0]?.id ?? "";
		const created = await a.createProduct({
			categoryId,
			name: { en: "Scone" },
			description: null,
			price: 600,
			taxBps: null,
			imageUrl: null,
			isVisible: true,
			sortOrder: 9,
			modifierGroupIds: [],
		});
		expect((await a.menu()).products.some((p) => p.id === created.id)).toBe(
			true,
		);
		await a.archiveProduct(created.id);
		const archived = (await a.menu()).products.find((p) => p.id === created.id);
		expect(archived?.archivedAt).not.toBeNull();
	});

	it("rejects unknown categories and fractional money", async () => {
		const a = api();
		const input = {
			categoryId: "0193a1b2-0000-7000-8000-ffffffffffff",
			name: { en: "X" },
			description: null,
			price: 100,
			taxBps: null,
			imageUrl: null,
			isVisible: true,
			sortOrder: 0,
			modifierGroupIds: [],
		};
		await expect(a.createProduct(input)).rejects.toBeInstanceOf(AdminApiError);
		const categoryId = (await a.menu()).categories[0]?.id ?? "";
		await expect(
			a.createProduct({ ...input, categoryId, price: 1.5 }),
		).rejects.toBeInstanceOf(AdminApiError);
	});

	it("stores per-location overrides and clears them when back to defaults", async () => {
		const a = api();
		const productId = (await a.menu()).products[0]?.id ?? "";
		const row = async (l: string) =>
			(await a.locationProducts(l)).find((s) => s.productId === productId);
		const base = (await row(loc))?.basePrice;
		await a.setLocationProduct(loc, productId, {
			price: 900,
			isAvailable: false,
		});
		expect(await row(loc)).toMatchObject({
			overridePrice: 900,
			effectivePrice: 900,
			isAvailable: false,
		});
		expect(await row(DEMO_ME.locations[1]?.location.id ?? "")).toMatchObject({
			overridePrice: null,
			effectivePrice: base,
			isAvailable: true,
		});
		await a.setLocationProduct(loc, productId, {
			price: null,
			isAvailable: true,
		});
		expect(await row(loc)).toMatchObject({
			overridePrice: null,
			effectivePrice: base,
		});
	});

	it("knows OMR has 3 minor digits and AED 2", () => {
		expect(currencyDecimals("OMR")).toBe(3);
		expect(currencyDecimals("AED")).toBe(2);
		expect(currencyDecimals("nope")).toBe(2);
	});

	it("404s on a location outside the org", async () => {
		await expect(
			api().locationProducts("0193a1b2-0000-7000-8000-000000000001"),
		).rejects.toMatchObject({
			status: 404,
		});
	});
});
