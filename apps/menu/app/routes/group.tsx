import { Icon } from "@bite/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	data,
	Link,
	type ShouldRevalidateFunctionArgs,
	useFetcher,
	useSearchParams,
} from "react-router";
import { CartLines } from "../components/CartLines";
import { type CheckoutFields, CheckoutForm } from "../components/CheckoutForm";
import { MenuHeader } from "../components/MenuHeader";
import { MenuList } from "../components/MenuList";
import { Price } from "../components/Price";
import { ProductSheet } from "../components/ProductSheet";
import { Totals } from "../components/Totals";
import { guestApi } from "../lib/api.server";
import { type Cart, indexMenu, lineKey } from "../lib/cart";
import type {
	GroupCartItem,
	GroupCartView,
	MenuProduct,
} from "../lib/contracts";
import { errorMessageKey } from "../lib/errors";
import { type GroupActionResult, groupAction } from "../lib/group.server";
import { readSeat } from "../lib/group-seat.server";
import { loadMenu } from "../lib/guest.server";
import { translator } from "../lib/i18n";
import { isNetworkError, isOffline } from "../lib/offline";
import { menuPricing, quoteCart, usePricingClock } from "../lib/pricing";
import { uuidv7 } from "../lib/uuid";
import type { Route } from "./+types/group";

export async function loader({ request, params }: Route.LoaderArgs) {
	const [base, cart, seat] = await Promise.all([
		loadMenu(params),
		guestApi().getGroupCart(params.token),
		readSeat(request, params.token),
	]);
	if (!cart) throw data(null, { status: 404 });
	// Only the participant id reaches the page; the secret stays in the httpOnly cookie.
	return { ...base, cart, meId: seat?.participantId ?? null };
}

export function headers() {
	return { "cache-control": "private, no-store" };
}

export function meta({ loaderData: d }: Route.MetaArgs) {
	return [
		{ title: d ? d.location.name : "Bite" },
		{ name: "robots", content: "noindex" },
	];
}

export async function action({ request, params }: Route.ActionArgs) {
	return groupAction(request, params);
}

type GroupOffline = {
	ok: false;
	intent: string;
	offline: true;
	lineIds: string[];
};
type GroupWrite = GroupActionResult | GroupOffline;

/** No connection: report it in place instead of replacing the page. */
export async function clientAction({
	serverAction,
	request,
}: Route.ClientActionArgs) {
	try {
		return await serverAction();
	} catch (e) {
		if (!isNetworkError(e)) throw e;
		const intent = String((await request.formData()).get("intent") ?? "");
		return { ok: false, intent, offline: true, lineIds: [] } as GroupOffline;
	}
}

