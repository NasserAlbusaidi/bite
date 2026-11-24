import { businessDate } from "@bite/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	data,
	Form,
	Link,
	useRevalidator,
	useSearchParams,
} from "react-router";
import { adminApi } from "../lib/api";
import type { AdminOrderDetail, AdminOrderRow } from "../lib/contracts";
import { type Lang, loc, type T } from "../lib/i18n";
import { presets } from "../lib/insights";
import { toDecimal } from "../lib/money";
import { loadPlaces } from "../lib/places";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/orders";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT = [
	"unpaid",
	"partially_paid",
	"paid",
	"partially_refunded",
	"refunded",
] as const;
const FULFILLMENT = [
	"pending",
	"preparing",
	"ready",
	"completed",
	"cancelled",
] as const;
type Payment = (typeof PAYMENT)[number];
type Fulfillment = (typeof FULFILLMENT)[number];

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const api = adminApi();
	const [places, settings] = await Promise.all([
		loadPlaces(api),
		api.locations(),
	]);
	const locationId = selectedLocationId(places);
	const s = settings.find((l) => l.id === locationId);
	if (!locationId || !s) throw data(null, { status: 404 });
	const today = businessDate(Date.now(), s.timezone, s.dayCutoffMinutes);
	const url = new URL(request.url);
	const pick = (k: string, d: string) => {
		const v = url.searchParams.get(k) ?? "";
		return DATE.test(v) && v <= today ? v : d;
	};
	let from = pick("from", today);
	let to = pick("to", today);
	if (to < from) [from, to] = [to, from];
	const pay = url.searchParams.get("payment");
	const ful = url.searchParams.get("fulfillment");
	const search = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
	const filters = {
		...(PAYMENT.includes(pay as Payment)
			? { paymentStatus: pay as Payment }
			: {}),
		...(FULFILLMENT.includes(ful as Fulfillment)
			? { fulfillmentStatus: ful as Fulfillment }
			: {}),
		...(search ? { search } : {}),
	};
	const orders = await api.orders({
		locationId,
		from,
		to,
		...filters,
		limit: 50,
	});
	return {
		locationId,
		timeZone: s.timezone,
		today,
		from,
		to,
		filters,
		orders,
	};
}

export default function Orders({ loaderData }: Route.ComponentProps) {
	const { today, from, to, filters, locationId, timeZone } = loaderData;
	const { t, lang, place } = useShell();
	const [params, setParams] = useSearchParams();
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const money = (n: number) => (
		<bdi dir="ltr">
			{toDecimal(n, decimals)} {currency}
		</bdi>
	);
	const isToday = from === today && to === today;
	const [live, setLive] = useState(true);
	const revalidator = useRevalidator();
	// Today's list keeps itself current while the tab is visible.
	useEffect(() => {
		if (!isToday || !live) return;
		const id = window.setInterval(() => {
			if (
				document.visibilityState === "visible" &&
				revalidator.state === "idle"
			)
				revalidator.revalidate();
		}, 15_000);
		return () => window.clearInterval(id);
	}, [isToday, live, revalidator]);

	const open = params.get("order");
	const openOrder = (id: string | null) => {
		const p = new URLSearchParams(params);
		if (id) p.set("order", id);
		else p.delete("order");
		setParams(p, { preventScrollReset: true, replace: !id });
	};
	const range = (f: string, tt: string) => {
		const p = new URLSearchParams(params);
		p.set("from", f);
		p.set("to", tt);
		p.delete("order");
		return `?${p.toString()}`;
	};
	const query = { locationId, from, to, ...filters };

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("orders_title")}</h1>
					<p className="muted small">{place?.name}</p>
				</div>
				{isToday && (
					<label className="check live-toggle">
						<input
							type="checkbox"
							checked={live}
							onChange={(e) => setLive(e.currentTarget.checked)}
						/>
						<span className={live ? "live-dot live-dot--on" : "live-dot"} />
						{t("live_updates")}
					</label>
				)}
			</div>

			<div className="card presets">
				<div className="actions-row">
					{presets(today).map((p) => (
						<Link
							key={p.key}
							to={range(p.from, p.to)}
							className={`chip${p.from === from && p.to === to ? " chip--on" : ""}`}
						>
							{t(p.key as "today")}
						</Link>
					))}
				</div>
				<Form method="get" className="inline-form">
					<label>
						{t("from")}
						<input
							type="date"
							name="from"
							className="input input--sm"
							dir="ltr"
							defaultValue={from}
							max={today}
						/>
					</label>
					<label>
						{t("to")}
						<input
							type="date"
							name="to"
							className="input input--sm"
							dir="ltr"
							defaultValue={to}
							max={today}
						/>
					</label>
					<button type="submit" className="btn">
						{t("show")}
					</button>
				</Form>
			</div>

			<OrdersList
				key={`${from}:${to}:${JSON.stringify(filters)}`}
				first={loaderData.orders}
				query={query}
				money={money}
				timeZone={timeZone}
				onOpen={openOrder}
				openId={open}
			/>

			{open && (
				<OrderDrawer
					id={open}
					onClose={() => openOrder(null)}
					money={money}
					timeZone={timeZone}
					t={t}
					lang={lang}
				/>
			)}
		</>
	);
}

