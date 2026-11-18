import { addDays, businessDate } from "@bite/core";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { adminApi } from "../lib/api";
import {
	attention,
	averageOrder,
	type BranchDay,
	share,
	taken,
	totals,
} from "../lib/dashboard";
import {
	hideSetup,
	noOrdersYet,
	type SetupStep,
	setupHidden,
	setupSteps,
} from "../lib/getting-started";
import { loc, type T } from "../lib/i18n";
import { toDecimal } from "../lib/money";
import { loadPlaces } from "../lib/places";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/home";

export async function clientLoader() {
	const api = adminApi();
	const [places, settings, me] = await Promise.all([
		loadPlaces(api),
		api.locations(),
		api.me(),
	]);
	const now = Date.now();
	const rows = await Promise.all(
		places.map(async (place): Promise<BranchDay | null> => {
			const s = settings.find((l) => l.id === place.id);
			if (!s) return null;
			const date = businessDate(now, s.timezone, s.dayCutoffMinutes);
			const range = (from: string, to: string) =>
				api.salesReport({ locationId: place.id, from, to });
			const [today, yesterday, week] = await Promise.all([
				range(date, date),
				range(addDays(date, -1), addDays(date, -1)),
				range(addDays(date, -6), date),
			]);
			return { place, date, today, yesterday, week };
		}),
	);
	const branches = rows.filter((r): r is BranchDay => r !== null);
	const locationId = selectedLocationId(places);
	const mine = branches.find((b) => b.place.id === locationId);
	if (!mine) return { branches, attention: [], setup: null };
	// The side panels are extras: one of them failing must not blank the page.
	const [unpaid, products, menu] = await Promise.all([
		api
			.orders({
				locationId: mine.place.id,
				from: mine.date,
				to: mine.date,
				paymentStatus: "unpaid",
				limit: 50,
			})
			.catch(() => ({ items: [] })),
		api.locationProducts(mine.place.id).catch(() => []),
		api
			.menu()
			.catch(() => ({ categories: [], products: [], modifierGroups: [] })),
	]);
	// A week with no orders anywhere: show the way to the first one. Only the
	// people who can do every step (owner, admins) get the list.
	const setup =
		me.member.orgRole !== "staff" && noOrdersYet(branches)
			? await Promise.all([api.staff(), api.devices(mine.place.id)])
					.then(([staff, devices]) =>
						setupSteps({
							locationId: mine.place.id,
							products: menu.products.filter((p) => !p.archivedAt).length,
							withPin: staff.filter((m) => m.isActive && m.hasPin).length,
							tablets: devices.filter((d) => !d.revokedAt).length,
							orders: 0,
						}),
					)
					.catch(() => null)
			: null;
	return {
		branches,
		setup,
		attention: attention({
			locationId: mine.place.id,
			date: mine.date,
			unpaid,
			products,
			menu,
		}),
	};
}

