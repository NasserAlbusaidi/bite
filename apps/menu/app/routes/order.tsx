import { useEffect, useRef, useState } from "react";
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
import { readCart, useCart } from "../lib/cart-store";
import { isLang, loc, type MessageKey, translator } from "../lib/i18n";
import { isNetworkError } from "../lib/offline";
import {
	activeKey,
	lastKey,
	orderSteps,
	parseActive,
	remember,
} from "../lib/recent";
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

	// Just placed: the cart has become this order. Keep what was in it so the
	// menu can offer the same again next visit.
	useEffect(() => {
		if (params.get("placed") === "1") {
			const { lines } = readCart(location.slug);
			if (lines.length > 0)
				remember(lastKey(location.slug), { at: Date.now(), lines });
			dispatch({ type: "clear" });
			setParams({}, { replace: true });
		}
	}, [params, setParams, dispatch, location.slug]);

	// While the order is open, the menu shows a way back to this page.
	useEffect(() => {
		const key = activeKey(location.slug);
		if (!done) {
			remember(key, {
				token: order.trackingToken,
				ticket: order.ticketNumber,
				at: Date.parse(order.placedAt),
			});
			return;
		}
		let stored: string | null = null;
		try {
			stored = window.localStorage.getItem(key);
		} catch {
			return;
		}
		if (parseActive(stored, Date.now())?.token === order.trackingToken)
			remember(key, null);
	}, [
		done,
		location.slug,
		order.trackingToken,
		order.ticketNumber,
		order.placedAt,
	]);

	// The phone is usually face down on the table: buzz once when it's ready.
	const ready = order.fulfillmentStatus === "ready";
	const wasReady = useRef(ready);
	useEffect(() => {
		if (ready && !wasReady.current) navigator.vibrate?.([200, 100, 200]);
		wasReady.current = ready;
	}, [ready]);

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
			<section
				className={ready ? "ticket ticket--ready" : "ticket"}
				aria-live="polite"
			>
				<p className="muted">{t("track_show_counter")}</p>
				<p className="ticket__no">
					<bdi dir="ltr">{order.ticketNumber}</bdi>
				</p>
				{order.tableLabel && (
					<p className="ticket__table">
						<bdi>{t("table_chip", { table: order.tableLabel })}</bdi>
					</p>
				)}
				<p className="ticket__status">{t(statusKey(order))}</p>
				{!done && <Elapsed since={order.placedAt} t={t} />}
				{order.fulfillmentStatus !== "cancelled" && (
					<ol className="steps">
						{orderSteps(order).map(({ step, state }) => (
							<li
								key={step}
								className={`steps__step steps__step--${state}`}
								aria-current={state === "now" ? "step" : undefined}
							>
								<span className="steps__dot" aria-hidden="true" />
								{t(
									step === "paid" && state !== "done"
										? "step_pay"
										: `step_${step}`,
								)}
							</li>
						))}
					</ol>
				)}
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

/** "Placed 4 min ago", ticking each half minute. Client only, to avoid a hydration mismatch. */
function Elapsed({
	since,
	t,
}: {
	since: string;
	t: ReturnType<typeof translator>;
}) {
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);
	if (now === null) return <p className="ticket__since">&nbsp;</p>;
	const min = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
	return (
		<p className="ticket__since muted small">
			{min < 1 ? t("placed_now") : t("placed_ago", { min })}
		</p>
	);
}
