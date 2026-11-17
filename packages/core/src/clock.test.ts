import { describe, expect, it } from "vitest";
import {
	addDays,
	businessDate,
	clockAt,
	localClock,
	parseTimeOfDay,
} from "./clock.js";

describe("clock", () => {
	it("localClock resolves Muscat wall time (UTC+4)", () => {
		const c = localClock(Date.parse("2026-11-17T21:30:15Z"), "Asia/Muscat");
		expect(c.date).toBe("2026-11-18");
		expect(c.secondOfDay).toBe(1 * 3600 + 30 * 60 + 15);
		expect(c.weekday).toBe(3); // Wednesday
	});

	it("midnight is 0, not 24", () => {
		expect(
			localClock(Date.parse("2026-11-17T20:00:00Z"), "Asia/Muscat").secondOfDay,
		).toBe(0);
	});

	it("businessDate respects the day cutoff", () => {
		const t = Date.parse("2026-11-17T21:30:00Z"); // 01:30 on the 18th in Muscat
		expect(businessDate(t, "Asia/Muscat", 240)).toBe("2026-11-17");
		expect(businessDate(t, "Asia/Muscat", 0)).toBe("2026-11-18");
		expect(businessDate(t, "Asia/Muscat", 90)).toBe("2026-11-18"); // exactly at cutoff
		expect(() => businessDate(t, "Asia/Muscat", 1440)).toThrow(RangeError);
	});

	it("date helpers", () => {
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(clockAt("2026-03-19", "14:00").weekday).toBe(4);
		expect(parseTimeOfDay("23:59:59")).toBe(86399);
		expect(() => parseTimeOfDay("24:00")).toThrow(RangeError);
		expect(() => parseTimeOfDay("9:00")).toThrow(SyntaxError);
	});
});
