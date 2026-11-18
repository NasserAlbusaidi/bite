import { describe, expect, it } from "vitest";
import { type Cart, cartReducer, EMPTY_CART, indexMenu } from "./cart";
import type { MenuSnapshot } from "./contracts";
import {
	ACTIVE_TTL_MS,
	LAST_TTL_MS,
	orderSteps,
	parseActive,
	parseLast,
	reorderable,
} from "./recent";

const now = Date.parse("2026-11-18T10:00:00Z");
const token = "0193a1b2-0000-7000-8000-000000000001";

describe("order in progress", () => {
	it("round-trips and expires", () => {
		const stored = JSON.stringify({ token, ticket: "Q-12", at: now - 60_000 });
		expect(parseActive(stored, now)).toEqual({
			token,
			ticket: "Q-12",
			at: now - 60_000,
		});
		expect(parseActive(stored, now + ACTIVE_TTL_MS)).toBeNull();
	});
	it("drops anything malformed", () => {
		for (const bad of [
			null,
			"",
			"{",
			"null",
			JSON.stringify({ token: "../../admin", ticket: "Q-1", at: now }),
			JSON.stringify({ token, ticket: 12, at: now }),
			JSON.stringify({ token, ticket: "Q-1" }),
		])
			expect(parseActive(bad, now)).toBeNull();
	});
});

const line = (
	productId: string,
	modifierOptionIds: string[] = [],
	quantity = 1,
) => ({
	productId,
	modifierOptionIds,
	quantity,
});

describe("last order", () => {
	it("keeps valid lines and expires", () => {
		const stored = JSON.stringify({
			at: now,
			lines: [line("p1", [], 2), { productId: 7 }, line("p2", ["o1"])],
		});
		expect(
			parseLast(stored, now)?.lines.map((l) => [l.productId, l.quantity]),
		).toEqual([
			["p1", 2],
			["p2", 1],
		]);
		expect(parseLast(stored, now + LAST_TTL_MS + 1)).toBeNull();
	});
	it("is null when nothing usable is stored", () => {
		for (const bad of [
			null,
			"{",
			JSON.stringify({ at: now, lines: [] }),
			JSON.stringify({ lines: [line("p1")] }),
		])
			expect(parseLast(bad, now)).toBeNull();
	});
});

const name = (en: string) => ({ en });
const menu = {
	categories: [],
	products: [
		{
			id: "karak",
			name: name("Karak"),
			isAvailable: true,
			modifierGroupIds: [],
		},
		{
			id: "latte",
			name: name("Latte"),
			isAvailable: true,
			modifierGroupIds: ["milk"],
		},
		{ id: "rye", name: name("Rye"), isAvailable: false, modifierGroupIds: [] },
	],
	modifierGroups: [
		{
			id: "milk",
			name: name("Milk"),
			minSelect: 1,
			maxSelect: 1,
			options: [
				{ id: "oat", name: name("Oat"), isAvailable: true },
				{ id: "almond", name: name("Almond"), isAvailable: false },
			],
		},
	],
} as unknown as MenuSnapshot;

describe("order again", () => {
	const cart = (...lines: ReturnType<typeof line>[]): Cart =>
		lines.reduce((c, l) => cartReducer(c, { type: "add", ...l }), EMPTY_CART);
	it("keeps only what can be ordered exactly as before", () => {
		const idx = indexMenu(menu);
		const last = cart(
			line("karak", [], 2),
			line("latte", ["oat"]),
			line("latte", ["almond"]), // that milk is out today
			line("latte"), // milk is required
			line("rye"), // sold out
			line("gone"), // off the menu
		);
		expect(
			reorderable(last, idx).map((l) => [l.productId, l.modifierOptionIds]),
		).toEqual([
			["karak", []],
			["latte", ["oat"]],
		]);
	});
});

describe("tracker steps", () => {
	const states = (paymentStatus: string, fulfillmentStatus: string) =>
		orderSteps({ paymentStatus, fulfillmentStatus })
			.map((s) => s.state)
			.join(" ");
	it("walks a pay-first order", () => {
		expect(states("unpaid", "pending")).toBe("done now todo todo");
		expect(states("paid", "pending")).toBe("done done now todo");
		expect(states("paid", "preparing")).toBe("done done now todo");
		expect(states("paid", "ready")).toBe("done done done now");
		expect(states("paid", "completed")).toBe("done done done done");
	});
	it("does not pretend an unpaid order was paid when the kitchen cooks first", () => {
		expect(states("unpaid", "preparing")).toBe("done todo now todo");
		expect(states("unpaid", "ready")).toBe("done todo done now");
	});
});
