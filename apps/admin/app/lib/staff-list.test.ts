import { describe, expect, it } from "vitest";
import type { AdminStaff } from "./contracts";
import {
	filterStaff,
	initials,
	randomPin,
	staffCounts,
	weakPin,
} from "./staff-list";

const s = (p: Partial<AdminStaff> & { displayName: string }): AdminStaff => ({
	id: p.displayName,
	email: null,
	orgRole: "staff",
	hasPin: true,
	isActive: true,
	locations: [],
	...p,
});
const A = "loc-a";
const B = "loc-b";
const staff = [
	s({ displayName: "Owner", orgRole: "owner", email: "o@x.om" }),
	s({
		displayName: "Mona",
		email: "m@x.om",
		locations: [{ locationId: A, role: "manager" }],
	}),
	s({ displayName: "Aisha", locations: [{ locationId: A, role: "cashier" }] }),
	s({ displayName: "Badr", locations: [{ locationId: B, role: "kitchen" }] }),
	s({
		displayName: "New",
		hasPin: false,
		locations: [{ locationId: B, role: "manager" }],
	}),
	s({
		displayName: "Gone",
		isActive: false,
		locations: [{ locationId: A, role: "server" }],
	}),
];
const names = (list: AdminStaff[]) => list.map((x) => x.displayName);

describe("filterStaff", () => {
	it("hides deactivated people unless asked", () => {
		expect(
			names(filterStaff(staff, { q: "", filter: "all", locationId: A })),
		).not.toContain("Gone");
		expect(
			names(filterStaff(staff, { q: "", filter: "off", locationId: A })),
		).toEqual(["Gone"]);
	});
	it("filters to the branch, counting owners everywhere", () => {
		expect(
			names(filterStaff(staff, { q: "", filter: "branch", locationId: A })),
		).toEqual(["Aisha", "Mona", "Owner"]);
	});
	it("splits back office from floor staff", () => {
		expect(
			names(filterStaff(staff, { q: "", filter: "floor", locationId: A })),
		).toEqual(["Aisha", "Badr"]);
		expect(
			names(filterStaff(staff, { q: "", filter: "pending", locationId: A })),
		).toEqual(["New"]);
	});
	it("searches name and email", () => {
		expect(
			names(filterStaff(staff, { q: "m@x", filter: "all", locationId: A })),
		).toEqual(["Mona"]);
	});
	it("counts every chip", () => {
		expect(staffCounts(staff, B)).toEqual({
			all: 5,
			branch: 3,
			office: 3,
			floor: 2,
			pending: 1,
			off: 1,
		});
	});
});

describe("PINs", () => {
	it("flags guessable PINs", () => {
		for (const p of ["0000", "1234", "4321", "98765"])
			expect(weakPin(p)).toBe(true);
		for (const p of ["2580", "1357", "9071"]) expect(weakPin(p)).toBe(false);
	});
	it("never generates a weak PIN", () => {
		let i = 0;
		const seq = [0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.8, 0.0];
		const pin = randomPin(() => seq[i++ % seq.length] ?? 0);
		expect(pin).toBe("2580");
		for (let n = 0; n < 200; n++) {
			const p = randomPin();
			expect(p).toMatch(/^\d{4}$/);
			expect(weakPin(p)).toBe(false);
		}
	});
	it("initials take two words", () => {
		expect(initials("aisha al balushi")).toBe("AA");
		expect(initials("محمد")).toBe("م");
	});
});
