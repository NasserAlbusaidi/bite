import { describe, expect, it } from "vitest";
import { contrast, parseHex, tenantAccent } from "./contrast";

describe("contrast", () => {
	it("matches known WCAG ratios", () => {
		expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
		expect(contrast("#7AC70C", "#FFFFFF")).toBeCloseTo(2.1, 1);
		expect(contrast("#004225", "#7AC70C")).toBeGreaterThan(4.5);
	});

	it("parses short and long hex, rejects junk", () => {
		expect(parseHex("#fff")).toEqual([255, 255, 255]);
		expect(parseHex("0B6B2E")).toEqual([11, 107, 46]);
		expect(parseHex("red")).toBeNull();
		expect(() => contrast("red", "#fff")).toThrow(RangeError);
	});
});

describe("tenantAccent", () => {
	it("uses a dark shop colour with white text and as the link colour", () => {
		const a = tenantAccent("#8B1E3F");
		expect(a.usable).toBe(true);
		expect(a.vars["--on-action"]).toBe("#FFFFFF");
		expect(a.vars["--link"]).toBe("#8b1e3f");
	});

	it("uses a light shop colour with dark text but keeps the theme link colour", () => {
		const a = tenantAccent("#F2C14E");
		expect(a.usable).toBe(true);
		expect(a.vars["--on-action"]).toBe("#16241B");
		expect(a.vars["--link"]).toBeUndefined();
	});

	it("falls back to Bite when neither text colour is readable", () => {
		// Mid-tone: under 4.5:1 against both white and charcoal.
		expect(tenantAccent("#7A7A7A").usable).toBe(false);
		expect(tenantAccent("#7A7A7A").vars).toEqual({});
	});

	it("ignores missing or malformed input", () => {
		expect(tenantAccent(null).usable).toBe(false);
		expect(tenantAccent("not-a-colour").usable).toBe(false);
	});
});
