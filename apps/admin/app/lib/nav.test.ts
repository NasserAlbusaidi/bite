import { describe, expect, it } from "vitest";
import { currentNav, goTarget, matchScore, navItems } from "./nav";

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

describe("goTarget", () => {
	it("every page has its own key", () => {
		const keys = navItems("loc1").map((i) => i.go);
		expect(keys.every(Boolean)).toBe(true);
		expect(new Set([...keys, "a"]).size).toBe(keys.length + 1);
	});
	it("maps G then a key to a page", () => {
		const items = navItems("loc1");
		expect(goTarget(items, "s")).toBe("/staff");
		expect(goTarget(items, "B")).toBe("/locations/loc1/settings");
		expect(goTarget(items, "a")).toBe("/account");
		expect(goTarget(items, "z")).toBeUndefined();
		expect(goTarget(navItems(undefined), "b")).toBeUndefined();
	});
});
