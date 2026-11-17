import { addDays, businessDate } from "@bite/core";
import { type ReactNode, useState } from "react";
import { data, Form, useSearchParams } from "react-router";
import { adminApi } from "../lib/api";
import type { AdminOrderRow } from "../lib/contracts";
import { loc } from "../lib/i18n";
import { toDecimal } from "../lib/money";
import { loadPlaces } from "../lib/places";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/reports";

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
		return DATE.test(v) ? v : d;
	};
	let from = pick("from", today);
	let to = pick("to", today);
	if (to < from) [from, to] = [to, from];
	const pay = url.searchParams.get("payment");
	const ful = url.searchParams.get("fulfillment");
	const filters = {
		...(PAYMENT.includes(pay as Payment)
			? { paymentStatus: pay as Payment }
			: {}),
		...(FULFILLMENT.includes(ful as Fulfillment)
			? { fulfillmentStatus: ful as Fulfillment }
			: {}),
	};
	const [report, orders] = await Promise.all([
		api.salesReport({ locationId, from, to }),
		api.orders({ locationId, from, to, ...filters, limit: 50 }),
	]);
	return {
		locationId,
		timeZone: s.timezone,
		today,
		from,
		to,
		filters,
		report,
		orders,
	};
}

export default function Reports({ loaderData }: Route.ComponentProps) {
	const { report, orders, today, from, to, filters, locationId } = loaderData;
	const { t, lang, place } = useShell();
	const [params] = useSearchParams();
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const money = (n: number) => (
		<bdi dir="ltr">
			{toDecimal(n, decimals)} {currency}
		</bdi>
	);
	const presets: [string, string, string][] = [
		[t("today"), today, today],
		[t("yesterday"), addDays(today, -1), addDays(today, -1)],
		[t("last_7_days"), addDays(today, -6), today],
		[t("this_month"), `${today.slice(0, 8)}01`, today],
	];
	const link = (f: string, tt: string) => {
		const p = new URLSearchParams(params);
		p.set("from", f);
		p.set("to", tt);
		return `?${p.toString()}`;
	};

	return (
		<>
			<div className="page-head">
				<h1>{t("reports_title", { location: place?.name ?? "" })}</h1>
			</div>
			<div className="card presets">
				<div className="actions-row">
					{presets.map(([label, f, tt]) => (
						<a
							key={label}
							href={link(f, tt)}
							className={`chip${f === from && tt === to ? " chip--on" : ""}`}
						>
							{label}
						</a>
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

			<section className="stats">
				<Stat
					label={t("net_sales")}
					value={money(report.net)}
					hint={t("net_sales_hint")}
				/>
				<Stat
					label={t("orders")}
					value={<bdi dir="ltr">{report.orderCount}</bdi>}
				/>
				<Stat
					label={t("avg_order")}
					value={money(
						report.orderCount
							? Math.trunc(report.total / report.orderCount)
							: 0,
					)}
				/>
				<Stat label={t("discounts")} value={money(report.discounts)} />
				<Stat label={t("vat")} value={money(report.tax)} />
				<Stat label={t("tips")} value={money(report.tips)} />
			</section>

			<div className="grid2">
				<section className="card">
					<h2>{t("by_method")}</h2>
					<table className="table">
						<tbody>
							{report.byMethod.length === 0 && (
								<tr>
									<td className="muted">{t("no_sales")}</td>
								</tr>
							)}
							{[...report.byMethod]
								.sort((a, b) => b.amount - a.amount)
								.map((m) => (
									<tr key={m.method}>
										<td>{t(`method_${m.method}`)}</td>
										<td className="num muted small">
											<bdi dir="ltr">{m.count}</bdi>
										</td>
										<td className="num">{money(m.amount)}</td>
									</tr>
								))}
						</tbody>
					</table>
					<table className="table summary">
						<tbody>
							<tr>
								<td>{t("gross_sales")}</td>
								<td className="num">{money(report.gross)}</td>
							</tr>
							<tr>
								<td>{t("discounts")}</td>
								<td className="num">{money(-report.discounts)}</td>
							</tr>
							<tr>
								<td>{t("total_charged")}</td>
								<td className="num">{money(report.total)}</td>
							</tr>
							<tr>
								<td>{t("vat")}</td>
								<td className="num">{money(-report.tax)}</td>
							</tr>
							<tr className="strong">
								<td>{t("net_sales")}</td>
								<td className="num">{money(report.net)}</td>
							</tr>
						</tbody>
					</table>
				</section>
				<section className="card">
					<h2>{t("top_products")}</h2>
					<table className="table">
						<tbody>
							{report.topProducts.map((p, i) => (
								<tr key={p.productId ?? i}>
									<td>{loc(p.name, lang)}</td>
									<td className="num muted small">
										<bdi dir="ltr">×{p.quantity}</bdi>
									</td>
									<td className="num">{money(p.revenue)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			</div>

			<OrdersList
				key={`${from}:${to}:${filters.paymentStatus ?? ""}:${filters.fulfillmentStatus ?? ""}`}
				first={orders}
				query={{ locationId, from, to, ...filters }}
				money={money}
				timeZone={loaderData.timeZone}
			/>
		</>
	);
}

function Stat({
	label,
	value,
	hint,
}: {
	label: string;
	value: ReactNode;
	hint?: string;
}) {
	return (
		<div className="card stat">
			<span className="muted small">{label}</span>
			<strong>{value}</strong>
			{hint && <span className="muted small">{hint}</span>}
		</div>
	);
}

type Query = {
	locationId: string;
	from: string;
	to: string;
	paymentStatus?: Payment;
	fulfillmentStatus?: Fulfillment;
};

function OrdersList({
	first,
	query,
	money,
	timeZone,
}: {
	first: { items: AdminOrderRow[]; nextCursor?: string | undefined };
	query: Query;
	money: (n: number) => ReactNode;
	/** Times show in the shop's zone, not the viewer's. */
	timeZone: string;
}) {
	const { t, lang } = useShell();
	const [params] = useSearchParams();
	const [pages, setPages] = useState([first]);
	const [loading, setLoading] = useState(false);
	const [csvBusy, setCsvBusy] = useState(false);
	const rows = pages.flatMap((p) => p.items);
	const cursor = pages.at(-1)?.nextCursor;
	const time = (iso: string) =>
		new Date(iso).toLocaleString(lang === "ar" ? "ar-OM" : "en-GB", {
			dateStyle: "short",
			timeStyle: "short",
			numberingSystem: "latn",
			timeZone,
		});

	const more = async () => {
		if (!cursor) return;
		setLoading(true);
		try {
			const next = await adminApi().orders({ ...query, cursor, limit: 50 });
			setPages((p) => [...p, next]);
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
			<div className="page-head">
				<h2>{t("orders")}</h2>
				<button type="button" className="btn" onClick={csv} disabled={csvBusy}>
					{t("download_csv")}
				</button>
			</div>
			<Form method="get" className="inline-form">
				<input type="hidden" name="from" value={query.from} />
				<input type="hidden" name="to" value={query.to} />
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
			</Form>
			<table className="table">
				<thead>
					<tr>
						<th>{t("ticket")}</th>
						<th>{t("placed")}</th>
						<th>{t("status")}</th>
						<th className="num">{t("total")}</th>
					</tr>
				</thead>
				<tbody>
					{rows.length === 0 && (
						<tr>
							<td colSpan={4} className="muted">
								{t("no_orders")}
							</td>
						</tr>
					)}
					{rows.map((o) => (
						<tr
							key={o.id}
							className={o.fulfillmentStatus === "cancelled" ? "row-muted" : ""}
						>
							<td>
								<bdi dir="ltr">{o.ticketNumber}</bdi>
								{o.customerName && (
									<div className="muted small">{o.customerName}</div>
								)}
							</td>
							<td className="small">
								<bdi dir="ltr">{time(o.placedAt)}</bdi>
							</td>
							<td className="small">
								{t(`ful_${o.fulfillmentStatus}`)} ·{" "}
								{t(`pay_${o.paymentStatus}`)}
							</td>
							<td className="num">{money(o.total)}</td>
						</tr>
					))}
				</tbody>
			</table>
			{cursor && (
				<button type="button" className="btn" onClick={more} disabled={loading}>
					{loading ? t("loading") : t("load_more")}
				</button>
			)}
		</section>
	);
}
