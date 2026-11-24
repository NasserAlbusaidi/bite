import type { TillCustomer } from "@bite/contracts";
import { describe, expect, it } from "vitest";
import { pointsFor, rewardOff, type TillGuest } from "./loyalty.js";

const customer: TillCustomer = {
	id: "0193a1b2-0000-7000-9000-000000000001",
	name: "Sara",
	phone: "+96891234567",
	points: 200,
	visitCount: 4,
	program: {
		enabled: true,
		pointsPerRial: 10,
		rewards: [
			{ id: "coffee", name: { en: "Free coffee" }, points: 150, value: 1600 },
			{ id: "big", name: { en: "5 OMR off" }, points: 600, value: 5000 },
		],
	},
};
const guest = (
	rewardId: string | null,
	c: TillCustomer | null = customer,
): TillGuest => ({
	phone: customer.phone,
	name: "Sara",
	customer: c,
	rewardId,
});

describe("till loyalty", () => {
	it("takes the reward off, capped at the bill", () => {
		expect(rewardOff(guest("coffee"), 4200)).toEqual({
			rewardId: "coffee",
			amount: 1600,
			points: 150,
		});
		expect(rewardOff(guest("coffee"), 1200)?.amount).toBe(1200);
	});

	it("applies nothing without a reward, points or a known guest", () => {
		expect(rewardOff(guest(null), 4200)).toBeNull();
		expect(rewardOff(guest("big"), 9000)).toBeNull();
		expect(rewardOff(guest("coffee", null), 4200)).toBeNull();
		expect(rewardOff(null, 4200)).toBeNull();
		expect(
			rewardOff(
				guest("coffee", {
					...customer,
					program: { ...customer.program, enabled: false },
				}),
				4200,
			),
		).toBeNull();
	});

	it("earns on money paid only", () => {
		expect(pointsFor(guest("coffee"), 2600)).toBe(26);
		expect(pointsFor(guest(null, null), 2600)).toBe(0);
		expect(pointsFor(guest(null), 0)).toBe(0);
	});
});
