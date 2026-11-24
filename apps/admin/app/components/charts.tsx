import { type ReactNode, useId, useState } from "react";
import type { TrendsReport } from "../lib/contracts";
import type { Lang, T } from "../lib/i18n";
import {
	type Delta,
	type HeatGrid,
	niceMax,
	percentOf,
	shade,
} from "../lib/insights";

const locale = (lang: Lang) => (lang === "ar" ? "ar-OM" : "en-GB");

export function DeltaChip({ d, t }: { d: Delta; t: T }) {
	if (d.pct === null)
		return d.dir === "up" ? (
			<span className="delta delta--up">{t("delta_new")}</span>
		) : null;
	const arrow = d.dir === "up" ? "▲" : d.dir === "down" ? "▼" : "•";
	return (
		<span className={`delta delta--${d.dir}`} title={t("delta_vs_prev")}>
			<span aria-hidden="true">{arrow}</span>{" "}
			<bdi dir="ltr">{Math.abs(d.pct)}%</bdi>
			<span className="sr-only"> {t("delta_vs_prev")}</span>
		</span>
	);
}

/**
 * Daily net sales as bars, the previous period as a dashed line behind them.
 * Hover or focus a day for its numbers.
 */
export function DayChart({
	days,
	prev,
	partial,
	money,
	short,
	lang,
	t,
}: {
	days: TrendsReport["days"];
	prev?: TrendsReport["days"] | undefined;
	/** A day still in progress (today): drawn lighter, labelled "so far". */
	partial?: string | undefined;
	/** Formatted money for the tooltip. */
	money: (n: number) => ReactNode;
	/** Compact axis label, no currency. */
	short: (n: number) => string;
	lang: Lang;
	t: T;
}) {
	const [hover, setHover] = useState<number | null>(null);
	const id = useId();
	const W = 720;
	const H = 220;
	const L = 44;
	const B = 24;
	const top = niceMax(
		Math.max(1, ...days.map((d) => d.net), ...(prev ?? []).map((d) => d.net)),
	);
	const n = days.length;
	const slot = (W - L) / Math.max(1, n);
	const bw = Math.max(2, Math.min(28, slot * 0.7));
	const y = (v: number) => H - B - (v / top) * (H - B - 8);
	const x = (i: number) => L + slot * i + slot / 2;
	const every = Math.max(1, Math.ceil(n / 8));
	const dayFmt = new Intl.DateTimeFormat(locale(lang), {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
		numberingSystem: "latn",
	});
	const longFmt = new Intl.DateTimeFormat(locale(lang), {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: "UTC",
		numberingSystem: "latn",
	});
	const label = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
	const prevLine =
		prev && prev.length === n
			? prev.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.net)}`).join(" ")
			: null;
	const h = hover === null ? null : days[hover];

	return (
		<div className="chart" dir="ltr">
			<svg
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-labelledby={`${id}-t`}
				onMouseLeave={() => setHover(null)}
			>
				<title id={`${id}-t`}>{t("chart_daily")}</title>
				{[0, 0.25, 0.5, 0.75, 1].map((f) => (
					<g key={f}>
						<line
							className="chart__grid"
							x1={L}
							x2={W}
							y1={y(top * f)}
							y2={y(top * f)}
						/>
						<text
							className="chart__axis"
							x={L - 6}
							y={y(top * f) + 4}
							textAnchor="end"
						>
							{short(top * f)}
						</text>
					</g>
				))}
				{days.map((d, i) => (
					<g key={d.date}>
						<rect
							className={`chart__bar${hover === i ? " chart__bar--on" : ""}${d.date === partial ? " chart__bar--partial" : ""}`}
							x={x(i) - bw / 2}
							y={y(d.net)}
							width={bw}
							height={Math.max(0, H - B - y(d.net))}
							rx={Math.min(4, bw / 3)}
						/>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: focusable hover target for the tooltip */}
						<rect
							className="chart__hit"
							x={L + slot * i}
							y={0}
							width={slot}
							height={H - B}
							tabIndex={0}
							aria-label={`${longFmt.format(new Date(`${d.date}T00:00:00Z`))}`}
							onMouseEnter={() => setHover(i)}
							onFocus={() => setHover(i)}
							onBlur={() => setHover(null)}
						/>
						{i % every === 0 && (
							<text
								className="chart__axis"
								x={x(i)}
								y={H - 6}
								textAnchor="middle"
							>
								{label(d.date)}
							</text>
						)}
					</g>
				))}
				{prevLine && <path className="chart__prev" d={prevLine} />}
			</svg>
			<div className="chart__legend muted small">
				<span>
					<i className="swatch swatch--bar" /> {t("net_sales")}
				</span>
				{prevLine && (
					<span>
						<i className="swatch swatch--prev" /> {t("previous_period")}
					</span>
				)}
			</div>
			{h && hover !== null && (
				<div
					className="chart__tip"
					style={{
						insetInlineStart: `${Math.min(80, Math.max(8, (x(hover) / W) * 100))}%`,
					}}
					dir={lang === "ar" ? "rtl" : "ltr"}
				>
					<strong>
						{longFmt.format(new Date(`${h.date}T00:00:00Z`))}
						{h.date === partial && (
							<span className="muted"> · {t("so_far_today")}</span>
						)}
					</strong>
					<span>{money(h.net)}</span>
					<span className="muted">{t("n_orders", { count: h.orders })}</span>
					{prev?.[hover] && (
						<span className="muted">
							{t("previous_period")}: {money(prev[hover].net)}
						</span>
					)}
				</div>
			)}
		</div>
	);
}

/** Small inline bars: orders per hour, today vs a reference day. */
export function HourBars({
	today,
	ref,
	nowHour,
	t,
}: {
	today: number[];
	ref?: number[] | undefined;
	nowHour: number;
	t: T;
}) {
	const first = Math.min(
		...[...today, ...(ref ?? [])]
			.map((v, i) => (v > 0 ? i % 24 : 24))
			.concat(7),
	);
	const last = Math.max(
		...[...today, ...(ref ?? [])]
			.map((v, i) => (v > 0 ? i % 24 : 0))
			.concat(Math.max(nowHour, 22)),
	);
	const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
	const max = Math.max(1, ...today, ...(ref ?? []));
	return (
		<div className="hours" dir="ltr" role="img" aria-label={t("chart_hourly")}>
			{hours.map((h) => (
				<div
					key={h}
					className={`hours__col${h === nowHour ? " hours__col--now" : ""}`}
					title={`${String(h).padStart(2, "0")}:00 · ${today[h] ?? 0}${ref ? ` / ${ref[h] ?? 0}` : ""}`}
				>
					{ref && (
						<span
							className="hours__ref"
							style={{ blockSize: `${((ref[h] ?? 0) / max) * 100}%` }}
						/>
					)}
					<span
						className="hours__bar"
						style={{ blockSize: `${((today[h] ?? 0) / max) * 100}%` }}
					/>
					{h % 3 === 0 && (
						<span className="hours__label">{String(h).padStart(2, "0")}</span>
					)}
				</div>
			))}
		</div>
	);
}

export function Heatmap({
	grid,
	lang,
	t,
}: {
	grid: HeatGrid;
	lang: Lang;
	t: T;
}) {
	if (grid.hours.length === 0) return <p className="muted">{t("no_sales")}</p>;
	const wd = new Intl.DateTimeFormat(locale(lang), {
		weekday: "short",
		timeZone: "UTC",
	});
	// 2024-01-01 was a Monday.
	const dayName = (w: number) => wd.format(new Date(Date.UTC(2024, 0, 1 + w)));
	return (
		<div className="heat-wrap">
			<table className="heat" dir="ltr">
				<thead>
					<tr>
						<th />
						{grid.hours.map((h) => (
							<th key={h} scope="col">
								{h % 2 === 0 ? String(h).padStart(2, "0") : ""}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{grid.cells.map((row, w) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: weekdays are fixed
						<tr key={w}>
							<th scope="row">{dayName(w)}</th>
							{grid.hours.map((h) => (
								<td
									key={h}
									className={`heat__c heat__c--${shade(row[h] ?? 0, grid.max)}`}
									title={`${dayName(w)} ${String(h).padStart(2, "0")}:00 · ${t("n_orders", { count: row[h] ?? 0 })}`}
								/>
							))}
						</tr>
					))}
				</tbody>
			</table>
			<div className="heat__legend muted small">
				{t("heat_less")}
				{[1, 2, 3, 4].map((s) => (
					<i key={s} className={`heat__c heat__c--${s}`} />
				))}
				{t("heat_more")}
			</div>
		</div>
	);
}

/** Labelled horizontal bars with a share of the total. */
export function MixList({
	rows,
	empty,
}: {
	rows: {
		key: string;
		label: ReactNode;
		value: number;
		shown: ReactNode;
		sub?: ReactNode;
	}[];
	empty: ReactNode;
}) {
	const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
	const max = Math.max(1, ...rows.map((r) => r.value));
	if (rows.length === 0) return <p className="muted">{empty}</p>;
	return (
		<ul className="mix">
			{rows.map((r) => (
				<li key={r.key}>
					<div className="mix__row">
						<span className="mix__label">
							{r.label}
							{r.sub && <span className="muted small"> · {r.sub}</span>}
						</span>
						<span className="mix__value">
							{r.shown}
							<span className="muted small">
								{" "}
								<bdi dir="ltr">{percentOf(r.value, total)}%</bdi>
							</span>
						</span>
					</div>
					<span className="mix__track" aria-hidden="true">
						<span
							className="mix__fill"
							style={{ inlineSize: `${Math.max(1, (r.value / max) * 100)}%` }}
						/>
					</span>
				</li>
			))}
		</ul>
	);
}
