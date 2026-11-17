import { useMemo, useRef, useState } from "react";
import { data, Link, redirect, useFetcher } from "react-router";
import { Price } from "../components/Price";
import { GuestApiError, guestApi } from "../lib/api.server";
import {
	estimateCart,
	estimateUnit,
	indexMenu,
	toLineInputs,
} from "../lib/cart";
import { useCart } from "../lib/cart-store";
import {
	CreateGuestOrderRequest,
	type ErrorCode,
	type GuestOrderRejectReason,
} from "../lib/contracts";
import { errorMessageKey } from "../lib/errors";
import { loadMenu, MENU_CACHE } from "../lib/guest.server";
import { isLang, loc, translator } from "../lib/i18n";
import { toE164 } from "../lib/phone";
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

export default function Checkout({ loaderData }: Route.ComponentProps) {
	const { lang, location, menu } = loaderData;
	const t = translator(lang);
	const idx = useMemo(() => indexMenu(menu), [menu]);
	const currency = {
		code: menu.location.currencyCode,
		decimals: menu.location.currencyDecimals,
	};
	const [cart, dispatch] = useCart(location.slug);
	const fetcher = useFetcher<typeof action>();
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [note, setNote] = useState("");
	const [type, setType] = useState<"dine_in" | "takeaway">("dine_in");
	const [formError, setFormError] = useState<string | null>(null);
	// One idempotency key per distinct payload: a retry of the same order reuses it.
	const attempt = useRef<
		| ({ fingerprint: string; key: string } & ReturnType<typeof toLineInputs>)
		| null
	>(null);

	const result = fetcher.data;
	const failedKeys = new Set(
		result?.lineIds.flatMap((id) => attempt.current?.keyById.get(id) ?? []) ??
			[],
	);
	const unknownKeys = cart.lines
		.filter((l) => !idx.products.get(l.productId)?.isAvailable)
		.map((l) => l.key);
	for (const k of unknownKeys) failedKeys.add(k);
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

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		setFormError(null);
		if (!name.trim()) return setFormError(t("name_required"));
		const e164 = phone.trim() ? toE164(phone) : undefined;
		if (e164 === null) return setFormError(t("invalid_phone"));
		const order = {
			type,
			customerName: name.trim(),
			...(e164 ? { customerPhone: e164 } : {}),
			...(note.trim() ? { note: note.trim() } : {}),
		};
		const fingerprint = JSON.stringify({ order, cart: cart.lines });
		if (attempt.current?.fingerprint !== fingerprint) {
			attempt.current = { fingerprint, key: uuidv7(), ...toLineInputs(cart) };
		}
		// Same payload (line ids included) + same key: a retry after a lost response is safe.
		fetcher.submit(
			{
				order: JSON.stringify({ ...order, lines: attempt.current.lines }),
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
					<span className="flip">←</span>
				</Link>
				<h1>{t("your_order")}</h1>
			</header>

			{!location.isAcceptingOrders && (
				<p className="error" role="alert">
					{t("shop_closed")}
				</p>
			)}

			<ul className="lines">
				{cart.lines.map((l) => {
					const p = idx.products.get(l.productId);
					const unit = p ? estimateUnit(p, idx, l.modifierOptionIds) : 0;
					const mods = l.modifierOptionIds
						.map((id) => {
							const g = idx.groups.get(idx.optionGroup.get(id) ?? "");
							const o = g?.options.find((x) => x.id === id);
							return o ? loc(o.name, lang) : null;
						})
						.filter(Boolean)
						.join(", ");
					return (
						<li
							key={l.key}
							className={`line${failedKeys.has(l.key) ? " is-failed" : ""}`}
						>
							<div className="line__info">
								<strong>{p ? loc(p.name, lang) : "?"}</strong>
								{mods && <span className="muted small">{mods}</span>}
								{l.note && <span className="muted small">“{l.note}”</span>}
								{failedKeys.has(l.key) && (
									<span className="chip chip--bad">{t("unavailable_tag")}</span>
								)}
							</div>
							<div className="stepper stepper--sm">
								<button
									type="button"
									onClick={() => dispatch({ type: "decrement", key: l.key })}
									aria-label={t("decrease_qty")}
								>
									−
								</button>
								<output>{l.quantity}</output>
								<button
									type="button"
									onClick={() => dispatch({ type: "increment", key: l.key })}
									aria-label={t("increase_qty")}
								>
									+
								</button>
							</div>
							<Price
								className="line__price"
								amount={unit * l.quantity}
								currency={currency}
								lang={lang}
							/>
						</li>
					);
				})}
			</ul>

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

			<div className="totals">
				<span>
					{t("total")} <span className="muted small">({t("estimated")})</span>
				</span>
				<Price
					amount={estimateCart(cart, idx)}
					currency={currency}
					lang={lang}
				/>
			</div>

			<form className="checkout" onSubmit={submit} noValidate>
				<fieldset className="segmented">
					<legend className="field-label">{t("order_type")}</legend>
					{(["dine_in", "takeaway"] as const).map((v) => (
						<label key={v}>
							<input
								type="radio"
								name="type"
								value={v}
								checked={type === v}
								onChange={() => setType(v)}
							/>
							<span>{t(v)}</span>
						</label>
					))}
				</fieldset>

				<label className="field-label" htmlFor="name">
					{t("your_name")}
				</label>
				<input
					id="name"
					className="input"
					autoComplete="given-name"
					maxLength={80}
					placeholder={t("name_placeholder")}
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>

				<label className="field-label" htmlFor="phone">
					{t("phone_label")}{" "}
					<span className="muted small">{t("phone_hint")}</span>
				</label>
				<input
					id="phone"
					className="input"
					type="tel"
					inputMode="tel"
					autoComplete="tel"
					dir="ltr"
					maxLength={20}
					value={phone}
					onChange={(e) => setPhone(e.target.value)}
				/>

				<label className="field-label" htmlFor="note">
					{t("order_note_label")}
				</label>
				<textarea
					id="note"
					className="input"
					rows={2}
					maxLength={500}
					placeholder={t("order_note_placeholder")}
					value={note}
					onChange={(e) => setNote(e.target.value)}
				/>

				{(formError || result) && (
					<p className="error" role="alert">
						{formError ??
							(result ? t(errorMessageKey(result.code, result.reason)) : "")}
					</p>
				)}

				<p className="muted small">{t("pay_at_counter_hint")}</p>
				<button
					type="submit"
					className="btn btn--primary btn--grow"
					disabled={busy || !location.isAcceptingOrders || failedKeys.size > 0}
				>
					{busy ? t("placing") : t("place_order")}
				</button>
			</form>
		</main>
	);
}
