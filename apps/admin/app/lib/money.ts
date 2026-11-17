import { formatDecimal, type Minor, parseDecimal } from "@bite/core";

/** "1.250" for display and inputs. Integer baisa in, string out. No floats. */
export const toDecimal = (amount: number, decimals: number) =>
	formatDecimal(amount as Minor, decimals);

/**
 * Parse what a manager typed ("1.25", "2", " 0.500 ") into minor units.
 * Null when it isn't a valid non-negative amount with at most `decimals` places.
 */
export function fromDecimal(input: string, decimals: number): number | null {
	const s = input.trim();
	if (!/^\d+(\.\d+)?$/.test(s)) return null;
	try {
		return parseDecimal(s, decimals);
	} catch {
		return null;
	}
}
