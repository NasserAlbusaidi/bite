import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Price } from "../components/Price";
import { ProductSheet } from "../components/ProductSheet";
import { estimateCart, indexMenu, itemCount } from "../lib/cart";
import { useCart } from "../lib/cart-store";
import type { MenuProduct } from "../lib/contracts";
import { loadMenu, MENU_CACHE } from "../lib/guest.server";
import { type Lang, loc, translator } from "../lib/i18n";
import type { Route } from "./+types/menu";

export async function loader({ params }: Route.LoaderArgs) {
	return loadMenu(params);
}

export function headers() {
	return { "cache-control": MENU_CACHE, vary: "accept-encoding" };
}

export function meta({ loaderData: data }: Route.MetaArgs) {
	return data ? [{ title: data.location.name }] : [{ title: "Bite" }];
}

const otherLang = (l: Lang): Lang => (l === "en" ? "ar" : "en");

export default function Menu({ loaderData }: Route.ComponentProps) {
	const { lang, location, menu } = loaderData;
	const t = translator(lang);
	const idx = useMemo(() => indexMenu(menu), [menu]);
	const currency = {
		code: menu.location.currencyCode,
		decimals: menu.location.currencyDecimals,
	};
	const [cart, dispatch] = useCart(location.slug);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<MenuProduct | null>(null);

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

	const count = itemCount(cart);
	const quickAdd = (p: MenuProduct) =>
		p.modifierGroupIds.length === 0
			? dispatch({ type: "add", productId: p.id, modifierOptionIds: [] })
			: setOpen(p);

	return (
		<>
			<header
				className="hero"
				style={
					location.theme.accent
						? { ["--accent" as string]: location.theme.accent }
						: undefined
				}
			>
				<div className="hero__row">
					{location.theme.logoUrl && (
						<img
							className="hero__logo"
							src={location.theme.logoUrl}
							alt=""
							width={40}
							height={40}
						/>
					)}
					<h1 className="hero__title">{location.name}</h1>
					<Link
						className="chip chip--link"
						to={`/${otherLang(lang)}/${location.slug}`}
						lang={otherLang(lang)}
						reloadDocument
					>
						{lang === "en" ? "عربي" : "EN"}
					</Link>
				</div>
				<p
					className={`status ${location.isAcceptingOrders ? "status--open" : "status--closed"}`}
				>
					{location.isAcceptingOrders ? t("status_open") : t("status_closed")}
				</p>
				{menu.location.pricesIncludeTax && (
					<p className="muted small">{t("tax_included")}</p>
				)}
			</header>

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
							{products.map((p) => (
								<li
									key={p.id}
									className={`item${p.isAvailable ? "" : " is-off"}`}
								>
									<button
										type="button"
										className="item__main"
										disabled={!p.isAvailable}
										onClick={() => setOpen(p)}
									>
										<span className="item__name">{loc(p.name, lang)}</span>
										{p.description && (
											<span className="item__desc muted">
												{loc(p.description, lang)}
											</span>
										)}
										<span className="item__price">
											{p.isAvailable ? (
												<Price
													amount={p.price}
													currency={currency}
													lang={lang}
												/>
											) : (
												t("sold_out")
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
									{p.isAvailable && location.isAcceptingOrders && (
										<button
											type="button"
											className="add-btn"
											onClick={() => quickAdd(p)}
											aria-label={t("add_item_aria", {
												name: loc(p.name, lang),
											})}
										>
											+
										</button>
									)}
								</li>
							))}
						</ul>
					</section>
				))}
				<p className="powered muted small">{t("powered_by")}</p>
			</main>

			{count > 0 && (
				<div className="cartbar">
					<Link
						to={`/${lang}/${location.slug}/checkout`}
						className="btn btn--primary btn--grow"
					>
						<span className="badge">{count}</span>
						<span>{t("view_cart")}</span>
						<Price
							amount={estimateCart(cart, idx)}
							currency={currency}
							lang={lang}
						/>
					</Link>
				</div>
			)}

			<ProductSheet
				product={location.isAcceptingOrders ? open : null}
				idx={idx}
				lang={lang}
				t={t}
				currency={currency}
				onClose={() => setOpen(null)}
				onAdd={(line) => {
					dispatch({ type: "add", ...line });
					setOpen(null);
				}}
			/>
		</>
	);
}
