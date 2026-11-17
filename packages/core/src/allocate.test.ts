import { describe, expect, it } from "vitest";
import { allocate } from "./allocate.js";
import { m } from "./test-helpers.js";

describe("allocate", () => {
	it("always sums back to the total", () => {
		for (const total of [0, 1, 7, 100, 999_999, -10]) {
			for (const w of [[1], [1, 1, 1], [3, 7], [0, 5, 0, 2], [1000, 1, 1]]) {
				const parts = allocate(m(total), w);
				expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
			}
		}
	});

	it("largest remainder, ties to the earlier index", () => {
		expect(allocate(m(10), [1, 1, 1])).toEqual([4, 3, 3]);
		expect(allocate(m(100), [1, 2])).toEqual([33, 67]);
		expect(allocate(m(-10), [1, 1, 1])).toEqual([-4, -3, -3]);
	});

	it("rejects junk", () => {
		expect(() => allocate(m(1), [])).toThrow(RangeError);
		expect(() => allocate(m(1), [0, 0])).toThrow(RangeError);
		expect(() => allocate(m(1), [-1, 2])).toThrow(RangeError);
		expect(allocate(m(0), [0, 0])).toEqual([0, 0]);
	});
});
