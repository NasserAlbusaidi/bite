import { businessDate } from "@bite/core";
import type { ReactNode } from "react";
import { data, Link } from "react-router";
import {
	DayChart,
	DeltaChip,
	Heatmap,
	HourBars,
	MixList,
} from "../components/charts";
import { RangeBar, useBusy } from "../components/range-bar";
import { adminApi } from "../lib/api";
import type { SalesReport, TrendsReport } from "../lib/contracts";
import { taken } from "../lib/dashboard";
import { loc } from "../lib/i18n";
import { daysIn, delta, heatGrid, previousPeriod } from "../lib/insights";
import { toDecimal } from "../lib/money";
import { loadPlaces, type Place } from "../lib/places";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/reports";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
	const prev = previousPeriod(from, to);
	const q = { locationId, from, to };
	// The comparison is an extra: a plan's history window may refuse it.
	const [report, trends, prevReport, prevTrends, branches] = await Promise.all([
		api.salesReport(q),
		api.trends(q),
		api.salesReport({ locationId, ...prev }).catch(() => null),
		api.trends({ locationId, ...prev }).catch(() => null),
		places.length > 1
			? Promise.all(
					places.map(async (p) => ({
						place: p,
						report: await api
							.salesReport({ locationId: p.id, from, to })
							.catch(() => null),
						prev: await api
							.salesReport({ locationId: p.id, ...prev })
							.catch(() => null),
					})),
				)
			: Promise.resolve([]),
	]);
	return {
		locationId,
		today,
		from,
		to,
		prev,
		report,
		trends,
		prevReport,
		prevTrends,
		branches,
	};
}

