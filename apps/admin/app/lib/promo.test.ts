import { describe, expect, it } from "vitest";
import { AdminApiError } from "./api-types";
import { demoState, fixtureAdminApi } from "./fixtures";
import {
	dayToInstant,
	instantToDay,
	parsePromoForm,
	promoFormDefaults,
} from "./promo-form";

const form = (entries: Record<string, string | string[]>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries))
		for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
	return f;
};

describe("promotion form", () => {
	it("stores percent as bps and fixed as minor units", () => {
		const pct = parsePromoForm(
			form({ name: "Lunch", kind: "percent", value: "12.5" }),
			3,
		);
		expect(pct.ok && pct.value.value).toBe(1250);
		const fixed = parsePromoForm(
			form({ name: "Lunch", kind: "fixed", value: "0.250" }),
			3,
		);
		expect(fixed.ok && fixed.value.value).toBe(250);
	});

	it("maps the target picker to product or category", () => {
		const r = parsePromoForm(
			form({ name: "x", kind: "percent", value: "10", target: "category:abc" }),
			3,
		);
		expect(r.ok && [r.value.categoryId, r.value.productId]).toEqual([
			"abc",
			null,
		]);
	});

	it("rejects over 100%, half a happy hour and ends before starts", () => {
		const r = parsePromoForm(
			form({
				name: "x",
				kind: "percent",
				value: "101",
				dailyStart: "07:00",
				startsOn: "2026-12-10",
				endsOn: "2026-12-01",
			}),
			3,
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(Object.keys(r.errors).sort()).toEqual([
			"dailyEnd",
			"endsOn",
			"value",
		]);
	});

	it("treats all seven days (or none) as every day", () => {
		const all = parsePromoForm(
			form({
				name: "x",
				kind: "percent",
				value: "5",
				daysOfWeek: ["0", "1", "2", "3", "4", "5", "6"],
			}),
			3,
		);
		expect(all.ok && all.value.daysOfWeek).toBeNull();
		const weekend = parsePromoForm(
			form({
				name: "x",
				kind: "percent",
				value: "5",
				daysOfWeek: ["6", "5", "5"],
			}),
			3,
		);
		expect(weekend.ok && weekend.value.daysOfWeek).toEqual([5, 6]);
	});

	it("round-trips a stored promotion through the form defaults", () => {
		const p = demoState().promotions[0];
		expect(p).toBeDefined();
		if (!p) return;
		const d = promoFormDefaults(p, 3);
		expect(d).toMatchObject({
			value: "20",
			kind: "percent",
			dailyStart: "07:00",
		});
		expect(instantToDay(dayToInstant("2026-12-01", false))).toBe("2026-12-01");
		expect(instantToDay(dayToInstant("2026-12-01", true))).toBe("2026-12-01");
	});
});

describe("demo promotions api", () => {
	const api = () => fixtureAdminApi(demoState(), null);

	it("creates, pauses and validates against the contract rules", async () => {
		const a = api();
		const created = await a.createPromotion({
			name: "Weekend",
			kind: "percent",
			value: 1000,
		});
		expect(created).toMatchObject({
			isActive: true,
			locationId: null,
			priority: 0,
		});
		await a.updatePromotion(created.id, { isActive: false });
		expect(
			(await a.promotions()).find((p) => p.id === created.id)?.isActive,
		).toBe(false);
		// Product and category together breaks the contract refine.
		const productId = (await a.menu()).products[0]?.id ?? null;
		const categoryId = (await a.menu()).categories[0]?.id ?? null;
		await expect(
			a.updatePromotion(created.id, { productId, categoryId }),
		).rejects.toBeInstanceOf(AdminApiError);
	});
});
