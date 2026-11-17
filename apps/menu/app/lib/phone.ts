/**
 * Normalise a guest-typed phone to E.164. Bare 8-digit numbers are Omani
 * (+968). Returns null when it can't be a phone number.
 */
export function toE164(
	input: string,
	defaultCountryCode = "968",
): string | null {
	let s = input.replace(/[\s\-().]/g, "");
	if (s.startsWith("00")) s = `+${s.slice(2)}`;
	if (/^\d{8}$/.test(s)) s = `+${defaultCountryCode}${s}`;
	if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
	return s;
}
