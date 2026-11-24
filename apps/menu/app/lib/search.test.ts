import { describe, expect, it } from "vitest";
import type { MenuProduct } from "./contracts";
import { fold, matcher } from "./search";

const p = (en: string, ar: string, desc = ""): MenuProduct =>
	({
		id: en,
		categoryId: "c",
		name: { en, ar },
		description: desc ? { en: desc } : null,
		price: 100,
		taxRateBps: 0,
		imageUrl: null,
		isAvailable: true,
		sortOrder: 0,
		modifierGroupIds: [],
	}) as unknown as MenuProduct;

describe("fold", () => {
	it("ignores case, accents and Arabic letter variants", () => {
		expect(fold("Café LATTE")).toBe("cafe latte");
		expect(fold("قَهْوَة")).toBe("قهوه");
		expect(fold("إفطار")).toBe(fold("افطار"));
		expect(fold("مـــلـح")).toBe("ملح");
	});
});

describe("matcher", () => {
	const latte = p(
		"Spanish latte",
		"سبانش لاتيه",
		"Double espresso, condensed milk",
	);
	it("matches every word anywhere in names and descriptions", () => {
		expect(matcher("latte milk")?.(latte)).toBe(true);
		expect(matcher("LATTE  spanish")?.(latte)).toBe(true);
		expect(matcher("لاتيه")?.(latte)).toBe(true);
		expect(matcher("latte tea")?.(latte)).toBe(false);
	});
	it("is null for an empty query", () => {
		expect(matcher("   ")).toBeNull();
	});
});
