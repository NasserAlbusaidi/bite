import { describe, expect, it } from "vitest";
import { errorKind } from "../components/ErrorPanel";
import { parsePasswordForm, passwordError } from "./account-form";
import { AdminApiError } from "./api-types";
import { noOrdersYet, setupSteps } from "./getting-started";

const form = (v: Record<string, string>) => {
	const f = new FormData();
	for (const [k, x] of Object.entries(v)) f.set(k, x);
	return f;
};

describe("change password form", () => {
	it("takes a good form and remembers the sign-out choice", () => {
		expect(
			parsePasswordForm(
				form({
					current: "old-password-1",
					next: "new-password-1",
					confirm: "new-password-1",
					signOutOthers: "on",
				}),
			),
		).toEqual({
			ok: true,
			current: "old-password-1",
			next: "new-password-1",
			signOutOthers: true,
		});
	});

	it("keeps spaces: a password is what was typed", () => {
		const r = parsePasswordForm(
			form({
				current: " old pass ",
				next: " new pass 12",
				confirm: " new pass 12",
			}),
		);
		expect(r).toMatchObject({
			ok: true,
			current: " old pass ",
			signOutOthers: false,
		});
	});

	it("refuses short, long, repeated and mistyped passwords", () => {
		const errors = (v: Record<string, string>) => {
			const r = parsePasswordForm(form(v));
			return r.ok ? {} : r.errors;
		};
		expect(errors({ current: "", next: "short", confirm: "short" })).toEqual({
			current: "required_field",
			next: "password_hint",
		});
		expect(
			errors({ current: "x", next: "a".repeat(129), confirm: "a".repeat(129) }),
		).toEqual({ next: "password_hint" });
		expect(
			errors({
				current: "same-password-1",
				next: "same-password-1",
				confirm: "same-password-1",
			}),
		).toEqual({ next: "password_same" });
		expect(
			errors({
				current: "old-password-1",
				next: "new-password-1",
				confirm: "new-password-2",
			}),
		).toEqual({ confirm: "password_mismatch" });
	});

	it("puts the server's answer on the right field", () => {
		expect(passwordError("INVALID_PASSWORD")).toEqual({
			current: "password_wrong",
		});
		expect(passwordError("PASSWORD_TOO_SHORT")).toEqual({
			next: "password_hint",
		});
		expect(passwordError("rate_limited")).toEqual({
			current: "password_change_failed",
		});
	});
});

describe("error pages", () => {
	it("sorts what was thrown into something a person can act on", () => {
		expect(errorKind(new AdminApiError("not_found", 404))).toBe("not_found");
		expect(errorKind(new AdminApiError("forbidden", 403))).toBe("forbidden");
		expect(errorKind(new TypeError("Failed to fetch"))).toBe("offline");
		expect(errorKind(new AdminApiError("internal", 500))).toBe("broken");
		expect(errorKind(new Error("boom"))).toBe("broken");
		expect(errorKind(undefined)).toBe("broken");
	});
});

describe("getting started", () => {
	const input = {
		locationId: "loc1",
		products: 0,
		withPin: 0,
		tablets: 0,
		orders: 0,
	};
	it("starts with nothing done and points at the right pages", () => {
		expect(setupSteps(input)).toEqual([
			{ key: "menu", done: false, to: "/menu" },
			{ key: "team", done: false, to: "/staff/new" },
			{ key: "tablet", done: false, to: "/devices" },
			{ key: "order", done: false, to: "/locations/loc1/settings" },
		]);
	});
	it("ticks each step from what exists", () => {
		const done = (v: Partial<typeof input>) =>
			setupSteps({ ...input, ...v })
				.filter((s) => s.done)
				.map((s) => s.key);
		expect(done({ products: 3 })).toEqual(["menu"]);
		expect(done({ products: 3, withPin: 1, tablets: 2 })).toEqual([
			"menu",
			"team",
			"tablet",
		]);
		expect(done({ orders: 1 })).toEqual(["order"]);
	});
	it("only shows while no branch took an order all week", () => {
		const b = (n: number) =>
			({ week: { orderCount: n } }) as Parameters<
				typeof noOrdersYet
			>[0][number];
		expect(noOrdersYet([b(0), b(0)])).toBe(true);
		expect(noOrdersYet([b(0), b(4)])).toBe(false);
		expect(noOrdersYet([])).toBe(true);
	});
});
