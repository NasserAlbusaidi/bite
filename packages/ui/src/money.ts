import { formatDecimal, type Minor } from "@bite/core";
import type { Lang } from "./i18n";

export type Currency = { code: string; decimals: number };

const AR_SYMBOLS: Record<string, string> = {
	OMR: "ر.ع.",
	AED: "د.إ",
	SAR: "ر.س",
	BHD: "د.ب",
	KWD: "د.ك",
	QAR: "ر.ق",
};

export const currencyLabel = (currency: Currency, lang: Lang) =>
	lang === "ar" ? (AR_SYMBOLS[currency.code] ?? currency.code) : currency.code;

/** U+2212, the typographic minus. Wider than a hyphen, so a refund reads as one. */
export const MINUS = "−";

/**
 * Integer minor units → "1.250 OMR" / "1.250 ر.ع.". Western digits in both
 * languages, like Omani receipts. No floats: the digits come from core.
 */
export function formatMoney(
	amount: number,
	currency: Currency,
	lang: Lang,
	opts: { signed?: boolean } = {},
): string {
	const digits = formatDecimal(Math.abs(amount) as Minor, currency.decimals);
	const sign = amount < 0 ? MINUS : opts.signed && amount > 0 ? "+" : "";
	return `${sign}${digits} ${currencyLabel(currency, lang)}`;
}
