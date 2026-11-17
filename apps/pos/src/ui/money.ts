import { type Currency, formatMoney } from "@bite/ui";
import type { Lang } from "../i18n/i18n.js";

/** The till's currency. Every location is in Oman today. */
export const OMR: Currency = { code: "OMR", decimals: 3 };

/**
 * Plain-text amount for strings and labels ("1.250 OMR", "−0.500 ر.ع.").
 * In JSX prefer `<Money amount={x} currency={OMR} />`, which isolates the
 * digits so a minus never jumps to the wrong side in Arabic.
 */
export function fmt(
	amount: number,
	lang: Lang,
	opts: { signed?: boolean } = {},
): string {
	return formatMoney(amount, OMR, lang, opts);
}

/** "1.5" / "1.500" → baisa. Returns null if not a valid amount. */
export function parseAmount(input: string, decimals = 3): number | null {
	const m = /^(\d{0,7})(?:\.(\d{0,3}))?$/.exec(input.trim());
	if (!m || (m[1] === "" && !m[2])) return null;
	const whole = Number(m[1] || "0");
	const frac = Number((m[2] ?? "").padEnd(decimals, "0") || "0");
	return whole * 10 ** decimals + frac;
}
