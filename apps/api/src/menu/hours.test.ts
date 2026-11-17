import { describe, expect, it } from "vitest";
import { isOpenAt } from "./hours.js";

const at = (iso: string) => new Date(iso);
const allWeek = (open: string, close: string) =>
	Object.fromEntries(
		["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
			d,
			[{ open, close }],
		]),
	) as Record<string, { open: string; close: string }[]>;

describe("isOpenAt (Asia/Muscat, UTC+4)", () => {
	it("null hours means always open", () => {
		expect(isOpenAt(null, "Asia/Muscat", at("2026-11-17T00:00:00Z"))).toBe(
			true,
		);
	});
	it("respects a same-day window in local time", () => {
		const h = allWeek("08:00", "22:00");
		expect(
			isOpenAt(h as never, "Asia/Muscat", at("2026-11-17T04:00:00Z")),
		).toBe(true); // 08:00
		expect(
			isOpenAt(h as never, "Asia/Muscat", at("2026-11-17T03:59:00Z")),
		).toBe(false); // 07:59
		expect(
			isOpenAt(h as never, "Asia/Muscat", at("2026-11-17T18:00:00Z")),
		).toBe(false); // 22:00
	});
	it("handles windows that wrap midnight", () => {
		const h = allWeek("18:00", "02:00");
		expect(
			isOpenAt(h as never, "Asia/Muscat", at("2026-11-17T21:30:00Z")),
		).toBe(true); // 01:30 next day
		expect(
			isOpenAt(h as never, "Asia/Muscat", at("2026-11-17T22:00:00Z")),
		).toBe(false); // 02:00
		expect(
			isOpenAt(h as never, "Asia/Muscat", at("2026-11-17T14:00:00Z")),
		).toBe(true); // 18:00
	});
	it("a day with no windows is closed", () => {
		const h = { ...allWeek("08:00", "22:00"), tue: [] };
		expect(
			isOpenAt(h as never, "Asia/Muscat", at("2026-11-17T08:00:00Z")),
		).toBe(false); // Tue 12:00
	});
});