type Query = {
	locationId: string;
	from: string;
	to: string;
	paymentStatus?: Payment;
	fulfillmentStatus?: Fulfillment;
	search?: string;
};

const timeOf = (lang: Lang, timeZone: string, short = false) => {
	const f = new Intl.DateTimeFormat(lang === "ar" ? "ar-OM" : "en-GB", {
		...(short
			? { timeStyle: "short" }
			: { dateStyle: "short", timeStyle: "short" }),
		numberingSystem: "latn",
		timeZone,
	});
	return (iso: string) => f.format(new Date(iso));
};

function OrdersList({
	first,
	query,
	money,
	timeZone,
	onOpen,
	openId,
}: {
	first: { items: AdminOrderRow[]; nextCursor?: string | undefined };
	query: Query;
	money: (n: number) => ReactNode;
	timeZone: string;
	onOpen: (id: string) => void;
	openId: string | null;
}) {
	const { t, lang } = useShell();
	const [params] = useSearchParams();
	const [more, setMore] = useState<AdminOrderRow[]>([]);
	const [cursor, setCursor] = useState(first.nextCursor);
	const [loading, setLoading] = useState(false);
	const [csvBusy, setCsvBusy] = useState(false);
	// Revalidation refreshes the first page; extra pages stay as loaded.
	const seen = new Set(first.items.map((o) => o.id));
	const rows = [...first.items, ...more.filter((o) => !seen.has(o.id))];
	const time = timeOf(lang, timeZone, query.from === query.to);
	const fresh = useRef(new Set<string>());
	const prevIds = useRef<Set<string> | null>(null);
	if (prevIds.current) {
		for (const o of first.items)
			if (!prevIds.current.has(o.id)) fresh.current.add(o.id);
	}
	prevIds.current = new Set(first.items.map((o) => o.id));

	const loadMore = async () => {
		if (!cursor) return;
		setLoading(true);
		try {
			const next = await adminApi().orders({ ...query, cursor, limit: 50 });
			setMore((p) => [...p, ...next.items]);
			setCursor(next.nextCursor);
		} finally {
			setLoading(false);
		}
	};
	const csv = async () => {
		setCsvBusy(true);
		try {
			const blob = await adminApi().ordersCsv(query);
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = `orders-${query.from}-to-${query.to}.csv`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
		} finally {
			setCsvBusy(false);
		}
	};

	return (
		<section className="card">
			<Form method="get" className="inline-form orders-filters">
				<input type="hidden" name="from" value={query.from} />
				<input type="hidden" name="to" value={query.to} />
				<label className="grow">
					{t("orders_search")}
					<input
						type="search"
						name="q"
						className="input input--sm"
						placeholder={t("orders_search_hint")}
						defaultValue={params.get("q") ?? ""}
						maxLength={40}
					/>
				</label>
				<label>
					{t("payment")}
					<select
						name="payment"
						className="input input--sm"
						defaultValue={params.get("payment") ?? ""}
						onChange={(e) => e.currentTarget.form?.requestSubmit()}
					>
						<option value="">{t("any")}</option>
						{PAYMENT.map((p) => (
							<option key={p} value={p}>
								{t(`pay_${p}`)}
							</option>
						))}
					</select>
				</label>
				<label>
					{t("status")}
					<select
						name="fulfillment"
						className="input input--sm"
						defaultValue={params.get("fulfillment") ?? ""}
						onChange={(e) => e.currentTarget.form?.requestSubmit()}
					>
						<option value="">{t("any")}</option>
						{FULFILLMENT.map((f) => (
							<option key={f} value={f}>
								{t(`ful_${f}`)}
							</option>
						))}
					</select>
				</label>
				<button type="submit" className="btn">
					{t("show")}
				</button>
				<button type="button" className="btn" onClick={csv} disabled={csvBusy}>
					{t("download_csv")}
				</button>
			</Form>
			<div className="table-wrap">
				<table className="table orders-table">
					<thead>
						<tr>
							<th>{t("ticket")}</th>
							<th>{t("placed")}</th>
							<th>{t("channel")}</th>
							<th>{t("status")}</th>
							<th className="num">{t("total")}</th>
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 && (
							<tr>
								<td colSpan={5} className="muted empty">
									{t("no_orders")}
								</td>
							</tr>
						)}
						{rows.map((o) => (
							<tr
								key={o.id}
								className={[
									"row-link",
									o.fulfillmentStatus === "cancelled" ? "row-muted" : "",
									o.id === openId ? "row-on" : "",
									fresh.current.has(o.id) ? "row-new" : "",
								].join(" ")}
								onClick={() => onOpen(o.id)}
							>
								<td>
									<button
										type="button"
										className="link-btn strong"
										onClick={(e) => {
											e.stopPropagation();
											onOpen(o.id);
										}}
									>
										<bdi dir="ltr">{o.ticketNumber}</bdi>
									</button>
									{(o.customerName || o.tableLabel) && (
										<div className="muted small">
											{o.tableLabel && t("table_n", { n: o.tableLabel })}
											{o.tableLabel && o.customerName && " · "}
											{o.customerName}
										</div>
									)}
								</td>
								<td className="small">
									<bdi dir="ltr">{time(o.placedAt)}</bdi>
								</td>
								<td className="small">
									{t(`source_${o.source as "counter"}`)}
									<div className="muted">
										{t(
											o.type === "takeaway" ? "type_takeaway" : "type_dine_in",
										)}
									</div>
								</td>
								<td className="small">
									<StatusPill status={o.fulfillmentStatus} t={t} />{" "}
									<PayPill status={o.paymentStatus} t={t} />
								</td>
								<td className="num">{money(o.total)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{cursor && (
				<button
					type="button"
					className="btn"
					onClick={loadMore}
					disabled={loading}
				>
					{loading ? t("loading") : t("load_more")}
				</button>
			)}
		</section>
	);
}

function StatusPill({
	status,
	t,
}: {
	status: AdminOrderRow["fulfillmentStatus"];
	t: T;
}) {
	return <span className={`pill pill--${status}`}>{t(`ful_${status}`)}</span>;
}
function PayPill({
	status,
	t,
}: {
	status: AdminOrderRow["paymentStatus"];
	t: T;
}) {
	return (
		<span className={`pill pill--pay-${status}`}>{t(`pay_${status}`)}</span>
	);
}

function OrderDrawer({
	id,
	onClose,
	money,
	timeZone,
	t,
	lang,
}: {
	id: string;
	onClose: () => void;
	money: (n: number) => ReactNode;
	timeZone: string;
	t: T;
	lang: Lang;
}) {
	const [order, setOrder] = useState<AdminOrderDetail | null>(null);
	const [failed, setFailed] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let alive = true;
		setOrder(null);
		setFailed(false);
		adminApi()
			.order(id)
			.then((o) => alive && setOrder(o))
			.catch(() => alive && setFailed(true));
		return () => {
			alive = false;
		};
	}, [id]);
	useEffect(() => {
		ref.current?.focus();
		const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [onClose]);
	const time = timeOf(lang, timeZone);
	const clock = timeOf(lang, timeZone, true);
	const minutes = (a: string, b: string | null) =>
		b
			? Math.max(0, Math.trunc((Date.parse(b) - Date.parse(a)) / 60_000))
			: null;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: click outside closes; Escape does too
		<div className="drawer-backdrop" onClick={onClose} role="presentation">
			<div
				className="drawer"
				role="dialog"
				aria-modal="true"
				aria-label={t("order_detail")}
				tabIndex={-1}
				ref={ref}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
			>
				<div className="drawer__head">
					<h2>
						{order ? (
							<>
								{t("ticket")} <bdi dir="ltr">{order.ticketNumber}</bdi>
							</>
						) : (
							t("order_detail")
						)}
					</h2>
					<div className="actions-row">
						{order && (
							<button
								type="button"
								className="btn btn--sm no-print"
								onClick={() => window.print()}
							>
								{t("print_receipt")}
							</button>
						)}
						<button
							type="button"
							className="btn btn--sm"
							onClick={onClose}
							aria-label={t("close")}
						>
							✕
						</button>
					</div>
				</div>
				{failed && <p className="muted">{t("order_not_found")}</p>}
				{!order && !failed && <p className="muted">{t("loading")}</p>}
				{order && (
					<div className="drawer__body">
						<p>
							<StatusPill status={order.fulfillmentStatus} t={t} />{" "}
							<PayPill status={order.paymentStatus} t={t} />
						</p>
						<dl className="facts">
							<dt>{t("placed")}</dt>
							<dd>
								<bdi dir="ltr">{time(order.placedAt)}</bdi>
							</dd>
							<dt>{t("channel")}</dt>
							<dd>
								{t(`source_${order.source as "counter"}`)} ·{" "}
								{t(
									order.type === "takeaway" ? "type_takeaway" : "type_dine_in",
								)}
								{order.tableLabel && (
									<> · {t("table_n", { n: order.tableLabel })}</>
								)}
							</dd>
							{(order.deviceName || order.createdByName) && (
								<>
									<dt>{t("taken_by")}</dt>
									<dd>
										{[order.createdByName, order.deviceName]
											.filter(Boolean)
											.join(" · ")}
									</dd>
								</>
							)}
							{(order.customerName || order.customerPhone) && (
								<>
									<dt>{t("customer")}</dt>
									<dd>
										{order.customerName}
										{order.customerPhone && (
											<>
												{" "}
												<bdi dir="ltr">{order.customerPhone}</bdi>
											</>
										)}
									</dd>
								</>
							)}
							{order.note && (
								<>
									<dt>{t("note")}</dt>
									<dd>{order.note}</dd>
								</>
							)}
						</dl>

						<ol className="timeline">
							<li>
								<span>{t("placed")}</span>
								<bdi dir="ltr">{clock(order.placedAt)}</bdi>
							</li>
							{order.readyAt && (
								<li>
									<span>
										{t("ful_ready")}{" "}
										<span className="muted small">
											{t("minutes_short", {
												n: minutes(order.placedAt, order.readyAt) ?? 0,
											})}
										</span>
									</span>
									<bdi dir="ltr">{clock(order.readyAt)}</bdi>
								</li>
							)}
							{order.completedAt && (
								<li>
									<span>{t("ful_completed")}</span>
									<bdi dir="ltr">{clock(order.completedAt)}</bdi>
								</li>
							)}
							{order.cancelledAt && (
								<li className="warn">
									<span>
										{t("ful_cancelled")}
										{order.cancelReason && ` · ${order.cancelReason}`}
									</span>
									<bdi dir="ltr">{clock(order.cancelledAt)}</bdi>
								</li>
							)}
						</ol>

						<h3 className="subhead">{t("items")}</h3>
						<table className="table receipt">
							<tbody>
								{order.lines.map((l) => (
									<tr key={l.id} className={l.voidedAt ? "row-off" : undefined}>
										<td>
											<bdi dir="ltr">{l.quantity}×</bdi> {loc(l.name, lang)}
											{l.modifiers.length > 0 && (
												<div className="muted small">
													{l.modifiers.map((m) => loc(m.name, lang)).join(", ")}
												</div>
											)}
											{l.note && <div className="muted small">“{l.note}”</div>}
											{l.voidedAt && (
												<div className="warn small">
													{t("voided")}
													{l.voidReason && ` · ${l.voidReason}`}
												</div>
											)}
										</td>
										<td className="num">
											{money(l.lineTotal)}
											{l.lineDiscount > 0 && (
												<div className="muted small">
													−{money(l.lineDiscount)}
												</div>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
						<table className="table summary">
							<tbody>
								{order.discountTotal > 0 && (
									<tr>
										<td>{t("discounts")}</td>
										<td className="num">{money(-order.discountTotal)}</td>
									</tr>
								)}
								<tr>
									<td>
										{t("vat")}
										{order.pricesIncludeTax && (
											<span className="muted small">
												{" "}
												({t("vat_included")})
											</span>
										)}
									</td>
									<td className="num">{money(order.taxTotal)}</td>
								</tr>
								<tr className="strong total-row">
									<td>{t("total")}</td>
									<td className="num">{money(order.total)}</td>
								</tr>
							</tbody>
						</table>

						<h3 className="subhead">{t("payments")}</h3>
						{order.payments.length === 0 ? (
							<p className="muted">{t("no_payments")}</p>
						) : (
							<table className="table">
								<tbody>
									{order.payments.map((p) => (
										<tr
											key={p.id}
											className={
												p.state !== "succeeded" ? "row-muted" : undefined
											}
										>
											<td>
												{p.amount < 0 ? t("refund") : t(`method_${p.method}`)}
												<div className="muted small">
													<bdi dir="ltr">{clock(p.createdAt)}</bdi>
													{p.createdByName && ` · ${p.createdByName}`}
													{p.state !== "succeeded" && ` · ${p.state}`}
													{p.reason && ` · ${p.reason}`}
												</div>
											</td>
											<td className="num">
												{money(p.amount)}
												{p.tip > 0 && (
													<div className="muted small">
														+{money(p.tip)} {t("tip")}
													</div>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
						<p className="muted small">{t("refund_on_till")}</p>
					</div>
				)}
			</div>
		</div>
	);
}
