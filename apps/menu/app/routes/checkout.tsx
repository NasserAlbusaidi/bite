import { Icon } from "@bite/ui";
import { useMemo, useRef } from "react";
import {
	data,
	Link,
	redirect,
	type ShouldRevalidateFunctionArgs,
	useFetcher,
} from "react-router";
import { CartLines } from "../components/CartLines";
import { type CheckoutFields, CheckoutForm } from "../components/CheckoutForm";
import { Totals } from "../components/Totals";
import { GuestApiError, guestApi } from "../lib/api.server";
import { indexMenu, toLineInputs } from "../lib/cart";
import { useCart } from "../lib/cart-store";
import {
	CreateGuestOrderRequest,
	type ErrorCode,
	type GuestOrderRejectReason,
} from "../lib/contracts";
import { errorMessageKey } from "../lib/errors";
import { loadMenu, MENU_CACHE } from "../lib/guest.server";
import { isLang, translator } from "../lib/i18n";
import { isNetworkError, isOffline, OFFLINE } from "../lib/offline";
import { menuPricing, quoteCart, usePricingClock } from "../lib/pricing";
import { uuidv7 } from "../lib/uuid";
import type { Route } from "./+types/checkout";

export async function loader({ params }: Route.LoaderArgs) {
	return loadMenu(params);
}

export function headers() {
	return { "cache-control": MENU_CACHE };
}

export function meta({ loaderData: data }: Route.MetaArgs) {
	return data ? [{ title: data.location.name }] : [{ title: "Bite" }];
}

type ActionError = {
	code: ErrorCode;
	reason?: GuestOrderRejectReason;
	lineIds: string[];
};

export async function action({ request, params }: Route.ActionArgs) {
	if (!isLang(params.lang)) throw data(null, { status: 404 });
	const form = await request.formData();
	const key = String(form.get("idempotencyKey") ?? "");
	let body: unknown;
	try {
		body = JSON.parse(String(form.get("order") ?? ""));
	} catch {
		return data<ActionError>(
			{ code: "bad_request", lineIds: [] },
			{ status: 400 },
		);
	}
	const parsed = CreateGuestOrderRequest.safeParse({
		...(body as object),
		locationSlug: params.slug,
	});
	if (!parsed.success || !/^[0-9a-f-]{36}$/.test(key)) {
		return data<ActionError>(
			{ code: "bad_request", lineIds: [] },
			{ status: 400 },
		);
	}
	try {
		const order = await guestApi().placeOrder(parsed.data, key);
		return redirect(
			`/${params.lang}/${params.slug}/orders/${order.trackingToken}?placed=1`,
		);
	} catch (e) {
		if (!(e instanceof GuestApiError)) throw e;
		return data<ActionError>(
			{
				code: e.code,
				...(e.rejection ? { reason: e.rejection.reason } : {}),
				lineIds: e.rejection?.lineIds ?? [],
			},
			{ status: 422 },
		);
	}
}

/**
 * No connection: say so in place and keep the form, the cart and the
 * idempotency key, so tapping again sends the same order once.
 */
export async function clientAction({ serverAction }: Route.ClientActionArgs) {
	try {
		return await serverAction();
	} catch (e) {
		if (isNetworkError(e)) return OFFLINE;
		throw e;
	}
}

export function shouldRevalidate({
	actionResult,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	return isOffline(actionResult) ? false : defaultShouldRevalidate;
}

export default function Checkout({ loaderData }: Route.ComponentProps) {
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
	const fetcher = useFetcher<typeof action>();
	// One idempotency key per distinct payload: a retry of the same order reuses it.
	const attempt = useRef<
		| ({ fingerprint: string; key: string } & ReturnType<typeof toLineInputs>)
		| null
	>(null);

	const quote = useMemo(
		() => quoteCart(pricing, cart, at),
		[pricing, cart, at],
	);
	const result = fetcher.data;
	const failedKeys = new Set(
		result?.lineIds.flatMap((id) => attempt.current?.keyById.get(id) ?? []) ??
			[],
	);
	cart.lines.forEach((l, i) => {
		if (quote.badIndexes.has(i)) failedKeys.add(l.key);
	});
	const busy = fetcher.state !== "idle";

	if (cart.lines.length === 0) {
		return (
			<main className="page page--center">
				<h1>{t("cart_empty_title")}</h1>
				<p className="muted">{t("cart_empty_body")}</p>
				<Link className="btn btn--primary" to={`/${lang}/${location.slug}`}>
					{t("browse_menu")}
				</Link>
			</main>
		);
	}

	const submit = (fields: CheckoutFields) => {
		const fingerprint = JSON.stringify({ fields, cart: cart.lines });
		if (attempt.current?.fingerprint !== fingerprint) {
			attempt.current = { fingerprint, key: uuidv7(), ...toLineInputs(cart) };
		}
		// Same payload (line ids included) + same key: a retry after a lost response is safe.
		fetcher.submit(
			{
				order: JSON.stringify({ ...fields, lines: attempt.current.lines }),
				idempotencyKey: attempt.current.key,
			},
			{ method: "post" },
		);
	};

	return (
		<main className="page">
			<header className="toolbar">
				<Link
					to={`/${lang}/${location.slug}`}
					className="icon-btn"
					aria-label={t("back_to_menu")}
				>
					<Icon name="arrow-back" />
				</Link>
				<h1>{t("your_order")}</h1>
			</header>

			{!location.isAcceptingOrders && (
				<p className="error" role="alert">
					{t("shop_closed")}
				</p>
			)}

			<CartLines
				rows={cart.lines.map((l, i) => ({
					...l,
					failed: failedKeys.has(l.key),
					priced: quote.lineAt(i),
				}))}
				idx={idx}
				lang={lang}
				t={t}
				currency={currency}
				onChangeQty={(key, d) =>
					dispatch({ type: d > 0 ? "increment" : "decrement", key })
				}
			/>

			{failedKeys.size > 0 && (
				<button
					type="button"
					className="btn"
					onClick={() =>
						dispatch({ type: "removeMany", keys: [...failedKeys] })
					}
				>
					{t("remove_unavailable")}
				</button>
			)}

			<Totals order={quote.order} lang={lang} t={t} currency={currency} />

			<CheckoutForm
				t={t}
				busy={busy}
				disabled={!location.isAcceptingOrders || failedKeys.size > 0}
				error={
					!result
						? null
						: isOffline(result)
							? t("offline_retry")
							: t(errorMessageKey(result.code, result.reason))
				}
				submitLabel={t("place_order")}
				onSubmit={submit}
			/>
		</main>
	);
}
