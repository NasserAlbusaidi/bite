import type { LocalClock } from "@bite/core";
import { Icon, Logo } from "@bite/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { DietaryTag, MenuProduct, MenuSnapshot } from "../lib/contracts";
import { DIET_ORDER } from "../lib/diet";
import { type Lang, loc, type T } from "../lib/i18n";
import type { Currency } from "../lib/money";
import { cardPrice, type MenuPricing } from "../lib/pricing";
import { matcher } from "../lib/search";
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
	/** Shown above the list, under the search box. Hidden while searching. */
	top?: ReactNode;
	/** Product just added to the cart: its + button shows a tick for a moment. */
	added?: string | null;
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
	top,
	added = null,
}: Props) {
	const [query, setQuery] = useState("");
	const [diet, setDiet] = useState<DietaryTag[]>([]);
	const match = matcher(query);
	const q = match !== null || diet.length > 0;
	// Only offer filters some product actually carries.
	const tagsInMenu = DIET_ORDER.filter((tag) =>
		menu.products.some((p) => p.dietaryTags?.includes(tag)),
	);
	const fits = (p: MenuProduct) =>
		diet.every((tag) => p.dietaryTags?.includes(tag));
	const sections = [...menu.categories]
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((c) => ({
			category: c,
			products: menu.products
				.filter((p) => p.categoryId === c.id)
				.filter((p) => (!match || match(p)) && fits(p))
				.sort((a, b) => a.sortOrder - b.sortOrder),
		}))
		.filter((s) => s.products.length > 0);
	const results = sections.reduce((n, s) => n + s.products.length, 0);
	const sectionKey = sections.map((s) => s.category.id).join(",");
	const active = useScrollSpy(sectionKey);
	const navRef = useRef<HTMLElement>(null);

	// Keep the current category's chip in view as the guest scrolls.
	useEffect(() => {
		if (!active) return;
		const chip = navRef.current?.querySelector<HTMLElement>(
			`[data-cat="${active}"]`,
		);
		const nav = navRef.current;
		if (!chip || !nav) return;
		const left = chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2;
		nav.scrollTo({ left, behavior: "smooth" });
	}, [active]);

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
			<nav className="catnav" aria-label="categories" ref={navRef}>
				{sections.map((s) => (
					<a
						key={s.category.id}
						href={`#c-${s.category.id}`}
						data-cat={s.category.id}
						className={`chip${active === s.category.id ? " is-active" : ""}`}
						aria-current={active === s.category.id ? "true" : undefined}
						onClick={(e) => {
							const el = document.getElementById(`c-${s.category.id}`);
							if (!el) return;
							e.preventDefault();
							el.scrollIntoView({ behavior: "smooth", block: "start" });
							history.replaceState(null, "", `#c-${s.category.id}`);
						}}
					>
						{loc(s.category.name, lang)}
					</a>
				))}
			</nav>

			<main className="page">
				<div className="search">
					<Icon name="search" className="search__icon" />
					<input
						type="search"
						className="input"
						placeholder={t("search_menu")}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") setQuery("");
						}}
						aria-label={t("search_menu")}
						enterKeyHint="search"
						autoComplete="off"
					/>
					{query && (
						<button
							type="button"
							className="search__clear"
							onClick={() => setQuery("")}
							aria-label={t("clear_search")}
						>
							<Icon name="close" />
						</button>
					)}
				</div>
				{tagsInMenu.length > 0 && (
					<fieldset className="diet">
						<legend className="bite-sr-only">{t("diet_filters")}</legend>
						{tagsInMenu.map((tag) => {
							const on = diet.includes(tag);
							return (
								<label
									key={tag}
									className={`chip diet__chip${on ? " is-on" : ""}`}
								>
									<input
										type="checkbox"
										checked={on}
										onChange={() =>
											setDiet((cur) =>
												on ? cur.filter((x) => x !== tag) : [...cur, tag],
											)
										}
									/>
									{on && <Icon name="check" />}
									{t(`diet_${tag}`)}
								</label>
							);
						})}
					</fieldset>
				)}

				{q && results > 0 && (
					<p className="muted small" aria-live="polite">
						{t("search_results", { count: results })}
					</p>
				)}

				{!q && top}

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
					<div className="empty" aria-live="polite">
						<Icon name="search" />
						<p>
							{match
								? t("no_search_results")
								: diet.length > 0
									? t("no_filter_results")
									: t("no_items_available")}
						</p>
						{q && (
							<button
								type="button"
								className="btn"
								onClick={() => {
									setQuery("");
									setDiet([]);
								}}
							>
								{t(diet.length > 0 ? "clear_filters" : "clear_search")}
							</button>
						)}
					</div>
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
											{p.dietaryTags && p.dietaryTags.length > 0 && (
												<span className="item__tags">
													{p.dietaryTags
														.filter(
															(tag) =>
																!(
																	tag === "vegetarian" &&
																	p.dietaryTags?.includes("vegan")
																),
														)
														.map((tag) => (
															<span key={tag} className={`tag tag--${tag}`}>
																{t(`diet_${tag}`)}
															</span>
														))}
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
												className={`add-btn${added === p.id ? " is-added" : ""}`}
												onClick={() => onQuickAdd(p)}
												aria-label={t("add_item_aria", {
													name: loc(p.name, lang),
												})}
											>
												<Icon name={added === p.id ? "check" : "plus"} />
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

/**
 * The category the guest is reading: the last section whose top has passed
 * just under the sticky category bar. Re-run when the visible sections change.
 */
function useScrollSpy(sectionKey: string): string | null {
	const [active, setActive] = useState<string | null>(null);
	useEffect(() => {
		const ids = sectionKey ? sectionKey.split(",") : [];
		if (ids.length === 0) return setActive(null);
		let frame = 0;
		const check = () => {
			frame = 0;
			const line = 140;
			let current = ids[0] ?? null;
			for (const id of ids) {
				const el = document.getElementById(`c-${id}`);
				if (el && el.getBoundingClientRect().top <= line) current = id;
			}
			// At the very bottom the last short section never reaches the line.
			if (
				window.innerHeight + window.scrollY >=
				document.documentElement.scrollHeight - 4
			)
				current = ids[ids.length - 1] ?? current;
			setActive(current);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(check);
		};
		check();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [sectionKey]);
	return active;
}
