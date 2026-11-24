import { describe, expect, it } from "vitest";
import {
	asciiDigits,
	parseMenuText,
	suggestArabic,
	TEMPLATES,
	withCategoryArabic,
} from "./menu-import";

describe("menu creator text", () => {
	it("reads categories, both names, prices and descriptions", () => {
		const r = parseMenuText(
			`# Coffee | قهوة
Flat white | فلات وايت | 1.600
- Karak, 0.4, Strong tea with cardamom

Desserts:
كنافة | Kunafa | 2 OMR`,
			3,
		);
		expect(r.issues).toEqual([]);
		expect(r.productCount).toBe(3);
		expect(r.categories.map((c) => [c.nameEn, c.nameAr])).toEqual([
			["Coffee", "قهوة"],
			["Desserts", null],
		]);
		expect(r.categories[0]?.products).toMatchObject([
			{ nameEn: "Flat white", nameAr: "فلات وايت", price: 1600 },
			{
				nameEn: "Karak",
				nameAr: null,
				price: 400,
				descriptionEn: "Strong tea with cardamom",
			},
		]);
		expect(r.categories[1]?.products[0]).toMatchObject({
			nameEn: "Kunafa",
			nameAr: "كنافة",
			price: 2000,
		});
	});

	it("puts products before any heading in a default category", () => {
		const r = parseMenuText("Water | 0.200", 3);
		expect(r.categories[0]?.nameEn).toBe("Menu");
		expect(r.categories[0]?.products[0]?.price).toBe(200);
	});

	it("reports lines without a readable price, never guessing", () => {
		const r = parseMenuText("# Food\nBurger\nFries | 1.23456", 3);
		expect(r.issues).toEqual([
			{ line: 2, kind: "no_price" },
			{ line: 3, kind: "no_price" },
		]);
		expect(r.categories[0]?.products.map((p) => p.price)).toEqual([null, null]);
	});

	it("reads Arabic-Indic digits and currency marks", () => {
		expect(asciiDigits("٠٫٤٠٠")).toBe("0.400");
		const r = parseMenuText("كرك | Karak | ٠٫٤٠٠ ر.ع", 3);
		expect(r.categories[0]?.products[0]?.price).toBe(400);
	});

	it("merges repeated categories instead of duplicating them", () => {
		const r = parseMenuText("# Drinks\nTea, 0.3\n# drinks\nWater, 0.2", 3);
		expect(r.categories).toHaveLength(1);
		expect(r.productCount).toBe(2);
	});

	it("reads a spreadsheet CSV by its header row", () => {
		const r = parseMenuText(
			`Category,Name,Name_AR,Price,Description
Coffee,Latte,لاتيه,1.800,"Milk, espresso"
Coffee,Mocha,,2.000,
Food,Shakshuka,شكشوكة,2.500,`,
			3,
		);
		expect(r.issues).toEqual([]);
		expect(r.categories.map((c) => c.nameEn)).toEqual(["Coffee", "Food"]);
		expect(r.categories[0]?.products[0]).toMatchObject({
			nameEn: "Latte",
			nameAr: "لاتيه",
			price: 1800,
			descriptionEn: "Milk, espresso",
		});
		expect(r.categories[0]?.products[1]?.nameAr).toBeNull();
	});

	it("suggests Arabic for known whole names only, and says so", () => {
		expect(suggestArabic("Iced Latte")).toBe("لاتيه مثلج");
		expect(suggestArabic("Iced latte with oat")).toBeNull();
		const r = parseMenuText("# Desserts\nCheesecake, 2", 3, {
			suggestArabic: true,
		});
		expect(r.categories[0]?.products[0]).toMatchObject({
			nameAr: "تشيز كيك",
			arSuggested: true,
		});
		expect(withCategoryArabic(r).categories[0]?.nameAr).toBe("الحلويات");
	});

	it("parses every template cleanly", () => {
		for (const text of Object.values(TEMPLATES)) {
			const r = parseMenuText(text, 3);
			expect(r.issues).toEqual([]);
			expect(r.productCount).toBeGreaterThan(8);
			for (const c of r.categories) {
				expect(c.nameAr).toBeTruthy();
				for (const p of c.products) expect(p.nameAr).toBeTruthy();
			}
		}
	});
});
