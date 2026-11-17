import { formatDecimal, type Minor } from "@bite/core";
import type { Lang } from "../i18n/i18n.js";

export function fmt(amount: number, lang: Lang, decimals = 3): string {
	const n = formatDecimal(amount as Minor, decimals);
	return lang === "ar" ? `${n} ر.ع.` : `${n} OMR`;
}

/** "1.5" / "1.500" → baisa. Returns null if not a valid amount. */
export function parseAmount(input: string, decimals = 3): number | null {
	const m = /^(\d{0,7})(?:\.(\d{0,3}))?$/.exec(input.trim());
	if (!m || (m[1] === "" && !m[2])) return null;
	const whole = Number(m[1] || "0");
	const frac = Number((m[2] ?? "").padEnd(decimals, "0") || "0");
	return whole * 10 ** decimals + frac;
}
