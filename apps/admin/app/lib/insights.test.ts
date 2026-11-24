import { describe, expect, it } from "vitest";
import {
	delta,
	heatGrid,
	hourly,
	niceMax,
	presets,
	previousPeriod,
	shade,
} from "./insights";

describe("insights", () => {
	it("previous period is the same length right before", () => {
		expect(previousPeriod("2026-11-18", "2026-11-24")).toEqual({
			from: "2026-11-11",
			to: "2026-11-17",
		});
		expect(previousPeriod("2026-03-01", "2026-03-01")).toEqual({
			from: "2026-02-28",
			to: "2026-02-28",
		});
	});

	it("delta: whole percent, null without a base", () => {
		expect(delta(110, 100)).toEqual({ pct: 10, dir: "up" });
		expect(delta(90, 100)).toEqual({ pct: -10, dir: "down" });
		expect(delta(100, 100)).toEqual({ pct: 0, dir: "flat" });
		expect(delta(5, 0)).toEqual({ pct: null, dir: "up" });
		expect(delta(0, 0)).toEqual({ pct: null, dir: "flat" });
	});

	it("presets end today; last month is the whole previous month", () => {
		const p = Object.fromEntries(
			presets("2026-03-15").map((x) => [x.key, [x.from, x.to]]),
		);
		expect(p.last_7_days).toEqual(["2026-03-09", "2026-03-15"]);
		expect(p.this_month).toEqual(["2026-03-01", "2026-03-15"]);
		expect(p.last_month).toEqual(["2026-02-01", "2026-02-28"]);
	});

	it("heat grid trims to busy hours and finds the peak", () => {
		const g = heatGrid([
			{ weekday: 0, hour: 9, orders: 3, net: 0 },
			{ weekday: 4, hour: 12, orders: 7, net: 0 },
		]);
		expect(g.hours).toEqual([9, 10, 11, 12]);
		expect(g.busiest).toEqual({ weekday: 4, hour: 12, orders: 7 });
		expect(shade(0, 7)).toBe(0);
		expect(shade(1, 7)).toBe(1);
		expect(shade(7, 7)).toBe(4);
		expect(heatGrid([]).hours).toEqual([]);
	});

	it("hourly buckets in the shop's time zone", () => {
		const h = hourly(
			["2026-11-24T04:10:00Z", "2026-11-24T04:50:00Z", "2026-11-24T19:59:00Z"],
			"Asia/Muscat",
		);
		expect(h[8]).toBe(2);
		expect(h[23]).toBe(1);
	});

	it("nice axis tops", () => {
		expect(niceMax(0)).toBe(1);
		expect(niceMax(380)).toBe(500);
		expect(niceMax(1200)).toBe(2000);
		expect(niceMax(240)).toBe(250);
	});
});
