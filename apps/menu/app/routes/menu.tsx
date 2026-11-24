import { Icon } from "@bite/ui";
import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { MenuHeader } from "../components/MenuHeader";
import { MenuList } from "../components/MenuList";
import { Price } from "../components/Price";
import { ProductSheet } from "../components/ProductSheet";
import { type Cart, indexMenu, itemCount, lineKey } from "../lib/cart";
import { useCart } from "../lib/cart-store";
import type { MenuProduct } from "../lib/contracts";
import type { GroupActionResult } from "../lib/group.server";
import { loadMenu, MENU_CACHE } from "../lib/guest.server";
import { type Lang, loc, type T, translator } from "../lib/i18n";
import { menuPricing, quoteCart, usePricingClock } from "../lib/pricing";
import {
	activeKey,
	lastKey,
	parseActive,
	parseLast,
	reorderable,
	useRemembered,
} from "../lib/recent";
import { useTable } from "../lib/table";
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
	const table = useTable(location.slug);
	const [open, setOpen] = useState<MenuProduct | null>(null);
	const canOrder = location.isAcceptingOrders;
	const [added, setAdded] = useState<Added | null>(null);
	useEffect(() => {
		if (!added) return;
		const id = setTimeout(() => setAdded(null), 2600);
		return () => clearTimeout(id);
	}, [added]);
	const add = (line: {
		productId: string;
		modifierOptionIds: string[];
		note?: string;
		quantity?: number;
	}) => {
		dispatch({ type: "add", ...line });
		const p = idx.products.get(line.productId);
		setAdded({
			n: (added?.n ?? 0) + 1,
			productId: line.productId,
			key: lineKey(line.productId, line.modifierOptionIds, line.note),
			quantity: line.quantity ?? 1,
			name: p ? loc(p.name, lang) : "",
		});
	};

	const count = itemCount(cart);
	const activeRaw = useRemembered(activeKey(location.slug));
	const lastRaw = useRemembered(lastKey(location.slug));
	const active = useMemo(() => parseActive(activeRaw, Date.now()), [activeRaw]);
	// Only what can still be ordered exactly as it was last time.
	const again = useMemo((): Cart | null => {
		const last = parseLast(lastRaw, Date.now());
		const lines = last ? reorderable(last, idx) : [];
		return lines.length > 0 ? { lines } : null;
	}, [lastRaw, idx]);
	const againQuote = useMemo(
		() => (again ? quoteCart(pricing, again, at) : null),
		[again, pricing, at],
	);
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
				table={table}
			>
				{active && (
					<Link
						className="orderlink"
						to={`/${lang}/${location.slug}/orders/${active.token}`}
					>
						<span>
							{t("order_in_progress")}{" "}
							<bdi dir="ltr" className="strong">
								{active.ticket}
							</bdi>
						</span>
						<span className="orderlink__go">{t("order_track")}</span>
					</Link>
				)}
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
				added={added?.productId ?? null}
				onQuickAdd={(p) =>
					p.modifierGroupIds.length === 0
						? add({ productId: p.id, modifierOptionIds: [] })
						: setOpen(p)
				}
				top={
					canOrder &&
					count === 0 &&
					again &&
					againQuote?.order && (
						<section className="again" aria-labelledby="again-title">
							<div className="again__body">
								<h2 id="again-title">{t("again_title")}</h2>
								<p className="muted small">
									{again.lines
										.map(
											(l) =>
												`${l.quantity} × ${loc(idx.products.get(l.productId)?.name ?? { en: "" }, lang)}`,
										)
										.join(lang === "ar" ? "، " : ", ")}
								</p>
							</div>
							<button
								type="button"
								className="btn btn--primary"
								onClick={() => {
									for (const l of again.lines)
										dispatch({
											type: "add",
											productId: l.productId,
											modifierOptionIds: l.modifierOptionIds,
											quantity: l.quantity,
											...(l.note ? { note: l.note } : {}),
										});
								}}
							>
								<span>{t("again_add")}</span>
								<Price
									amount={againQuote.order.total}
									currency={currency}
									lang={lang}
								/>
							</button>
						</section>
					)
				}
			/>

			{count > 0 && (
				<div className="cartbar">
					{added && (
						<div className="added" role="status" key={added.n}>
							<Icon name="check" />
							<span>{t("added_toast", { name: added.name })}</span>
							<button
								type="button"
								className="added__undo"
								onClick={() => {
									for (let i = 0; i < added.quantity; i++)
										dispatch({ type: "decrement", key: added.key });
									setAdded(null);
								}}
							>
								{t("undo")}
							</button>
						</div>
					)}
					<Link
						to={`/${lang}/${location.slug}/checkout`}
						className="btn btn--primary btn--grow"
					>
						<span className="badge" key={count}>
							{count}
						</span>
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
					add(line);
					setOpen(null);
				}}
			/>
		</>
	);
}

type Added = {
	/** Bumps on every add so the toast replays its entrance. */
	n: number;
	productId: string;
	key: string;
	quantity: number;
	name: string;
};

/** Start a group cart: ask the host's name, then go to the shared page. */
function OrderTogether({ lang, slug, t }: { lang: Lang; slug: string; t: T }) {
	const [open, setOpen] = useState(false);
	const fetcher = useFetcher<GroupActionResult>();

	useEffect(() => {
		const d = fetcher.data;
		if (d?.ok && d.cart) {
			// Full load: a fresh SSR of the group page, which reads the seat cookie.
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
