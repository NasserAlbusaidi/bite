import { describe, expect, it } from "vitest";
import { AdminApiError } from "./api-types";
import { demoState, fixtureAdminApi } from "./fixtures";
import {
	deltaLabel,
	deltaText,
	missingChoices,
	parseDelta,
	parseGroupForm,
	parseOptionForm,
	ruleLabel,
} from "./modifier-form";

const form = (entries: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.append(k, v);
	return f;
};

describe("price change", () => {
	it("parses into integer baisa, signed, never a float", () => {
		expect(parseDelta("0.3", 3)).toBe(300);
		expect(parseDelta("+0.300", 3)).toBe(300);
		expect(parseDelta("-0.2", 3)).toBe(-200);
		expect(parseDelta("−0.2", 3)).toBe(-200);
		expect(parseDelta("", 3)).toBe(0);
		expect(parseDelta("-0", 3)).toBe(0);
	});
	it("rejects junk and too many places", () => {
		for (const bad of ["abc", "1.2345", "--1", "1,5", "+", "0.3 OMR"])
			expect(parseDelta(bad, 3)).toBeNull();
	});
	it("round-trips through the input and reads with a sign", () => {
		expect(parseDelta(deltaText(-200, 3), 3)).toBe(-200);
		expect(deltaText(300, 3)).toBe("0.300");
		expect(deltaLabel(300, 3)).toBe("+0.300");
		expect(deltaLabel(-200, 3)).toBe("-0.200");
		expect(deltaLabel(0, 3)).toBe("");
	});
});

describe("option group form", () => {
	const base = {
		nameEn: "Milk",
		nameAr: "الحليب",
		minSelect: "1",
		maxSelect: "1",
	};
	it("builds the group", () => {
		expect(parseGroupForm(form(base))).toEqual({
			ok: true,
			value: {
				name: { en: "Milk", ar: "الحليب" },
				minSelect: 1,
				maxSelect: 1,
			},
		});
	});
	it("refuses a missing name, junk numbers and most below fewest", () => {
		const r = parseGroupForm(
			form({ ...base, nameEn: " ", minSelect: "3", maxSelect: "2" }),
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.errors.nameEn?.key).toBe("required_field");
		expect(r.errors.maxSelect?.key).toBe("choices_max_below_min");
		for (const bad of ["", "-1", "1.5", "0", "99"]) {
			const x = parseGroupForm(form({ ...base, maxSelect: bad }));
			expect(x.ok).toBe(false);
		}
	});
	it("says the rule in words", () => {
		const key = (minSelect: number, maxSelect: number) =>
			ruleLabel({ minSelect, maxSelect }).key;
		expect(key(0, 1)).toBe("rule_optional_one");
		expect(key(0, 3)).toBe("rule_optional_many");
		expect(key(1, 1)).toBe("rule_required_one");
		expect(key(2, 2)).toBe("rule_required_exact");
		expect(key(1, 3)).toBe("rule_required_range");
	});
});

describe("choice form", () => {
	it("builds a choice and refuses a bad price change", () => {
		expect(
			parseOptionForm(form({ nameEn: "Oat", priceDelta: "0.3" }), 3),
		).toEqual({ ok: true, value: { name: { en: "Oat" }, priceDelta: 300 } });
		const bad = parseOptionForm(form({ nameEn: "", priceDelta: "x" }), 3);
		expect(bad.ok).toBe(false);
		if (bad.ok) return;
		expect(Object.keys(bad.errors).sort()).toEqual(["nameEn", "priceDelta"]);
	});
});

describe("demo option groups", () => {
	it("creates a group, adds choices and edits them", async () => {
		const api = fixtureAdminApi(demoState());
		const g = await api.createModifierGroup({
			name: { en: "Size" },
			minSelect: 1,
			maxSelect: 1,
		});
		expect(g.options).toEqual([]);
		expect(missingChoices(g)).toBe(1);

		await api.createModifierOption(g.id, { name: { en: "Small" } });
		const two = await api.createModifierOption(g.id, {
			name: { en: "Large" },
			priceDelta: 500,
		});
		expect(
			two.options.map((o) => [o.name.en, o.priceDelta, o.sortOrder]),
		).toEqual([
			["Small", 0, 0],
			["Large", 500, 1],
		]);
		expect(missingChoices(two)).toBe(0);

		const small = two.options[0]?.id ?? "";
		const large = two.options[1]?.id ?? "";
		await api.updateModifierOption(g.id, small, { isAvailable: false });
		const off = await api.updateModifierOption(g.id, large, {
			isAvailable: false,
		});
		// Required, and nothing left to pick: guests are stuck.
		expect(missingChoices(off)).toBe(1);

		const renamed = await api.updateModifierGroup(g.id, {
			name: { en: "Cup size" },
			minSelect: 0,
			maxSelect: 1,
		});
		expect(renamed.name.en).toBe("Cup size");
		expect(missingChoices(renamed)).toBe(0);
		expect(
			(await api.menu()).modifierGroups.find((x) => x.id === g.id)?.name.en,
		).toBe("Cup size");
	});

	it("refuses most below fewest and unknown ids", async () => {
		const api = fixtureAdminApi(demoState());
		const [g] = (await api.menu()).modifierGroups;
		if (!g) throw new Error("no demo group");
		await expect(
			api.updateModifierGroup(g.id, { minSelect: 3 }),
		).rejects.toBeInstanceOf(AdminApiError);
		await expect(
			api.updateModifierOption(g.id, "nope", { isAvailable: false }),
		).rejects.toBeInstanceOf(AdminApiError);
		await expect(
			api.createModifierOption("nope", { name: { en: "x" } }),
		).rejects.toBeInstanceOf(AdminApiError);
	});
});
