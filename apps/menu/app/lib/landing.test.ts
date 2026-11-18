import { describe, expect, it } from "vitest";
import {
	adminLinks,
	landingCopy,
	publicOrigin,
	structuredData,
} from "./landing.server";

/** Every string in the copy, with the path it sits at. */
function leaves(v: unknown, path = ""): [string, string][] {
	if (typeof v === "string") return [[path, v]];
	if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
	if (v && typeof v === "object")
		return Object.entries(v).flatMap(([k, x]) => leaves(x, `${path}.${k}`));
	return [];
}

describe("landing copy", () => {
	const en = leaves(landingCopy("en"));
	const ar = leaves(landingCopy("ar"));

	it("has the same shape in both languages", () => {
		expect(ar.map(([p]) => p)).toEqual(en.map(([p]) => p));
	});

	it("is actually translated", () => {
		// Prices are digits in both; everything else must differ.
		const same = en.filter(
			([p, s], i) => !p.includes(".till.lines") && ar[i]?.[1] === s,
		);
		expect(same).toEqual([]);
		expect(ar.every(([, s]) => s.trim().length > 0)).toBe(true);
	});

	it("names no price: plans are not public yet", () => {
		const text = [...en, ...ar]
			.filter(([p]) => !p.startsWith(".till"))
			.map(([, s]) => s)
			.join(" ");
		expect(text).not.toMatch(/\d+\.\d{3}|per month|free trial|شهري/i);
	});

	it("keeps the drawn till's sum honest", () => {
		for (const lang of ["en", "ar"] as const) {
			const { till } = landingCopy(lang);
			const baisa = till.lines.reduce(
				(s, [, price]) => s + Number(price.replace(".", "")),
				0,
			);
			expect(baisa).toBe(7600);
			expect(till.amount).toContain("7.600");
			expect(till.charge).toContain("7.600");
		}
	});
});

describe("landing links", () => {
	it("builds sign-up and log-in from the back office address", () => {
		expect(adminLinks("https://admin.bite.om/")).toEqual({
			signUp: "https://admin.bite.om/sign-in?mode=signup",
			signIn: "https://admin.bite.om/sign-in",
		});
		expect(adminLinks("http://localhost:5173")?.signIn).toBe(
			"http://localhost:5173/sign-in",
		);
	});

	it("shows no buttons without a usable address", () => {
		expect(adminLinks(undefined)).toBeNull();
		expect(adminLinks("")).toBeNull();
		expect(adminLinks("admin.bite.om")).toBeNull();
		expect(adminLinks("javascript:alert(1)")).toBeNull();
	});

	it("uses the scheme the visitor used, not the proxy's", () => {
		const req = (h: Record<string, string>) =>
			new Request("http://bite.om/ar", { headers: h });
		expect(publicOrigin(req({}))).toBe("http://bite.om");
		expect(publicOrigin(req({ "x-forwarded-proto": "https" }))).toBe(
			"https://bite.om",
		);
		expect(publicOrigin(req({ "x-forwarded-proto": "https, http" }))).toBe(
			"https://bite.om",
		);
		expect(publicOrigin(req({ "x-forwarded-proto": "gopher" }))).toBe(
			"http://bite.om",
		);
	});

	it("describes the product to search engines without an offer", () => {
		const ld = structuredData(landingCopy("ar"), "https://bite.om/ar", "ar");
		expect(ld).toMatchObject({
			"@type": "SoftwareApplication",
			name: "Bite",
			inLanguage: "ar",
			url: "https://bite.om/ar",
		});
		expect(ld).not.toHaveProperty("offers");
	});
});
