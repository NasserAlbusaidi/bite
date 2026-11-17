/**
 * Money is an integer count of the smallest currency unit (baisa for OMR,
 * 1 OMR = 1000 baisa). Floats never touch money: every operation stays in
 * safe integers and rounding is explicit, half away from zero.
 */
declare const brand: unique symbol;
export type Minor = number & { readonly [brand]: "Minor" };

/** Percentage rates are integer basis points: 5% = 500. */
export type BasisPoints = number & { readonly [brand]: "BasisPoints" };

const BPS_SCALE = 10_000;

function assertSafeInt(n: number, what: string): void {
	if (!Number.isSafeInteger(n)) {
		throw new RangeError(`${what} must be a safe integer, got ${n}`);
	}
}

export function minor(n: number): Minor {
	assertSafeInt(n, "Money");
	return n as Minor;
}

export function bps(n: number): BasisPoints {
	assertSafeInt(n, "Rate");
	if (n < 0) throw new RangeError(`Rate must be >= 0, got ${n}`);
	return n as BasisPoints;
}

export const ZERO = 0 as Minor;

export function add(a: Minor, b: Minor): Minor {
	return minor(a + b);
}

export function sub(a: Minor, b: Minor): Minor {
	return minor(a - b);
}

export function sum(values: readonly Minor[]): Minor {
	return values.reduce<Minor>((acc, v) => add(acc, v), ZERO);
}

export function times(a: Minor, qty: number): Minor {
	assertSafeInt(qty, "Quantity");
	return minor(a * qty);
}

/** Integer division of n / d, rounded half away from zero. d > 0. */
export function divRound(n: number, d: number): number {
	assertSafeInt(n, "Numerator");
	assertSafeInt(d, "Denominator");
	if (d <= 0) throw new RangeError("Denominator must be > 0");
	const sign = n < 0 ? -1 : 1;
	const abs = Math.abs(n);
	const q = Math.floor(abs / d);
	const r = abs - q * d;
	const rounded = r * 2 >= d ? q + 1 : q;
	return rounded === 0 ? 0 : sign * rounded;
}

/** amount * rate, e.g. tax on a tax-exclusive price or a percentage discount. */
export function applyRate(amount: Minor, rate: BasisPoints): Minor {
	return minor(divRound(amount * rate, BPS_SCALE));
}

/** Tax portion contained in a tax-inclusive gross amount. */
export function taxFromInclusive(gross: Minor, rate: BasisPoints): Minor {
	const net = divRound(gross * BPS_SCALE, BPS_SCALE + rate);
	return minor(gross - net);
}

/** Parse a decimal string ("1.250", "-0.5") into minor units without floats. */
export function parseDecimal(input: string, decimals = 3): Minor {
	const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(input.trim());
	if (!m) throw new SyntaxError(`Not a decimal amount: "${input}"`);
	const [, neg, whole = "0", frac = ""] = m;
	if (frac.length > decimals) {
		throw new RangeError(`"${input}" has more than ${decimals} decimal places`);
	}
	const digits = whole + frac.padEnd(decimals, "0");
	const value = Number(digits);
	return minor(neg && value !== 0 ? -value : value);
}

/** Format minor units as a fixed decimal string ("1.250"). */
export function formatDecimal(amount: Minor, decimals = 3): string {
	const neg = amount < 0;
	const s = Math.abs(amount)
		.toString()
		.padStart(decimals + 1, "0");
	const whole = s.slice(0, s.length - decimals);
	const frac = decimals > 0 ? `.${s.slice(-decimals)}` : "";
	return `${neg ? "-" : ""}${whole}${frac}`;
}
