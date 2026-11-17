import type { Lang, T } from "../lib/i18n";
import type { Currency } from "../lib/money";
import { Price } from "./Price";

/** Order summary from @bite/core. Matches what the server will charge. */
export function Totals({
	order,
	lang,
	t,
	currency,
}: {
	order: {
		subtotal: number;
		discountTotal: number;
		taxTotal: number;
		total: number;
		pricesIncludeTax: boolean;
	} | null;
	lang: Lang;
	t: T;
	currency: Currency;
}) {
	if (!order) return null;
	return (
		<dl className="summary">
			{order.discountTotal > 0 && (
				<>
					<dt>{t("you_save")}</dt>
					<dd className="sale">
						<Price
							amount={order.discountTotal}
							currency={currency}
							lang={lang}
						/>
					</dd>
				</>
			)}
			<dt>
				{t("tax")}
				{order.pricesIncludeTax && (
					<span className="muted small"> ({t("tax_included")})</span>
				)}
			</dt>
			<dd>
				<Price amount={order.taxTotal} currency={currency} lang={lang} />
			</dd>
			<dt className="strong">{t("total")}</dt>
			<dd className="strong">
				<Price amount={order.total} currency={currency} lang={lang} />
			</dd>
		</dl>
	);
}
