import { type Minor, minor } from "./money.js";

/**
 * Split `total` into integer parts proportional to `weights`, so the parts
 * always add back up to exactly `total` (largest remainder method).
 *
 * Leftover units go to the largest fractional remainders; ties go to the
 * earlier index, so the result is deterministic. Weights must be safe,
 * non-negative integers and at least one must be positive (unless total is 0).
 * A negative total is allocated as -allocate(-total).
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
	if (weights.length === 0) {
		if (total !== 0) throw new RangeError("Cannot allocate into zero parts");
		return [];
	}
	for (const w of weights) {
		if (!Number.isSafeInteger(w) || w < 0) {
			throw new RangeError(
				`Weights must be non-negative safe integers, got ${w}`,
			);
		}
	}
	if (total < 0)
		return allocate(minor(-total), weights).map((p) => minor(p === 0 ? 0 : -p));

	const weightSum = weights.reduce((a, b) => a + b, 0);
	if (!Number.isSafeInteger(weightSum))
		throw new RangeError("Weight sum overflows");
	if (weightSum === 0) {
		if (total !== 0)
			throw new RangeError("Cannot allocate into all-zero weights");
		return weights.map(() => minor(0));
	}
	if (!Number.isSafeInteger(total * weightSum)) {
		throw new RangeError("Allocation overflows safe integers");
	}

	const parts: number[] = [];
	const remainders: { index: number; rem: number }[] = [];
	let allocated = 0;
	weights.forEach((w, index) => {
		const exact = total * w;
		const floor = Math.floor(exact / weightSum);
		parts.push(floor);
		remainders.push({ index, rem: exact - floor * weightSum });
		allocated += floor;
	});

	let leftover = total - allocated;
	remainders.sort((a, b) => b.rem - a.rem || a.index - b.index);
	for (const r of remainders) {
		if (leftover === 0) break;
		parts[r.index] = (parts[r.index] ?? 0) + 1;
		leftover--;
	}
	return parts.map((p) => minor(p));
}