export default function Home({ loaderData }: Route.ComponentProps) {
	const { branches } = loaderData;
	const { t, lang, locationId, me } = useShell();
	const mine = branches.find((b) => b.place.id === locationId);
	const [hidden, setHidden] = useState(() => setupHidden(me.org.id));

	if (!mine)
		return (
			<>
				<div className="page-head">
					<h1>{t("overview")}</h1>
				</div>
				<p className="card muted">{t("overview_no_branch")}</p>
			</>
		);

	const money = (
		n: number,
		p: { decimals: number; currencyCode: string } = mine.place,
	): ReactNode => (
		<bdi dir="ltr">
			{toDecimal(n, p.decimals)} {p.currencyCode}
		</bdi>
	);
	const sum = totals(branches);
	const best = Math.max(...branches.map((b) => b.today.net));
	const day = new Intl.DateTimeFormat(lang === "ar" ? "ar-OM" : "en-GB", {
		weekday: "long",
		day: "numeric",
		month: "long",
		timeZone: "UTC",
	}).format(new Date(`${mine.date}T00:00:00Z`));
	const top = mine.today.topProducts.slice(0, 5);

	return (
		<>
			<div className="page-head">
				<h1>
					{t("overview_title", { location: mine.place.name })}{" "}
					<span className="muted small">{day}</span>
				</h1>
				<Link to="/reports">{t("overview_full_report")}</Link>
			</div>

			{loaderData.setup && !hidden && (
				<GettingStarted
					steps={loaderData.setup}
					t={t}
					onHide={() => {
						hideSetup(me.org.id);
						setHidden(true);
					}}
				/>
			)}

			<section className="stats">
				<Stat
					label={t("net_sales")}
					value={money(mine.today.net)}
					hint={
						<>
							{t("yesterday")} {money(mine.yesterday.net)}
						</>
					}
				/>
				<Stat
					label={t("orders")}
					value={<bdi dir="ltr">{mine.today.orderCount}</bdi>}
					hint={
						<>
							{t("yesterday")} <bdi dir="ltr">{mine.yesterday.orderCount}</bdi>
						</>
					}
				/>
				<Stat label={t("avg_order")} value={money(averageOrder(mine.today))} />
				<Stat
					label={t("overview_taken")}
					value={money(taken(mine.today))}
					hint={t("overview_taken_hint")}
				/>
			</section>

			{branches.length > 1 && (
				<section className="card">
					<h2>{t("overview_branches")}</h2>
					<div className="table-wrap">
						<table className="table">
							<thead>
								<tr>
									<th>{t("location")}</th>
									<th className="num">{t("today")}</th>
									<th className="num">{t("orders")}</th>
									<th className="num">{t("yesterday")}</th>
									<th className="num">{t("last_7_days")}</th>
								</tr>
							</thead>
							<tbody>
								{[...branches]
									.sort((a, b) => b.today.net - a.today.net)
									.map((b) => (
										<tr key={b.place.id}>
											<td>
												<span className={b === mine ? "strong" : undefined}>
													{b.place.name}
												</span>
												{sum && (
													<span
														className="bar"
														aria-hidden="true"
														style={{
															inlineSize: `${share(b.today.net, best)}%`,
														}}
													/>
												)}
											</td>
											<td className="num strong">
												{money(b.today.net, b.place)}
											</td>
											<td className="num">
												<bdi dir="ltr">{b.today.orderCount}</bdi>
											</td>
											<td className="num muted">
												{money(b.yesterday.net, b.place)}
											</td>
											<td className="num muted">
												{money(b.week.net, b.place)}
											</td>
										</tr>
									))}
							</tbody>
							{sum && (
								<tfoot>
									<tr className="strong total-row">
										<td>{t("total")}</td>
										<td className="num">{money(sum.net, sum)}</td>
										<td className="num">
											<bdi dir="ltr">{sum.orders}</bdi>
										</td>
										<td className="num">{money(sum.yesterday, sum)}</td>
										<td className="num">{money(sum.week, sum)}</td>
									</tr>
								</tfoot>
							)}
						</table>
					</div>
					<p className="muted small">{t("overview_branches_hint")}</p>
				</section>
			)}

			<div className="grid2">
				<section className="card">
					<h2>{t("overview_attention")}</h2>
					{loaderData.attention.length === 0 ? (
						<p className="muted">{t("overview_all_clear")}</p>
					) : (
						<ul className="plain-list attention">
							{loaderData.attention.map((a) => (
								<li key={a.kind}>
									<Link
										to={a.to}
										className={a.kind === "blocked" ? "warn" : ""}
									>
										{t(`attention_${a.kind}`, {
											count:
												a.kind === "unpaid" && a.more ? `${a.count}+` : a.count,
										})}
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="card">
					<h2>{t("overview_top")}</h2>
					{top.length === 0 ? (
						<p className="muted">{t("overview_no_sales")}</p>
					) : (
						<table className="table">
							<tbody>
								{top.map((p) => (
									<tr key={p.productId ?? p.name.en}>
										<td>{loc(p.name, lang)}</td>
										<td className="num muted">
											<bdi dir="ltr">× {p.quantity}</bdi>
										</td>
										<td className="num">{money(p.revenue)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</section>
			</div>
		</>
	);
}

function GettingStarted({
	steps,
	t,
	onHide,
}: {
	steps: SetupStep[];
	t: T;
	onHide: () => void;
}) {
	const next = steps.find((s) => !s.done);
	return (
		<section className="card setup">
			<div className="card-head">
				<h2>{t("setup_title")}</h2>
				<span className="muted small">
					{t("setup_progress", {
						done: steps.filter((s) => s.done).length,
						total: steps.length,
					})}
				</span>
			</div>
			<ol className="setup__steps">
				{steps.map((s, i) => (
					<li
						key={s.key}
						className={s.done ? "setup__step setup__step--done" : "setup__step"}
					>
						<span className="setup__mark" aria-hidden="true">
							{s.done ? "✓" : i + 1}
						</span>
						<div>
							<p className="setup__text strong">
								{t(`setup_${s.key}`)}
								{s.done && <span className="sr-only"> ({t("done")})</span>}
							</p>
							{!s.done && (
								<p className="setup__text muted small">
									{t(`setup_${s.key}_hint`)}
								</p>
							)}
						</div>
						{!s.done && (
							<Link
								className={s === next ? "btn btn--primary" : "btn"}
								to={s.to}
							>
								{t(`setup_${s.key}_go`)}
							</Link>
						)}
					</li>
				))}
			</ol>
			<button type="button" className="link-btn small" onClick={onHide}>
				{t("setup_hide")}
			</button>
		</section>
	);
}

function Stat({
	label,
	value,
	hint,
}: {
	label: string;
	value: ReactNode;
	hint?: ReactNode;
}) {
	return (
		<div className="card stat">
			<span className="muted small">{label}</span>
			<strong>{value}</strong>
			{hint && <span className="muted small">{hint}</span>}
		</div>
	);
}
