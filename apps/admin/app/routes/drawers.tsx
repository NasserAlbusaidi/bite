import { businessDate } from "@bite/core";
import { type ReactNode, useState } from "react";
import { data, Form, Link } from "react-router";
import { adminApi } from "../lib/api";
import type { AdminCashSession } from "../lib/contracts";
import type { Lang, T } from "../lib/i18n";
import { presets } from "../lib/insights";
import { toDecimal } from "../lib/money";
import { loadPlaces } from "../lib/places";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/drawers";

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
	const week = presets(today).find((p) => p.key === "last_7_days");
	let from = pick("from", week?.from ?? today);
	let to = pick("to", today);
	if (to < from) [from, to] = [to, from];
	const [sessions, report] = await Promise.all([
		api.cashSessions({ locationId, from, to }),
		api.salesReport({ locationId, from, to }),
	]);
	return { today, from, to, sessions, report, timeZone: s.timezone };
}

export default function Drawers({ loaderData }: Route.ComponentProps) {
	const { sessions, today, from, to, report, timeZone } = loaderData;
	const { t, lang, place } = useShell();
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const money = (n: number) => (
		<bdi dir="ltr">
			{toDecimal(n, decimals)} {currency}
		</bdi>
	);
	const [openId, setOpenId] = useState<string | null>(
		sessions.find((s) => s.status === "open")?.id ?? sessions[0]?.id ?? null,
	);
	const closed = sessions.filter((s) => s.status === "closed");
	const net = closed.reduce((s, x) => s + (x.variance ?? 0), 0);
	const short = closed.filter((s) => (s.variance ?? 0) < 0).length;
	const cashTaken =
		report.byMethod.find((m) => m.method === "cash")?.amount ?? 0;

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("drawers_title")}</h1>
					<p className="muted small">{place?.name}</p>
				</div>
				<button
					type="button"
					className="btn no-print"
					onClick={() => window.print()}
				>
					{t("print_pdf")}
				</button>
			</div>

			<div className="card presets no-print">
				<div className="actions-row">
					{presets(today).map((p) => (
						<Link
							key={p.key}
							to={`?from=${p.from}&to=${p.to}`}
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

			<section className="stats">
				<div className="card stat">
					<span className="muted small">{t("drawers_count")}</span>
					<strong>
						<bdi dir="ltr">{sessions.length}</bdi>
					</strong>
					<span className="muted small">
						{t("drawers_open_now", {
							count: sessions.filter((s) => s.status === "open").length,
						})}
					</span>
				</div>
				<div className="card stat">
					<span className="muted small">{t("cash_taken")}</span>
					<strong>{money(cashTaken)}</strong>
				</div>
				<div className="card stat">
					<span className="muted small">{t("variance_total")}</span>
					<strong className={net < 0 ? "warn" : undefined}>
						{net > 0 && "+"}
						{money(net)}
					</strong>
					<span className="muted small">
						{t("drawers_short", { count: short, total: closed.length })}
					</span>
				</div>
			</section>

			<section className="card">
				{sessions.length === 0 ? (
					<p className="muted empty">{t("drawers_none")}</p>
				) : (
					<div className="table-wrap">
						<table className="table">
							<thead>
								<tr>
									<th>{t("drawer")}</th>
									<th className="num">{t("expected")}</th>
									<th className="num">{t("counted")}</th>
									<th className="num">{t("variance")}</th>
								</tr>
							</thead>
							<tbody>
								{sessions.map((s) => (
									<DrawerRow
										key={s.id}
										s={s}
										open={openId === s.id}
										onToggle={() => setOpenId(openId === s.id ? null : s.id)}
										money={money}
										t={t}
										lang={lang}
										timeZone={timeZone}
									/>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</>
	);
}

function DrawerRow({
	s,
	open,
	onToggle,
	money,
	t,
	lang,
	timeZone,
}: {
	s: AdminCashSession;
	open: boolean;
	onToggle: () => void;
	money: (n: number) => ReactNode;
	t: T;
	lang: Lang;
	timeZone: string;
}) {
	const day = new Intl.DateTimeFormat(lang === "ar" ? "ar-OM" : "en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: "UTC",
		numberingSystem: "latn",
	}).format(new Date(`${s.businessDate}T00:00:00Z`));
	const clock = new Intl.DateTimeFormat(lang === "ar" ? "ar-OM" : "en-GB", {
		timeStyle: "short",
		numberingSystem: "latn",
		timeZone,
	});
	const at = (iso: string) => clock.format(new Date(iso));
	const v = s.variance;
	return (
		<>
			<tr className="row-link" onClick={onToggle}>
				<td>
					<button
						type="button"
						className="link-btn strong"
						aria-expanded={open}
						onClick={(e) => {
							e.stopPropagation();
							onToggle();
						}}
					>
						{day} · {s.deviceName}
					</button>
					<div className="muted small">
						{s.status === "open" ? (
							<span className="pill pill--preparing">{t("drawer_open")}</span>
						) : (
							<>
								{s.closedAt && at(s.closedAt) !== at(s.openedAt) && (
									<>
										<bdi dir="ltr">
											{at(s.openedAt)}–{at(s.closedAt)}
										</bdi>{" "}
										·{" "}
									</>
								)}
								{s.closedByName ?? s.openedByName}
							</>
						)}
					</div>
				</td>
				<td className="num">{money(s.expectedCash)}</td>
				<td className="num">
					{s.countedCash === null ? "—" : money(s.countedCash)}
				</td>
				<td className="num">
					{v === null ? (
						"—"
					) : (
						<span
							className={
								v < 0
									? "pill pill--cancelled"
									: v > 0
										? "pill pill--ready"
										: "pill pill--completed"
							}
						>
							{v > 0 && "+"}
							{money(v)}
						</span>
					)}
				</td>
			</tr>
			{open && (
				<tr className="zrow">
					<td colSpan={4}>
						<div className="zreport">
							<h3 className="subhead">{t("z_report")}</h3>
							<table className="table summary">
								<tbody>
									<ZLine
										label={t("opening_float")}
										value={money(s.openingFloat)}
									/>
									<ZLine label={t("cash_sales")} value={money(s.cashSales)} />
									{s.cashRefunds > 0 && (
										<ZLine
											label={t("refunds_given")}
											value={money(-s.cashRefunds)}
										/>
									)}
									{s.payIns > 0 && (
										<ZLine label={t("pay_ins")} value={money(s.payIns)} />
									)}
									{s.payOuts > 0 && (
										<ZLine label={t("pay_outs")} value={money(-s.payOuts)} />
									)}
									{s.drops > 0 && (
										<ZLine label={t("drops")} value={money(-s.drops)} />
									)}
									<ZLine
										strong
										label={t("expected")}
										value={money(s.expectedCash)}
									/>
									<ZLine
										label={t("counted")}
										value={s.countedCash === null ? "—" : money(s.countedCash)}
									/>
									{v !== null && (
										<ZLine
											strong
											label={t("variance")}
											value={
												<>
													{v > 0 && "+"}
													{money(v)}
												</>
											}
										/>
									)}
								</tbody>
							</table>
							<p className="muted small">
								{t("opened_by", { name: s.openedByName, time: at(s.openedAt) })}
								{s.closedAt && s.closedByName && (
									<>
										{" "}
										·{" "}
										{t("closed_by", {
											name: s.closedByName,
											time: at(s.closedAt),
										})}
									</>
								)}
							</p>
							{s.notes && <p className="small">“{s.notes}”</p>}
							{s.movements.length > 0 && (
								<>
									<h4 className="subhead">{t("movements")}</h4>
									<ul className="plain-list small">
										{s.movements.map((m) => (
											<li key={`${m.createdAt}${m.kind}`}>
												<bdi dir="ltr">{at(m.createdAt)}</bdi> · {t(m.kind)} ·{" "}
												{money(m.amount)} · {m.reason}{" "}
												<span className="muted">({m.byName})</span>
											</li>
										))}
									</ul>
								</>
							)}
						</div>
					</td>
				</tr>
			)}
		</>
	);
}

function ZLine({
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