export default function Reports({ loaderData }: Route.ComponentProps) {
	const { report, trends, today, from, to, prev } = loaderData;
	// Nothing sold before (new branch, start of history): no comparison.
	// Also none when the earlier range is mostly before the shop's history
	// starts: "+2000%" against two days of trading tells nobody anything.
	const active = (x: TrendsReport | null) =>
		x ? x.days.filter((d) => d.orders > 0).length : 0;
	const hasPrev =
		(loaderData.prevReport?.orderCount ?? 0) > 0 &&
		active(loaderData.prevTrends) * 5 >= active(trends) * 4;
	const prevReport = hasPrev ? loaderData.prevReport : null;
	const prevTrends = hasPrev ? loaderData.prevTrends : null;
	// Today so far against all of yesterday would always read as a drop.
	const partial = from === today && to === today;
	const { t, lang, place } = useShell();
	const busy = useBusy("/reports");
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const money = (
		n: number,
		p: Pick<Place, "decimals" | "currencyCode"> = {
			decimals,
			currencyCode: currency,
		},
	) => (
		<bdi dir="ltr">
			{toDecimal(n, p.decimals)} {p.currencyCode}
		</bdi>
	);
	const unit = 10 ** decimals;
	const compact = new Intl.NumberFormat("en", {
		notation: "compact",
		maximumFractionDigits: 1,
	});
	const short = (n: number) => compact.format(Math.trunc(n / unit));
	const avg = (r: SalesReport) =>
		r.orderCount ? Math.trunc(r.total / r.orderCount) : 0;
	const vs = (cur: number, before: number | undefined) =>
		before === undefined || partial ? null : (
			<DeltaChip d={delta(cur, before)} t={t} />
		);
	const single = from === to;
	const grid = heatGrid(trends.heat);
	const dayFmt = new Intl.DateTimeFormat(lang === "ar" ? "ar-OM" : "en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
		numberingSystem: "latn",
	});
	const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
	const rangeLabel = single ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
	const wd = new Intl.DateTimeFormat(lang === "ar" ? "ar-OM" : "en-GB", {
		weekday: "long",
		timeZone: "UTC",
	});
	const busiest = grid.busiest;
	const weekdayOfFrom = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
	const hoursOfDay = (h: TrendsReport | null, w: number) => {
		const out = Array<number>(24).fill(0);
		for (const c of h?.heat ?? []) if (c.weekday === w) out[c.hour] = c.orders;
		return out;
	};
	const sourceTotal = trends.bySource.reduce((s, r) => s + r.orders, 0);
	const guestShare = sourceTotal
		? Math.trunc(
				(trends.bySource
					.filter((r) => r.source !== "counter")
					.reduce((s, r) => s + r.orders, 0) *
					100) /
					sourceTotal,
			)
		: 0;

	const summaryCsv = () => {
		const rows = [
			["date", "orders", `net_${currency}`, `total_${currency}`],
			...trends.days.map((d) => [
				d.date,
				String(d.orders),
				toDecimal(d.net, decimals),
				toDecimal(d.total, decimals),
			]),
		];
		const blob = new Blob(
			[`﻿${rows.map((r) => r.join(",")).join("\r\n")}\r\n`],
			{
				type: "text/csv",
			},
		);
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `sales-${place?.slug ?? "branch"}-${from}-to-${to}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	};

	return (
		<div className={busy ? "report is-busy" : "report"}>
			<div className="page-head">
				<div>
					<h1>{t("reports_title", { location: place?.name ?? "" })}</h1>
					<p className="muted small">
						<bdi dir="ltr">{rangeLabel}</bdi>
						{prevReport && (
							<>
								{" · "}
								{t("compared_with", {
									range:
										prev.from === prev.to
											? fmtDay(prev.from)
											: `${fmtDay(prev.from)} – ${fmtDay(prev.to)}`,
								})}
							</>
						)}
					</p>
				</div>
				<div className="actions-row no-print">
					<button type="button" className="btn" onClick={summaryCsv}>
						{t("download_csv")}
					</button>
					<button type="button" className="btn" onClick={() => window.print()}>
						{t("print_pdf")}
					</button>
				</div>
			</div>

			<RangeBar today={today} from={from} to={to} t={t} />

			<section className="stats stats--kpi">
				<Kpi
					label={t("net_sales")}
					value={money(report.net)}
					delta={vs(report.net, prevReport?.net)}
					hint={
						prevReport && (
							<>
								{t(partial ? "yesterday_was" : "before")}{" "}
								{money(prevReport.net)}
							</>
						)
					}
				/>
				<Kpi
					label={t("orders")}
					value={<bdi dir="ltr">{report.orderCount}</bdi>}
					delta={vs(report.orderCount, prevReport?.orderCount)}
					hint={
						prevReport && (
							<>
								{t(partial ? "yesterday_was" : "before")}{" "}
								<bdi dir="ltr">{prevReport.orderCount}</bdi>
							</>
						)
					}
				/>
				<Kpi
					label={t("avg_order")}
					value={money(avg(report))}
					delta={vs(avg(report), prevReport ? avg(prevReport) : undefined)}
					hint={
						prevReport && (
							<>
								{t(partial ? "yesterday_was" : "before")}{" "}
								{money(avg(prevReport))}
							</>
						)
					}
				/>
				<Kpi
					label={t("overview_taken")}
					value={money(taken(report))}
					hint={t("taken_hint")}
				/>
				<Kpi
					label={t("discounts")}
					value={money(report.discounts)}
					hint={
						report.gross > 0 && (
							<>
								<bdi dir="ltr">
									{Math.trunc((report.discounts * 100) / report.gross)}%
								</bdi>{" "}
								{t("of_gross")}
							</>
						)
					}
				/>
				{trends.prep.medianMinutes !== null && (
					<Kpi
						label={t("prep_time")}
						value={
							<bdi dir="ltr">
								{t("minutes_short", { n: trends.prep.medianMinutes })}
							</bdi>
						}
						hint={
							trends.prep.p90Minutes !== null &&
							t("prep_p90", { n: trends.prep.p90Minutes })
						}
					/>
				)}
			</section>

			<section className="card">
				<div className="card-head">
					<h2>{single ? t("chart_hourly") : t("chart_daily")}</h2>
					{!single && (
						<span className="muted small">
							{t("n_days", { count: daysIn(from, to) })}
						</span>
					)}
				</div>
				{report.orderCount === 0 ? (
					<p className="muted empty">{t("no_sales")}</p>
				) : single ? (
					<HourBars
						today={hoursOfDay(trends, weekdayOfFrom)}
						ref={
							prevTrends
								? hoursOfDay(prevTrends, (weekdayOfFrom + 6) % 7)
								: undefined
						}
						nowHour={-1}
						t={t}
					/>
				) : (
					<DayChart
						days={trends.days}
						prev={prevTrends?.days}
						partial={to === today ? today : undefined}
						money={(n) => money(n)}
						short={short}
						lang={lang}
						t={t}
					/>
				)}
			</section>

			{loaderData.branches.length > 1 && (
				<section className="card">
					<h2>{t("branch_compare")}</h2>
					<div className="table-wrap">
						<table className="table">
							<thead>
								<tr>
									<th>{t("location")}</th>
									<th className="num">{t("net_sales")}</th>
									<th className="num">{t("orders")}</th>
									<th className="num">{t("avg_order")}</th>
									<th className="num">{t("vs_previous")}</th>
								</tr>
							</thead>
							<tbody>
								{[...loaderData.branches]
									.sort((a, b) => (b.report?.net ?? 0) - (a.report?.net ?? 0))
									.map((b) => {
										const best = Math.max(
											1,
											...loaderData.branches.map((x) => x.report?.net ?? 0),
										);
										return (
											<tr key={b.place.id}>
												<td>
													<span
														className={
															b.place.id === loaderData.locationId
																? "strong"
																: undefined
														}
													>
														{b.place.name}
													</span>
													<span
														className="bar"
														aria-hidden="true"
														style={{
															inlineSize: `${Math.max(2, Math.trunc(((b.report?.net ?? 0) * 100) / best))}%`,
														}}
													/>
												</td>
												<td className="num strong">
													{b.report ? money(b.report.net, b.place) : "—"}
												</td>
												<td className="num">
													<bdi dir="ltr">{b.report?.orderCount ?? "—"}</bdi>
												</td>
												<td className="num muted">
													{b.report ? money(avg(b.report), b.place) : "—"}
												</td>
												<td className="num">
													{hasPrev && b.report && b.prev ? (
														<DeltaChip
															d={delta(b.report.net, b.prev.net)}
															t={t}
														/>
													) : (
														"—"
													)}
												</td>
											</tr>
										);
									})}
							</tbody>
						</table>
					</div>
				</section>
			)}

			<div className="grid2">
				{daysIn(from, to) >= 7 && (
					<section className="card">
						<div className="card-head">
							<h2>{t("heat_title")}</h2>
						</div>
						{busiest && (
							<p className="callout small">
								{t("heat_busiest", {
									day: wd.format(
										new Date(Date.UTC(2024, 0, 1 + busiest.weekday)),
									),
									hour: `${String(busiest.hour).padStart(2, "0")}:00`,
								})}
							</p>
						)}
						<Heatmap grid={grid} lang={lang} t={t} />
					</section>
				)}

				<section className="card">
					<h2>{t("channels")}</h2>
					{guestShare > 0 && (
						<p className="callout small">
							{t("guest_share", { pct: guestShare })}
						</p>
					)}
					<MixList
						rows={[...trends.bySource]
							.sort((a, b) => b.net - a.net)
							.map((r) => ({
								key: r.source,
								label: t(`source_${r.source}`),
								value: r.net,
								shown: money(r.net),
								sub: t("n_orders", { count: r.orders }),
							}))}
						empty={t("no_sales")}
					/>
					<h3 className="subhead">{t("order_type")}</h3>
					<MixList
						rows={[...trends.byType]
							.sort((a, b) => b.orders - a.orders)
							.map((r) => ({
								key: r.type,
								label: t(
									r.type === "takeaway" ? "type_takeaway" : "type_dine_in",
								),
								value: r.orders,
								shown: t("n_orders", { count: r.orders }),
							}))}
						empty={t("no_sales")}
					/>
				</section>
			</div>

			<div className="grid2">
				<section className="card">
					<h2>{t("top_products")}</h2>
					<MixList
						rows={report.topProducts.map((p, i) => ({
							key: p.productId ?? String(i),
							label: (
								<>
									<span className="rank" aria-hidden="true">
										{i + 1}
									</span>
									{loc(p.name, lang)}
								</>
							),
							value: p.revenue,
							shown: money(p.revenue),
							sub: <bdi dir="ltr">×{p.quantity}</bdi>,
						}))}
						empty={t("no_sales")}
					/>
				</section>
				<div className="stack">
					<section className="card">
						<h2>{t("by_category")}</h2>
						<MixList
							rows={trends.byCategory.map((c, i) => ({
								key: c.categoryId ?? String(i),
								label: loc(c.name, lang),
								value: c.revenue,
								shown: money(c.revenue),
								sub: <bdi dir="ltr">×{c.quantity}</bdi>,
							}))}
							empty={t("no_sales")}
						/>
					</section>
					<section className="card">
						<h2>{t("by_method")}</h2>
						<MixList
							rows={[...report.byMethod]
								.sort((a, b) => b.amount - a.amount)
								.map((m) => ({
									key: m.method,
									label: t(`method_${m.method}`),
									value: m.amount,
									shown: money(m.amount),
									sub: t("n_payments", { count: m.count }),
								}))}
							empty={t("no_sales")}
						/>
						{report.refundCount > 0 && (
							<p className="muted small">
								{t("refunds_given")}: <bdi dir="ltr">{report.refundCount}</bdi>{" "}
								· {money(-report.refunds)}
							</p>
						)}
					</section>
				</div>
			</div>

			<div className="grid2 grid2--start">
				<section className="card">
					<h2>{t("money_summary")}</h2>
					<table className="table summary">
						<tbody>
							<Row label={t("gross_sales")} value={money(report.gross)} />
							<Row label={t("discounts")} value={money(-report.discounts)} />
							<Row label={t("total_charged")} value={money(report.total)} />
							<Row label={t("vat")} value={money(-report.tax)} />
							<Row strong label={t("net_sales")} value={money(report.net)} />
							<Row label={t("tips")} value={money(report.tips)} />
							<Row label={t("refunds_given")} value={money(-report.refunds)} />
						</tbody>
					</table>
				</section>
				<section className="card no-print">
					<h2>{t("dig_deeper")}</h2>
					<ul className="plain-list links-list">
						<li>
							<Link to={`/orders?from=${from}&to=${to}`}>
								{t("see_orders")} →
							</Link>
						</li>
						<li>
							<Link to={`/drawers?from=${from}&to=${to}`}>
								{t("see_drawers")} →
							</Link>
						</li>
						<li>
							<button type="button" className="link-btn" onClick={summaryCsv}>
								{t("download_csv")}
							</button>
						</li>
					</ul>
				</section>
			</div>
		</div>
	);
}

function Row({
	label,
	value,
	strong,
}: {
	label: string;
	value: ReactNode;
	strong?: boolean;
}) {
	return (
		<tr className={strong ? "strong" : undefined}>
			<td>{label}</td>
			<td className="num">{value}</td>
		</tr>
	);
}

function Kpi({
	label,
	value,
	delta,
	hint,
}: {
	label: string;
	value: ReactNode;
	delta?: ReactNode;
	hint?: ReactNode;
}) {
	return (
		<div className="card stat">
			<span className="muted small">{label}</span>
			<strong>{value}</strong>
			<span className="stat__foot small">
				{delta}
				{hint && <span className="muted">{hint}</span>}
			</span>
		</div>
	);
}
