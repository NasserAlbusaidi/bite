import { describe, expect, it } from "vitest";
import { currentNav, matchScore, navItems } from "./nav";

describe("navItems", () => {
	it("hides branch pages until there is a branch", () => {
		const keys = navItems(undefined).map((i) => i.key);
		expect(keys).not.toContain("location_nav");
		expect(navItems("b1").map((i) => i.key)).toContain("location_nav");
	});
});

describe("currentNav", () => {
	const items = navItems("b1");
	it("picks the longest prefix", () => {
		expect(currentNav(items, "/menu/modifiers/g1")?.key).toBe(
			"modifier_groups",
		);
		expect(currentNav(items, "/menu/products/p1")?.key).toBe("menu");
		expect(currentNav(items, "/")?.key).toBe("overview");
		expect(currentNav(items, "/staff/s1")?.key).toBe("staff");
		expect(currentNav(items, "/orders")?.key).toBe("orders_title");
		expect(currentNav(items, "/drawers")?.key).toBe("drawers_title");
	});
	it("matches branch pages for any branch in the address", () => {
		expect(currentNav(items, "/locations/other/settings")?.key).toBe(
			"location_nav",
		);
	});
	it("does not treat a shared prefix as a match", () => {
		expect(currentNav(items, "/staffing")).toBeUndefined();
	});
});

describe("matchScore", () => {
	it("matches word starts in either language", () => {
		expect(matchScore("pri av", "Prices & availability")).toBeGreaterThan(0);
		expect(matchScore("staf", "Staff")).toBeGreaterThan(0);
		expect(matchScore("xyz", "Staff")).toBe(0);
		expect(matchScore("قهوه", "قهوة")).toBeGreaterThan(0);
		expect(matchScore("احمد", "أحمد")).toBeGreaterThan(0);
	});
	it("ranks a prefix above a middle match", () => {
		expect(matchScore("menu", "Menu")).toBeGreaterThan(
			matchScore("menu", "Guest menu"),
		);
	});
	it("an empty query matches everything", () => {
		expect(matchScore("  ", "anything")).toBe(1);
	});
});
