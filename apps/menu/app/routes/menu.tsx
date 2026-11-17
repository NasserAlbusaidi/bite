import { useMemo, useState } from "react";
import { Link } from "react-router";
import { MenuHeader } from "../components/MenuHeader";
import { MenuList } from "../components/MenuList";
import { Price } from "../components/Price";
import { ProductSheet } from "../components/ProductSheet";
import { indexMenu, itemCount } from "../lib/cart";
import { useCart } from "../lib/cart-store";
import type { MenuProduct } from "../lib/contracts";
import { loadMenu, MENU_CACHE } from "../lib/guest.server";
import { translator } from "../lib/i18n";
import { menuPricing, quoteCart, usePricingClock } from "../lib/pricing";
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

export default function Menu({ loaderData }: Route.ComponentProps) {
	const { lang, location, menu } = loaderData;
	const t = translator(lang);
	const idx = useMemo(() => indexMenu(menu), [menu]);
	const pricing = useMemo(() => menuPricing(menu), [menu]);
	const at = usePricingClock(pricing);
	const currency = {
		code: menu.location.currencyCode,
		decimals: menu.location.currencyDecimals,
	};
	const [cart, dispatch] = useCart(location.slug);
	const [open, setOpen] = useState<MenuProduct | null>(null);
	const canOrder = location.isAcceptingOrders;

	const count = itemCount(cart);
	const quote = useMemo(
		() => quoteCart(pricing, cart, at),
		[pricing, cart, at],
	);

	return (
		<>
			<MenuHeader
				location={location}
				lang={lang}
				t={t}
				pricesIncludeTax={menu.location.pricesIncludeTax}
				switchTo={`/${location.slug}`}
			/>

			<MenuList
				menu={menu}
				pricing={pricing}
				at={at}
				lang={lang}
				t={t}
				currency={currency}
				canOrder={canOrder}
				onOpen={setOpen}
				onQuickAdd={(p) =>
					p.modifierGroupIds.length === 0
						? dispatch({ type: "add", productId: p.id, modifierOptionIds: [] })
						: setOpen(p)
				}
			/>

			{count > 0 && (
				<div className="cartbar">
					<Link
						to={`/${lang}/${location.slug}/checkout`}
						className="btn btn--primary btn--grow"
					>
						<span className="badge">{count}</span>
						<span>{t("view_cart")}</span>
						<Price
							amount={quote.order?.total ?? 0}
							currency={currency}
							lang={lang}
						/>
					</Link>
				</div>
			)}

			<ProductSheet
				product={canOrder ? open : null}
				idx={idx}
				pricing={pricing}
				at={at}
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
