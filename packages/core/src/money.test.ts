import { describe, expect, it } from "vitest";
import {
	add,
	applyRate,
	bps,
	divRound,
	formatDecimal,
	minor,
	parseDecimal,
	sum,
	taxFromInclusive,
	times,
} from "./money.js";

describe("money", () => {
	it("rejects non-integers", () => {
		expect(() => minor(1.5)).toThrow(RangeError);
		expect(() => minor(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
	});

	it("adds, sums and multiplies in integers", () => {
		expect(add(minor(100), minor(250))).toBe(350);
		expect(sum([minor(1), minor(2), minor(3)])).toBe(6);
		expect(times(minor(1250), 3)).toBe(3750);
	});

	it("rounds half away from zero", () => {
		expect(divRound(5, 10)).toBe(1);
		expect(divRound(4, 10)).toBe(0);
		expect(divRound(-5, 10)).toBe(-1);
		expect(Object.is(divRound(-4, 10), 0)).toBe(true);
	});

	it("applies a 5% rate", () => {
		// 1.250 OMR * 5% = 0.0625 -> 0.063
		expect(applyRate(minor(1250), bps(500))).toBe(63);
		expect(applyRate(minor(1000), bps(500))).toBe(50);
	});

	it("extracts tax from an inclusive price", () => {
		// 1.050 gross at 5% = 1.000 net + 0.050 tax
		expect(taxFromInclusive(minor(1050), bps(500))).toBe(50);
		// 1.000 gross at 5%: net 0.952380.. -> 0.952, tax 0.048
		expect(taxFromInclusive(minor(1000), bps(500))).toBe(48);
	});

	it("parses and formats OMR without floats", () => {
		expect(parseDecimal("1.25")).toBe(1250);
		expect(parseDecimal("0.001")).toBe(1);
		expect(parseDecimal("-2")).toBe(-2000);
		expect(() => parseDecimal("1.2345")).toThrow(RangeError);
		expect(() => parseDecimal("abc")).toThrow(SyntaxError);
		expect(formatDecimal(minor(1250))).toBe("1.250");
		expect(formatDecimal(minor(5))).toBe("0.005");
		expect(formatDecimal(minor(-2000))).toBe("-2.000");
		expect(formatDecimal(minor(150), 2)).toBe("1.50");
	});

	it("round-trips", () => {
		for (const s of ["0.000", "0.001", "12.345", "-7.010", "1000000.000"]) {
			expect(formatDecimal(parseDecimal(s))).toBe(s);
		}
	});
});
