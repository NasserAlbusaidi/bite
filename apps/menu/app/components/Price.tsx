import type { Lang } from "../lib/i18n";
import { type Currency, formatMoney } from "../lib/money";

/** Amounts stay LTR inside RTL text. */
export function Price({
	amount,
	currency,
	lang,
	className,
	signed = false,
}: {
	amount: number;
	/** Show "+" on positive amounts (modifier deltas). */
	signed?: boolean;
	currency: Currency;
	lang: Lang;
	className?: string;
}) {
	return (
		<bdi dir="ltr" className={className}>
			{signed && amount > 0 ? "+" : ""}
			{formatMoney(amount, currency, lang)}
		</bdi>
	);
}
