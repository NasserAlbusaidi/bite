import { describe, expect, it } from "vitest";
import { AdminApiError } from "./api-types";
import { DEMO_LOCATIONS, demoState, fixtureAdminApi } from "./fixtures";
import {
	hhmmToMinutes,
	locationFormDefaults,
	minutesToHHMM,
	parseLocationForm,
	pausedUntil,
	TICKET_PREFIX,
} from "./location-form";

const base = DEMO_LOCATIONS[0];
if (!base) throw new Error("no demo location");

const formFrom = (over: Record<string, string> = {}) => {
	const d = locationFormDefaults(base);
	const f = new FormData();
	const fields: Record<string, string> = {
		name: d.name,
		taxPercent: d.taxPercent,
		dayCutoff: d.dayCutoff,
		pricesIncludeTax: d.pricesIncludeTax ? "on" : "",
		...over,
	};
	for (const [k, v] of Object.entries(fields)) if (v !== "") f.append(k, v);
	return f;
};

describe("location form", () => {
	it("round-trips tax and the day cutoff through integers", () => {
		const r = parseLocationForm(
			formFrom({ taxPercent: "5", dayCutoff: "04:30" }),
			base,
		);
		expect(r.ok && [r.value.taxBps, r.value.dayCutoffMinutes]).toEqual([
			500, 270,
		]);
		expect(minutesToHHMM(270)).toBe("04:30");
		expect(hhmmToMinutes("24:00")).toBeNull();
	});

	it("fills all seven days, blank = closed, and keeps split shifts", () => {
		const withSplit = {
			...base,
			businessHours: {
				sat: [
					{ open: "07:00", close: "11:00" },
					{ open: "17:00", close: "23:00" },
				],
				sun: [],
				mon: [],
				tue: [],
				wed: [],
				thu: [],
				fri: [],
			},
		};
		const r = parseLocationForm(
			formFrom({
				"open:sat": "08:00",
				"close:sat": "12:00",
				"open:fri": "16:00",
				"close:fri": "01:00",
			}),
			withSplit,
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const h = r.value.businessHours;
		expect(h && Object.keys(h).sort()).toEqual([
			"fri",
			"mon",
			"sat",
			"sun",
			"thu",
			"tue",
			"wed",
		]);
		expect(h?.sat).toEqual([
			{ open: "08:00", close: "12:00" },
			{ open: "17:00", close: "23:00" },
		]);
		expect(h?.fri).toEqual([{ open: "16:00", close: "01:00" }]);
		expect(h?.mon).toEqual([]);
	});

	it("leaves owner-only fields out for managers", () => {
		const r = parseLocationForm(formFrom({ taxPercent: "junk" }), base, true);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		for (const k of [
			"name",
			"taxBps",
			"pricesIncludeTax",
			"vatNumber",
			"dayCutoffMinutes",
		])
			expect(k in r.value).toBe(false);
	});

	it("no hours at all means null, and half a range is an error", () => {
		const none = parseLocationForm(formFrom(), base);
		expect(none.ok && none.value.businessHours).toBeNull();
		const half = parseLocationForm(formFrom({ "open:mon": "08:00" }), base);
		expect(half.ok).toBe(false);
	});

	it("knows the ticket prefix rule and pause math", () => {
		expect(["A", "KD", "Z"].every((p) => TICKET_PREFIX.test(p))).toBe(true);
		expect(
			["Q", "QA", "G", "a", "ABC", ""].some((p) => TICKET_PREFIX.test(p)),
		).toBe(false);
		expect(pausedUntil(30, Date.UTC(2026, 10, 17, 10, 0))).toBe(
			"2026-11-17T10:30:00.000Z",
		);
		expect(pausedUntil(null)).toBeNull();
	});
});

describe("demo devices api", () => {
	it("registers once per prefix, shows a token, and revokes", async () => {
		const a = fixtureAdminApi(demoState(), null);
		const r = await a.registerDevice({
			locationId: base.id,
			name: "Patio tablet",
			kind: "pos",
			ticketPrefix: "B",
		});
		expect(r.token.length).toBeGreaterThan(10);
		await expect(
			a.registerDevice({
				locationId: base.id,
				name: "Dup",
				kind: "pos",
				ticketPrefix: "B",
			}),
		).rejects.toMatchObject({ status: 409 });
		await expect(
			a.registerDevice({
				locationId: base.id,
				name: "QR",
				kind: "pos",
				ticketPrefix: "Q",
			}),
		).rejects.toBeInstanceOf(AdminApiError);
		await a.revokeDevice(r.deviceId);
		const d = (await a.devices(base.id)).find((x) => x.id === r.deviceId);
		expect(d?.revokedAt).not.toBeNull();
	});

	it("renames a location and /me follows", async () => {
		const a = fixtureAdminApi(demoState(), null);
		await a.updateLocation(base.id, { name: "Azaiba Beach" });
		const me = await a.me();
		expect(
			me.locations.find((l) => l.location.id === base.id)?.location.name,
		).toBe("Azaiba Beach");
	});
});
