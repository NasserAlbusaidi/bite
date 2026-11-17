import type { PricedLine } from "@bite/core";
import type { MenuIndex } from "../lib/cart";
import { type Lang, loc, type T } from "../lib/i18n";
import type { Currency } from "../lib/money";
import { Price } from "./Price";

export type CartLineRow = {
	key: string;
	productId: string;
	quantity: number;
	modifierOptionIds: readonly string[];
	note?: string | null;
	failed?: boolean;
	priced?: PricedLine | undefined;
};

type Props = {
	rows: CartLineRow[];
	idx: MenuIndex;
	lang: Lang;
	t: T;
	currency: Currency;
	/** Omit to render read-only lines (someone else's items in a group cart). */
	onChangeQty?: (key: string, delta: 1 | -1) => void;
};

export function CartLines({
	rows,
	idx,
	lang,
	t,
	currency,
	onChangeQty,
}: Props) {
	return (
		<ul className="lines">
			{rows.map((l) => {
				const p = idx.products.get(l.productId);
				const mods = l.modifierOptionIds
					.map((id) => {
						const g = idx.groups.get(idx.optionGroup.get(id) ?? "");
						const o = g?.options.find((x) => x.id === id);
						return o ? loc(o.name, lang) : null;
					})
					.filter(Boolean)
					.join(", ");
				return (
					<li key={l.key} className={`line${l.failed ? " is-failed" : ""}`}>
						<div className="line__info">
							<strong>
								{onChangeQty ? "" : `${l.quantity} × `}
								{p ? loc(p.name, lang) : "?"}
							</strong>
							{mods && <span className="muted small">{mods}</span>}
							{l.note && <span className="muted small">“{l.note}”</span>}
							{l.failed && (
								<span className="chip chip--bad">{t("unavailable_tag")}</span>
							)}
						</div>
						{onChangeQty && (
							<div className="stepper stepper--sm">
								<button
									type="button"
									onClick={() => onChangeQty(l.key, -1)}
									aria-label={t("decrease_qty")}
								>
									−
								</button>
								<output>{l.quantity}</output>
								<button
									type="button"
									onClick={() => onChangeQty(l.key, 1)}
									aria-label={t("increase_qty")}
								>
									+
								</button>
							</div>
						)}
						{l.priced && !l.failed && (
							<Price
								className="line__price"
								amount={l.priced.lineGross}
								currency={currency}
								lang={lang}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}