export function shouldRevalidate({
	actionResult,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	return isOffline(actionResult) ? false : defaultShouldRevalidate;
}

const POLL_MS = 3000;
const LIVE = new Set(["open", "locked"]);

/** Group items as a Cart, so core prices the whole table in one go. */
const asCart = (items: readonly GroupCartItem[]): Cart => ({
	lines: items.map((i) => ({
		key: i.id,
		productId: i.productId,
		quantity: i.quantity,
		modifierOptionIds: [...i.modifierOptionIds],
		...(i.note ? { note: i.note } : {}),
	})),
});

export default function GroupOrder({ loaderData }: Route.ComponentProps) {
	const { lang, location, menu } = loaderData;
	const t = translator(lang);
	const idx = useMemo(() => indexMenu(menu), [menu]);
	const pricing = useMemo(() => menuPricing(menu), [menu]);
	const at = usePricingClock(pricing);
	const currency = {
		code: menu.location.currencyCode,
		decimals: menu.location.currencyDecimals,
	};
	const [params, setParams] = useSearchParams();
	const view = params.get("view") === "cart" ? "cart" : "menu";
	const [open, setOpen] = useState<MenuProduct | null>(null);
	const [copied, setCopied] = useState(false);

	// Latest cart: from the last write, the last poll, or the loader, whichever is newest.
	// Polled with a plain fetch of the JSON resource route, not a fetcher: a
	// failed fetcher load (wifi blip) replaces the whole page with an error.
	const [polled, setPolled] = useState<GroupCartView>();
	const writer = useFetcher<GroupWrite>();
	const joiner = useFetcher<GroupWrite>();
	const candidates = [
		loaderData.cart,
		polled,
		writer.data?.ok ? writer.data.cart : undefined,
		joiner.data?.ok ? joiner.data.cart : undefined,
	].filter((c): c is GroupCartView => !!c);
	const cart = candidates.reduce((a, b) => (b.version > a.version ? b : a));
	const statePath = `/${lang}/${location.slug}/group/${cart.token}/state`;

	useEffect(() => {
		if (!LIVE.has(cart.status)) return;
		let busy = false;
		const id = setInterval(async () => {
			if (busy || document.visibilityState !== "visible") return;
			busy = true;
			try {
				const res = await fetch(statePath, { cache: "no-store" });
				if (res.ok)
					setPolled(((await res.json()) as { cart: GroupCartView }).cart);
			} catch {
				// Offline for a moment: keep what's on screen, try again next tick.
			} finally {
				busy = false;
			}
		}, POLL_MS);
		return () => clearInterval(id);
	}, [cart.status, statePath]);

	const meId =
		(joiner.data?.ok ? joiner.data.participantId : undefined) ??
		loaderData.meId;
	const me = meId ? cart.participants.find((p) => p.id === meId) : undefined;
	const host = cart.participants.find((p) => p.isHost);
	const editable = cart.status === "open" && !!me;
	const quote = useMemo(
		() => quoteCart(pricing, asCart(cart.items), at),
		[pricing, cart.items, at],
	);
	const myItems = me ? cart.items.filter((i) => i.participantId === me.id) : [];

	const send = (intent: string, fields: Record<string, string> = {}) => {
		if (!me) return;
		writer.submit(
			{
				intent,
				version: String(cart.version),
				...fields,
			},
			{ method: "post" },
		);
	};

	const upsert = (item: {
		id: string;
		productId: string;
		quantity: number;
		modifierOptionIds: readonly string[];
		note?: string | null;
	}) =>
		send("upsert", {
			itemId: item.id,
			productId: item.productId,
			quantity: String(item.quantity),
			modifierOptionIds: JSON.stringify(item.modifierOptionIds),
			note: item.note ?? "",
		});

	/** Adding the same thing twice bumps the quantity of my existing item. */
	const add = (p: {
		productId: string;
		modifierOptionIds: string[];
		note?: string;
		quantity: number;
	}) => {
		const k = lineKey(p.productId, p.modifierOptionIds, p.note);
		const mine = myItems.find(
			(i) =>
				lineKey(i.productId, i.modifierOptionIds, i.note ?? undefined) === k,
		);
		upsert(
			mine
				? { ...mine, quantity: Math.min(99, mine.quantity + p.quantity) }
				: { id: uuidv7(), ...p },
		);
	};

	const changeQty = (itemId: string, d: 1 | -1) => {
		const item = myItems.find((i) => i.id === itemId);
		if (!item) return;
		if (item.quantity + d < 1) send("remove", { itemId });
		else upsert({ ...item, quantity: Math.min(99, item.quantity + d) });
	};

	// One idempotency key per submit payload, reused on retry.
	const submitKey = useRef<{ fp: string; key: string } | null>(null);
	const submit = (fields: CheckoutFields) => {
		const fp = JSON.stringify({ fields, v: cart.items });
		if (submitKey.current?.fp !== fp) submitKey.current = { fp, key: uuidv7() };
		send("submit", {
			fields: JSON.stringify(fields),
			idempotencyKey: submitKey.current.key,
		});
	};

	const share = async () => {
		const url = `${window.location.origin}/${location.slug}/group/${cart.token}`;
		try {
			if (navigator.share)
				await navigator.share({
					title: location.name,
					text: t("share_group_desc"),
					url,
				});
			else {
				await navigator.clipboard.writeText(url);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			}
		} catch {
			// user cancelled the share sheet
		}
	};

	const errorText = (d: GroupWrite | undefined) =>
		!d || d.ok
			? null
			: isOffline(d)
				? t("offline_retry")
				: t(errorMessageKey(d.code, d.reason));
	const writeError = errorText(writer.data);
	const failedIds = new Set(
		writer.data && !writer.data.ok ? writer.data.lineIds : [],
	);
	cart.items.forEach((i, n) => {
		if (quote.badIndexes.has(n)) failedIds.add(i.id);
	});

	const header = (
		<MenuHeader
			location={location}
			lang={lang}
			t={t}
			pricesIncludeTax={menu.location.pricesIncludeTax}
			switchTo={`/${location.slug}/group/${cart.token}`}
		>
			<div className="groupbar">
				<span className="chip">
					{t("people_count", { count: cart.participants.length })}
				</span>
				{LIVE.has(cart.status) && (
					<button type="button" className="chip chip--link" onClick={share}>
						{copied ? t("link_copied") : t("share_link")}
					</button>
				)}
			</div>
		</MenuHeader>
	);

	// Finished or dead carts.
	if (!LIVE.has(cart.status)) {
		return (
			<>
				{header}
				<main className="page page--center">
					<h1>
						{cart.status === "submitted"
							? t("group_submitted")
							: t("group_expired")}
					</h1>
					{cart.trackingToken && (
						<Link
							className="btn btn--primary"
							to={`/${lang}/${location.slug}/orders/${cart.trackingToken}`}
						>
							{t("view_order")}
						</Link>
					)}
					<Link className="btn" to={`/${lang}/${location.slug}`}>
						{t("back_to_menu")}
					</Link>
				</main>
			</>
		);
	}

	// Not in the group yet.
	if (!me) {
		const joinError = errorText(joiner.data);
		return (
			<>
				{header}
				<main className="page">
					<h2>{t("join_group_title")}</h2>
					<p className="muted">{t("order_together_hint")}</p>
					<joiner.Form method="post" className="checkout">
						<input type="hidden" name="intent" value="join" />
						<label className="field-label" htmlFor="displayName">
							{t("your_name")}
						</label>
						<input
							id="displayName"
							name="displayName"
							className="input"
							required
							maxLength={40}
							autoComplete="given-name"
							placeholder={t("name_placeholder")}
						/>
						{joinError && (
							<p className="error" role="alert">
								{joinError}
							</p>
						)}
						<button
							type="submit"
							className="btn btn--primary"
							disabled={joiner.state !== "idle" || cart.status !== "open"}
						>
							{t("join")}
						</button>
					</joiner.Form>
				</main>
			</>
		);
	}

	const lockedBanner =
		cart.status === "locked" ? (
			<p className="banner" role="status">
				{me.isHost
					? t("group_locked_host")
					: t("group_locked", { host: host?.displayName ?? t("host") })}
			</p>
		) : null;

	if (view === "cart") {
		return (
			<>
				{header}
				<main className="page">
					<header className="toolbar">
						<button
							type="button"
							className="icon-btn"
							onClick={() => setParams({})}
							aria-label={t("back_to_menu")}
						>
							<Icon name="arrow-back" />
						</button>
						<h1>{t("group_cart")}</h1>
					</header>
					{lockedBanner}

					{cart.participants.map((p) => {
						const items = cart.items.filter((i) => i.participantId === p.id);
						const mine = p.id === me.id;
						return (
							<section key={p.id} className="person">
								<h2>
									{mine ? t("you") : p.displayName}
									{p.isHost && <span className="chip">{t("host")}</span>}
								</h2>
								{items.length === 0 ? (
									<p className="muted small">{t("no_items_yet")}</p>
								) : (
									<CartLines
										rows={items.map((i) => ({
											...i,
											key: i.id,
											failed: failedIds.has(i.id),
											priced: quote.lineAt(cart.items.indexOf(i)),
										}))}
										idx={idx}
										lang={lang}
										t={t}
										currency={currency}
										{...(mine && editable ? { onChangeQty: changeQty } : {})}
									/>
								)}
							</section>
						);
					})}

					<Totals order={quote.order} lang={lang} t={t} currency={currency} />

					{writeError && (
						<p className="error" role="alert">
							{writeError}
						</p>
					)}

					{me.isHost && cart.status === "open" && (
						<button
							type="button"
							className="btn btn--primary"
							disabled={
								cart.items.length === 0 ||
								writer.state !== "idle" ||
								!location.isAcceptingOrders
							}
							onClick={() => send("lock")}
						>
							{t("lock_checkout")}
						</button>
					)}

					{me.isHost && cart.status === "locked" && (
						<>
							<CheckoutForm
								t={t}
								busy={writer.state !== "idle"}
								disabled={!location.isAcceptingOrders || failedIds.size > 0}
								error={null}
								submitLabel={t("place_group_order")}
								defaultName={me?.displayName}
								onSubmit={submit}
							/>
							<button
								type="button"
								className="btn"
								onClick={() => send("unlock")}
								disabled={writer.state !== "idle"}
							>
								{t("back_to_editing")}
							</button>
						</>
					)}
				</main>
			</>
		);
	}

	const count = cart.items.reduce((n, i) => n + i.quantity, 0);
	return (
		<>
			{header}
			{lockedBanner}
			<MenuList
				menu={menu}
				pricing={pricing}
				at={at}
				lang={lang}
				t={t}
				currency={currency}
				canOrder={editable && location.isAcceptingOrders}
				onOpen={setOpen}
				onQuickAdd={(p) =>
					p.modifierGroupIds.length === 0
						? add({ productId: p.id, modifierOptionIds: [], quantity: 1 })
						: setOpen(p)
				}
			/>
			{writeError && (
				<p className="error toast" role="alert">
					{writeError}
				</p>
			)}
			<div className="cartbar">
				<button
					type="button"
					className="btn btn--primary btn--grow"
					onClick={() => setParams({ view: "cart" })}
				>
					<span className="badge">{count}</span>
					<span>{t("group_cart")}</span>
					<Price
						amount={quote.order?.total ?? 0}
						currency={currency}
						lang={lang}
					/>
				</button>
			</div>
			<ProductSheet
				product={editable ? open : null}
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
