import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { MenuHeader } from "../components/MenuHeader";
import { MenuList } from "../components/MenuList";
import { Price } from "../components/Price";
import { ProductSheet } from "../components/ProductSheet";
import { indexMenu, itemCount } from "../lib/cart";
import { useCart } from "../lib/cart-store";
import type { MenuProduct } from "../lib/contracts";
import type { GroupActionResult } from "../lib/group.server";
import { saveGroupIdentity } from "../lib/group-identity";
import { loadMenu, MENU_CACHE } from "../lib/guest.server";
import { type Lang, type T, translator } from "../lib/i18n";
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
			>
				{canOrder && <OrderTogether lang={lang} slug={location.slug} t={t} />}
			</MenuHeader>

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

/** Start a group cart: ask the host's name, then go to the shared page. */
function OrderTogether({ lang, slug, t }: { lang: Lang; slug: string; t: T }) {
	const [open, setOpen] = useState(false);
	const fetcher = useFetcher<GroupActionResult>();

	useEffect(() => {
		const d = fetcher.data;
		if (d?.ok && d.cart && d.participantId && d.secret) {
			saveGroupIdentity(d.cart.token, {
				participantId: d.participantId,
				secret: d.secret,
			});
			// Full load: a fresh SSR of the group page with the identity in place.
			window.location.assign(`/${lang}/${slug}/group/${d.cart.token}`);
		}
	}, [fetcher.data, lang, slug]);

	if (!open) {
		return (
			<div className="groupbar">
				<button
					type="button"
					className="chip chip--link"
					onClick={() => setOpen(true)}
				>
					{t("order_together")}
				</button>
			</div>
		);
	}
	return (
		<fetcher.Form
			method="post"
			action={`/${lang}/${slug}/group`}
			className="together"
		>
			<strong>{t("order_together")}</strong>
			<span className="muted small">{t("order_together_hint")}</span>
			<label className="field-label" htmlFor="host-name">
				{t("your_name")}
			</label>
			<input
				id="host-name"
				name="displayName"
				className="input"
				required
				maxLength={40}
				autoComplete="given-name"
				placeholder={t("name_placeholder")}
			/>
			{fetcher.data && !fetcher.data.ok && (
				<p className="error" role="alert">
					{t("generic_error")}
				</p>
			)}
			<button
				type="submit"
				className="btn btn--primary"
				disabled={fetcher.state !== "idle"}
			>
				{t("start")}
			</button>
		</fetcher.Form>
	);
}
