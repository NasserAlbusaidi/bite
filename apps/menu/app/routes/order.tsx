import { useEffect } from "react";
import {
	data,
	Link,
	useParams,
	useRevalidator,
	useSearchParams,
} from "react-router";
import { Price } from "../components/Price";
import { Totals } from "../components/Totals";
import { guestApi } from "../lib/api.server";
import { useCart } from "../lib/cart-store";
import { isLang, loc, type MessageKey, translator } from "../lib/i18n";
import { isNetworkError } from "../lib/offline";
import type { Route } from "./+types/order";

export async function loader({ params }: Route.LoaderArgs) {
	if (!isLang(params.lang)) throw data(null, { status: 404 });
	const api = guestApi();
	const [order, menu] = await Promise.all([
		api.getOrder(params.token),
		api.getMenu(params.slug),
	]);
	if (!order || !menu) throw data(null, { status: 404 });
	return {
		lang: params.lang,
		order,
		location: menu.location,
		currency: {
			code: menu.menu.location.currencyCode,
			decimals: menu.menu.location.currencyDecimals,
		},
	};
}

type OrderData = Awaited<ReturnType<typeof loader>>;
/** Last good copy per order, so a poll during a wifi blip keeps the ticket on screen. */
const lastSeen = new Map<string, OrderData>();

export async function clientLoader({
	serverLoader,
	params,
}: Route.ClientLoaderArgs) {
	try {
		const fresh = await serverLoader();
		lastSeen.set(params.token, fresh);
		return fresh;
	} catch (e) {
		const prev = lastSeen.get(params.token);
		if (prev && isNetworkError(e)) return prev;
		throw e;
	}
}

export function headers() {
	return { "cache-control": "private, no-store" };
}

export function meta({ loaderData: data }: Route.MetaArgs) {
	return [
		{
			title: data
				? `${data.order.ticketNumber} · ${data.location.name}`
				: "Bite",
		},
		{ name: "robots", content: "noindex" },
	];
}

const POLL_MS = 10_000;

function statusKey(o: Route.ComponentProps["loaderData"]["order"]): MessageKey {
	if (o.fulfillmentStatus === "cancelled") return "status_cancelled";
	if (o.fulfillmentStatus === "completed") return "status_completed";
	if (o.fulfillmentStatus === "ready") return "status_ready";
	if (o.fulfillmentStatus === "preparing") return "status_preparing";
	return o.paymentStatus === "unpaid" ? "status_unpaid" : "status_paid";
}

export default function OrderPage({ loaderData }: Route.ComponentProps) {
	const { lang, order, location, currency } = loaderData;
	const t = translator(lang);
	const [params, setParams] = useSearchParams();
	const [, dispatch] = useCart(location.slug);
	const { revalidate, state } = useRevalidator();
	const { token } = useParams();
	if (token) lastSeen.set(token, loaderData);
	const done =
		order.fulfillmentStatus === "completed" ||
		order.fulfillmentStatus === "cancelled";

	// Just placed: the cart has become this order.
	useEffect(() => {
		if (params.get("placed") === "1") {
			dispatch({ type: "clear" });
			setParams({}, { replace: true });
		}
	}, [params, setParams, dispatch]);

	// TODO: switch to the realtime hint (SSE) once the API exposes it for guests.
	useEffect(() => {
		if (done) return;
		const id = setInterval(() => {
			if (document.visibilityState === "visible" && state === "idle")
				revalidate();
		}, POLL_MS);
		return () => clearInterval(id);
	}, [done, revalidate, state]);

	return (
		<main className="page">
			<section className="ticket" aria-live="polite">
				<p className="muted">{t("track_show_counter")}</p>
				<p className="ticket__no">
					<bdi dir="ltr">{order.ticketNumber}</bdi>
				</p>
				<p className="ticket__status">{t(statusKey(order))}</p>
			</section>

			<ul className="lines">
				{order.lines
					.filter((l) => !l.voidedAt)
					.map((l) => (
						<li key={l.id} className="line">
							<div className="line__info">
								<strong>
									{l.quantity} × {loc(l.name, lang)}
								</strong>
								{l.modifiers.length > 0 && (
									<span className="muted small">
										{l.modifiers.map((m) => loc(m.name, lang)).join(", ")}
									</span>
								)}
							</div>
							<Price
								className="line__price"
								amount={l.lineTotal}
								currency={currency}
								lang={lang}
							/>
						</li>
					))}
			</ul>

			<Totals
				order={{ ...order, pricesIncludeTax: order.total === order.subtotal }}
				lang={lang}
				t={t}
				currency={currency}
			/>

			<Link className="btn" to={`/${lang}/${location.slug}`}>
				{t("back_to_menu")}
			</Link>
		</main>
	);
}
