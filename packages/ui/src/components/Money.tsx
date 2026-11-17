import { formatDecimal, type Minor } from "@bite/core";
import { RIAL_PATH, RIAL_VIEWBOX } from "../brand/paths";
import { useUi } from "../context";
import { type Currency, currencyLabel, MINUS } from "../money";
import { cx } from "./cx";

export type MoneyProps = {
	/** Integer minor units (baisa for OMR). */
	amount: number;
	currency: Currency;
	/** Show "+" on positive amounts (modifier price deltas). */
	signed?: boolean;
	/**
	 * "code" writes OMR / ر.ع. (default). "sign" draws the Rial sign for OMR,
	 * with the code as its accessible name; other currencies fall back to code.
	 */
	symbol?: "code" | "sign";
	className?: string;
};

/**
 * One amount. The digits and their sign sit in their own left-to-right
 * isolate, so "−1.250" never turns into "1.250−" inside Arabic text (the bug
 * where refunds read as positive). The currency follows in reading order:
 * "1.250 OMR" in English, and in Arabic the symbol sits to the left of the
 * amount, as it does when an Arabic writer types it. Tabular digits so
 * columns line up.
 */
export function Money({
	amount,
	currency,
	signed = false,
	symbol = "code",
	className,
}: MoneyProps) {
	const { lang, dir } = useUi();
	const sign = amount < 0 ? MINUS : signed && amount > 0 ? "+" : "";
	const digits = formatDecimal(Math.abs(amount) as Minor, currency.decimals);
	const label = currencyLabel(currency, lang);
	return (
		<bdi
			dir={dir}
			className={cx(
				"bite-money",
				amount < 0 && "bite-money--negative",
				className,
			)}
		>
			<bdi dir="ltr">
				{sign}
				{digits}
			</bdi>{" "}
			{symbol === "sign" && currency.code === "OMR" ? (
				<svg
					className="bite-money__sign"
					viewBox={RIAL_VIEWBOX}
					role="img"
					aria-label={label}
				>
					<path d={RIAL_PATH} fill="currentColor" />
				</svg>
			) : (
				<bdi>{label}</bdi>
			)}
		</bdi>
	);
}
