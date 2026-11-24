import { describe, expect, it } from "vitest";
import { openStatus, suggestPrefix, vatExample } from "./branch-settings";
import type { AdminDevice } from "./contracts";
import type { Day } from "./location-form";

describe("vatExample", () => {
	it("splits a VAT-inclusive price", () => {
		// 1.000 OMR at 5% inclusive: VAT 1000*500/10500 = 47.6 -> 48
		expect(vatExample(1000, 500, true)).toEqual({
			net: 952,
			vat: 48,
			total: 1000,
		});
	});
	it("adds VAT on top of an exclusive price", () => {
		expect(vatExample(1000, 500, false)).toEqual({
			net: 1000,
			vat: 50,
			total: 1050,
		});
	});
	it("zero rate is a no-op", () => {
		expect(vatExample(1250, 0, false)).toEqual({
			net: 1250,
			vat: 0,
			total: 1250,
		});
	});
});

const week = (h: Partial<Record<Day, [string, string]>>) =>
	Object.fromEntries(
		(["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as Day[]).map((d) => [
			d,
			{ open: h[d]?.[0] ?? "", close: h[d]?.[1] ?? "" },
		]),
	) as Record<Day, { open: string; close: string }>;

describe("openStatus", () => {
	// Tuesday 24 Nov 2026, 10:00 in Muscat (UTC+4) = 06:00Z
	const tue10 = new Date("2026-11-24T06:00:00Z");
	it("open inside today's range", () => {
		expect(
			openStatus(week({ tue: ["08:00", "22:00"] }), "Asia/Muscat", tue10),
		).toEqual({ open: true, closes: "22:00" });
	});
	it("closed before opening, says when", () => {
		expect(
			openStatus(week({ tue: ["12:00", "22:00"] }), "Asia/Muscat", tue10),
		).toEqual({ open: false, opens: "12:00" });
	});
	it("counts yesterday's range that runs past midnight", () => {
		const tue1am = new Date("2026-11-23T21:00:00Z");
		expect(
			openStatus(week({ mon: ["18:00", "02:00"] }), "Asia/Muscat", tue1am),
		).toEqual({ open: true, closes: "02:00" });
	});
	it("no hours at all is unknown", () => {
		expect(openStatus(week({}), "Asia/Muscat", tue10)).toBeNull();
	});
	it("closed today, opens on the next open day", () => {
		expect(
			openStatus(week({ thu: ["09:00", "17:00"] }), "Asia/Muscat", tue10),
		).toEqual({ open: false, opens: "09:00" });
	});
});

describe("suggestPrefix", () => {
	const dev = (p: string, revoked = false) =>
		({
			ticketPrefix: p,
			revokedAt: revoked ? "2026-01-01T00:00:00Z" : null,
		}) as AdminDevice;
	it("skips used letters, G and Q", () => {
		expect(suggestPrefix([])).toBe("A");
		expect(
			suggestPrefix([
				dev("A"),
				dev("B"),
				dev("C"),
				dev("D"),
				dev("E"),
				dev("F"),
			]),
		).toBe("H");
		expect(suggestPrefix([dev("A", true)])).toBe("A");
	});
});
