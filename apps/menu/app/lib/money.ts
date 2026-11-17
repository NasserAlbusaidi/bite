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

/**
 * "1.250 OMR" / "1.250 ر.ع.". Western digits in both languages, matching the
 * legacy app and Omani receipts. No floats: formatting goes through core.
 */
export function formatMoney(
	amount: number,
	currency: Currency,
	lang: Lang,
): string {
	const value = formatDecimal(amount as Minor, currency.decimals);
	const symbol =
		lang === "ar"
			? (AR_SYMBOLS[currency.code] ?? currency.code)
			: currency.code;
	return `${value} ${symbol}`;
}
