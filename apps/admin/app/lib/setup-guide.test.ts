import { describe, expect, it } from "vitest";
import type {
	AdminDevice,
	AdminLocationSettings,
	AdminMenu,
	AdminStaff,
} from "./contracts";
import { type GuideStep, nextStep, setupGuide } from "./setup-guide";

const loc = {
	id: "b1",
	taxBps: 500,
	vatNumber: null,
	address: null,
	phone: null,
	businessHours: null,
} as unknown as AdminLocationSettings;
const empty: AdminMenu = { categories: [], products: [], modifierGroups: [] };

describe("setupGuide", () => {
	it("a brand-new branch has every step open", () => {
		const steps = setupGuide({
			location: loc,
			menu: empty,
			staff: [],
			devices: [],
			ticked: new Set(),
		});
		expect(steps.filter((s) => s.done)).toEqual([]);
		expect(steps.find((s) => s.key === "till")?.to).toBe("/devices");
	});
	it("counts only this branch's floor staff and live devices", () => {
		const staff = [
			{
				isActive: true,
				hasPin: true,
				orgRole: "staff",
				locations: [{ locationId: "b2", role: "cashier" }],
			},
			{ isActive: true, hasPin: true, orgRole: "owner", locations: [] },
		] as unknown as AdminStaff[];
		const devices = [
			{
				kind: "pos",
				revokedAt: "2026-01-01T00:00:00Z",
				lastSeenAt: "2026-01-01T00:00:00Z",
			},
			{ kind: "kds", revokedAt: null, lastSeenAt: "2026-01-02T00:00:00Z" },
			// Added but nobody typed its code in: not done yet.
			{ kind: "pos", revokedAt: null, lastSeenAt: null },
		] as AdminDevice[];
		const steps = setupGuide({
			location: loc,
			menu: empty,
			staff,
			devices,
			ticked: new Set(),
		});
		const done = (k: string) => steps.find((s) => s.key === k)?.done;
		expect(done("team")).toBe(false);
		expect(done("till")).toBe(false);
		expect(done("kitchen")).toBe(true);
	});
	it("no VAT means no VAT number needed; QR is ticked by hand", () => {
		const steps = setupGuide({
			location: { ...loc, taxBps: 0 } as AdminLocationSettings,
			menu: empty,
			staff: [],
			devices: [],
			ticked: new Set(["qr"]),
		});
		expect(steps.find((s) => s.key === "vat")?.done).toBe(true);
		expect(steps.find((s) => s.key === "qr")?.done).toBe(true);
	});
});

describe("nextStep", () => {
	const step = (key: GuideStep["key"], done: boolean, optional = false) =>
		({ key, done, optional, to: "/" }) as GuideStep;
	it("suggests the first open must-do step before optional ones", () => {
		expect(
			nextStep([
				step("qr", false, true),
				step("menu", true),
				step("till", false),
			])?.key,
		).toBe("till");
	});
	it("falls back to an optional step, then to nothing", () => {
		expect(nextStep([step("menu", true), step("qr", false, true)])?.key).toBe(
			"qr",
		);
		expect(nextStep([step("menu", true)])).toBeUndefined();
	});
});
