import { describe, expect, it } from "vitest";
import {
	affordableRewards,
	type LoyaltyProgram,
	maskPhone,
	nextReward,
	normalizePhone,
	pointsEarned,
	redeem,
} from "./loyalty.js";
import { minor } from "./money.js";

const program: LoyaltyProgram = {
	enabled: true,
	pointsPerRial: 10,
	rewards: [
		{
			id: "coffee",
			name: { en: "Free coffee" },
			points: 50,
			value: minor(1500),
		},
		{ id: "cake", name: { en: "Cake" }, points: 120, value: minor(3000) },
	],
};

describe("pointsEarned", () => {
	it("rounds down per rial", () => {
		expect(pointsEarned(program, minor(2950))).toBe(29);
		expect(pointsEarned(program, minor(999))).toBe(9);
		expect(pointsEarned(program, minor(99))).toBe(0);
	});
	it("is zero when off, or for refunds", () => {
		expect(pointsEarned({ ...program, enabled: false }, minor(5000))).toBe(0);
		expect(pointsEarned(program, minor(-5000))).toBe(0);
	});
});

describe("redeem", () => {
	it("caps the tender at what is owed", () => {
		const r = redeem(program, 60, "coffee", minor(1200));
		expect(r).toMatchObject({ ok: true, amount: 1200 });
		expect(redeem(program, 60, "coffee", minor(4000))).toMatchObject({
			ok: true,
			amount: 1500,
		});
	});
	it("refuses short balances, unknown rewards, paid bills, a disabled program", () => {
		expect(redeem(program, 49, "coffee", minor(100))).toEqual({
			ok: false,
			error: "not_enough_points",
		});
		expect(redeem(program, 500, "nope", minor(100))).toMatchObject({
			error: "unknown_reward",
		});
		expect(redeem(program, 500, "coffee", minor(0))).toMatchObject({
			error: "nothing_due",
		});
		expect(
			redeem({ ...program, enabled: false }, 500, "coffee", minor(100)),
		).toMatchObject({ error: "program_disabled" });
	});
});

describe("next and affordable rewards", () => {
	it("points to the cheapest reward out of reach", () => {
		expect(nextReward(program, 10)).toMatchObject({
			reward: { id: "coffee" },
			pointsToGo: 40,
		});
		expect(nextReward(program, 80)).toMatchObject({
			reward: { id: "cake" },
			pointsToGo: 40,
		});
		expect(nextReward(program, 500)).toBeNull();
		expect(affordableRewards(program, 130).map((r) => r.id)).toEqual([
			"coffee",
			"cake",
		]);
	});
});

describe("normalizePhone", () => {
	it("reads local Omani numbers and international forms", () => {
		expect(normalizePhone("9123 4567")).toBe("+96891234567");
		expect(normalizePhone("+968 9123-4567")).toBe("+96891234567");
		expect(normalizePhone("0096891234567")).toBe("+96891234567");
		expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
	});
	it("rejects junk", () => {
		expect(normalizePhone("123")).toBeNull();
		expect(normalizePhone("hello")).toBeNull();
		expect(normalizePhone("+0123456789")).toBeNull();
	});
	it("masks", () => {
		expect(maskPhone("+96891234567")).toBe("•••• 4567");
	});
});
