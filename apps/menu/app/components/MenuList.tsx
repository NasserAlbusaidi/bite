import type { LocalClock } from "@bite/core";
import { useState } from "react";
import type { MenuProduct, MenuSnapshot } from "../lib/contracts";
import { type Lang, loc, type T } from "../lib/i18n";
import type { Currency } from "../lib/money";
import { cardPrice, type MenuPricing } from "../lib/pricing";
import { Price } from "./Price";

type Props = {
	menu: MenuSnapshot;
	pricing: MenuPricing;
	at: LocalClock;
	lang: Lang;
	t: T;
	currency: Currency;
	canOrder: boolean;
	onOpen: (p: MenuProduct) => void;
	onQuickAdd: (p: MenuProduct) => void;
};

/** Category nav, search and product list. Shared by solo and group ordering. */
export function MenuList({
	menu,
	pricing,
	at,
	lang,
	t,
	currency,
	canOrder,
	onOpen,
	onQuickAdd,
}: Props) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const sections = [...menu.categories]
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((c) => ({
			category: c,
			products: menu.products
				.filter((p) => p.categoryId === c.id)
				.filter(
					(p) =>
						!q ||
						p.name.en.toLowerCase().includes(q) ||
						(p.name.ar?.includes(query.trim()) ?? false),
				)
				.sort((a, b) => a.sortOrder - b.sortOrder),
		}))
		.filter((s) => s.products.length > 0);

	return (
		<>
			<nav className="catnav" aria-label="categories">
				{sections.map((s) => (
					<a key={s.category.id} href={`#c-${s.category.id}`} className="chip">
						{loc(s.category.name, lang)}
					</a>
				))}
			</nav>

			<main className="page">
				<input
					type="search"
					className="input"
					placeholder={t("search_menu")}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					aria-label={t("search_menu")}
				/>

				{sections.length === 0 && (
					<p className="empty">
						{q ? t("no_search_results") : t("no_items_available")}
					</p>
				)}

				{sections.map(({ category, products }) => (
					<section key={category.id} id={`c-${category.id}`} className="cat">
						<h2>{loc(category.name, lang)}</h2>
						<ul className="items">
							{products.map((p) => {
								const price = cardPrice(pricing, p, at);
								const onSale =
									price.promotionId !== null &&
									price.unitPrice < price.listUnitPrice;
								return (
									<li
										key={p.id}
										className={`item${p.isAvailable ? "" : " is-off"}`}
									>
										<button
											type="button"
											className="item__main"
											disabled={!p.isAvailable || !canOrder}
											onClick={() => onOpen(p)}
										>
											<span className="item__name">
												{loc(p.name, lang)}
												{onSale && p.isAvailable && (
													<span className="chip chip--sale">
														{t("on_sale")}
													</span>
												)}
											</span>
											{p.description && (
												<span className="item__desc muted">
													{loc(p.description, lang)}
												</span>
											)}
											<span className="item__price">
												{!p.isAvailable ? (
													t("sold_out")
												) : (
													<>
														<Price
															amount={price.unitPrice}
															currency={currency}
															lang={lang}
														/>
														{onSale && (
															<s className="muted small">
																<Price
																	amount={price.listUnitPrice}
																	currency={currency}
																	lang={lang}
																/>
															</s>
														)}
													</>
												)}
											</span>
										</button>
										{p.imageUrl && (
											<img
												className="item__img"
												src={p.imageUrl}
												alt=""
												width={88}
												height={88}
												loading="lazy"
												decoding="async"
											/>
										)}
										{p.isAvailable && canOrder && (
											<button
												type="button"
												className="add-btn"
												onClick={() => onQuickAdd(p)}
												aria-label={t("add_item_aria", {
													name: loc(p.name, lang),
												})}
											>
												+
											</button>
										)}
									</li>
								);
							})}
						</ul>
					</section>
				))}
				<p className="powered muted small">{t("powered_by")}</p>
			</main>
		</>
	);
}
