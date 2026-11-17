import { Money } from "@bite/ui";
import type { Lang } from "../lib/i18n";
import type { Currency } from "../lib/money";

/**
 * An amount in the menu. Thin wrapper over @bite/ui Money, which keeps the
 * digits and sign left-to-right inside Arabic text. The language comes from
 * the UiProvider in root.tsx; `lang` stays in the props so call sites read
 * the same as before.
 */
export function Price({
	amount,
	currency,
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
		<Money
			amount={amount}
			currency={currency}
			signed={signed}
			{...(className ? { className } : {})}
		/>
	);
}
