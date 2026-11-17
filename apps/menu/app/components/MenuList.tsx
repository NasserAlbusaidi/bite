import type { LocalClock } from "@bite/core";
import { Icon, Logo } from "@bite/ui";
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

	// Products on promotion right now, shown as a rail above the menu. Hidden
	// while searching so results stay in one list.
	const offers = q
		? []
		: menu.products
				.filter((p) => p.isAvailable)
				.map((p) => ({ p, price: cardPrice(pricing, p, at) }))
				.filter(
					({ price }) =>
						price.promotionId !== null && price.unitPrice < price.listUnitPrice,
				)
				.slice(0, 8);

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

				{offers.length > 0 && canOrder && (
					<section className="rail" aria-labelledby="offers-title">
						<h2 id="offers-title">{t("offers_title")}</h2>
						<ul className="rail__list">
							{offers.map(({ p, price }) => (
								<li key={p.id} className="rail__item">
									<button
										type="button"
										className="rail__card"
										onClick={() => onOpen(p)}
									>
										{p.imageUrl && (
											<img
												className="rail__img"
												src={p.imageUrl}
												alt=""
												width={240}
												height={180}
												loading="lazy"
												decoding="async"
											/>
										)}
										<span className="item__name">{loc(p.name, lang)}</span>
										<span>
											<Price
												amount={price.unitPrice}
												currency={currency}
												lang={lang}
												className="strong"
											/>{" "}
											<s className="muted small">
												<Price
													amount={price.listUnitPrice}
													currency={currency}
													lang={lang}
												/>
											</s>
										</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				)}

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
												<Icon name="plus" />
											</button>
										)}
									</li>
								);
							})}
						</ul>
					</section>
				))}
				<p className="powered">
					{t("powered_by")} <Logo height={18} />
				</p>
			</main>
		</>
	);
}
