import { describe, expect, it } from "vitest";
import { clockAt } from "./clock.js";
import {
	applyPromotion,
	isPromotionActive,
	type Promotion,
	selectPromotion,
} from "./promotions.js";
import { m, THU_2PM } from "./test-helpers.js";

const target = { productId: "p1", categoryId: "c1" };

describe("applyPromotion: ported from legacy ProductDiscountTest / PricingRuleTest", () => {
	it("percent and fixed", () => {
		expect(
			applyPromotion(m(10000), { id: "a", kind: "percent", value: 2000 }),
		).toBe(8000);
		expect(
			applyPromotion(m(10000), { id: "a", kind: "fixed", value: 2000 }),
		).toBe(8000);
		expect(
			applyPromotion(m(1000), { id: "a", kind: "percent", value: 2000 }),
		).toBe(800);
	});

	it("fixed discount cannot go below zero", () => {
		expect(
			applyPromotion(m(1000), { id: "a", kind: "fixed", value: 2000 }),
		).toBe(0);
	});

	it("rounds the result half away from zero like legacy round(price - discount, 3)", () => {
		// 0.005 at 50% = 2.5 baisa → 3 (rounding the discount instead would give 2)
		expect(
			applyPromotion(m(5), { id: "a", kind: "percent", value: 5000 }),
		).toBe(3);
	});

	it("rejects bad values", () => {
		expect(() =>
			applyPromotion(m(100), { id: "a", kind: "percent", value: 10001 }),
		).toThrow(RangeError);
		expect(() =>
			applyPromotion(m(100), { id: "a", kind: "fixed", value: 0 }),
		).toThrow(RangeError);
	});
});

describe("isPromotionActive", () => {
	const p = (over: Partial<Promotion>): Promotion => ({
		id: "x",
		kind: "fixed",
		value: 1,
		...over,
	});

	it("inactive never matches", () => {
		expect(isPromotionActive(p({ isActive: false }), THU_2PM)).toBe(false);
	});

	it("daily window is inclusive at both ends (legacy boundary test)", () => {
		expect(
			isPromotionActive(p({ dailyStart: "14:00", dailyEnd: "14:00" }), THU_2PM),
		).toBe(true);
		expect(
			isPromotionActive(
				p({ dailyStart: "12:00", dailyEnd: "13:59:59" }),
				THU_2PM,
			),
		).toBe(false);
		expect(
			isPromotionActive(
				p({ dailyStart: "14:00:01", dailyEnd: "18:00" }),
				THU_2PM,
			),
		).toBe(false);
	});

	it("days of week (0 = Sunday, Thursday = 4)", () => {
		expect(isPromotionActive(p({ daysOfWeek: [4] }), THU_2PM)).toBe(true);
		expect(isPromotionActive(p({ daysOfWeek: [0, 6] }), THU_2PM)).toBe(false);
	});

	it("a window wrapping midnight counts against the day it opened", () => {
		const thursdayNight = p({
			dailyStart: "22:00",
			dailyEnd: "02:00",
			daysOfWeek: [4],
		});
		expect(
			isPromotionActive(thursdayNight, clockAt("2026-03-19", "23:00")),
		).toBe(true);
		expect(
			isPromotionActive(thursdayNight, clockAt("2026-03-20", "01:00")),
		).toBe(true); // Fri 1am
		expect(
			isPromotionActive(thursdayNight, clockAt("2026-03-19", "01:00")),
		).toBe(false); // Wed's night
		expect(
			isPromotionActive(thursdayNight, clockAt("2026-03-20", "03:00")),
		).toBe(false);
	});

	it("absolute range: start inclusive, end exclusive, accepts ISO strings", () => {
		const at = clockAt(
			"2026-03-19",
			"14:00",
			Date.parse("2026-03-19T10:00:00Z"),
		);
		expect(isPromotionActive(p({ startsAt: "2026-03-19T10:00:00Z" }), at)).toBe(
			true,
		);
		expect(isPromotionActive(p({ endsAt: "2026-03-19T10:00:00Z" }), at)).toBe(
			false,
		);
		expect(isPromotionActive(p({ startsAt: at.epochMs + 1 }), at)).toBe(false);
	});
});

describe("selectPromotion", () => {
	const product: Promotion = {
		id: "prod",
		kind: "percent",
		value: 3000,
		productId: "p1",
	};
	const category: Promotion = {
		id: "cat",
		kind: "percent",
		value: 1000,
		categoryId: "c1",
	};
	const menu: Promotion = { id: "menu", kind: "percent", value: 5000 };

	it("equal priority: product beats category beats menu (legacy precedence)", () => {
		expect(
			selectPromotion([menu, category, product], target, THU_2PM)?.id,
		).toBe("prod");
		expect(selectPromotion([menu, category], target, THU_2PM)?.id).toBe("cat");
		expect(selectPromotion([menu], target, THU_2PM)?.id).toBe("menu");
	});

	it("higher priority wins over specificity, and never stacks", () => {
		const loud = { ...menu, priority: 10 };
		expect(
			selectPromotion([product, category, loud], target, THU_2PM)?.id,
		).toBe("menu");
	});

	it("ties break on id, so every device picks the same one", () => {
		const a: Promotion = { id: "a", kind: "fixed", value: 1 };
		const b: Promotion = { id: "b", kind: "fixed", value: 2 };
		expect(selectPromotion([b, a], target, THU_2PM)?.id).toBe("a");
	});

	it("ignores promotions for other products and categories", () => {
		expect(
			selectPromotion(
				[
					{ ...product, productId: "p2" },
					{ ...category, categoryId: "c2" },
				],
				target,
				THU_2PM,
			),
		).toBeNull();
	});
});
