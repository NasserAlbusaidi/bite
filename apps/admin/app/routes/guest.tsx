import { Icon } from "@bite/ui";
import { data, Form, Link, useNavigation } from "react-router";
import { AdminApiError, adminApi } from "../lib/api";
import { flash } from "../lib/flash";
import { loc, savedLang, translator } from "../lib/i18n";
import { toDecimal } from "../lib/money";
import { initials } from "../lib/staff-list";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/guest";
import { sinceLabel } from "./guests";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
	const api = adminApi();
	try {
		const [guest, program] = await Promise.all([
			api.customer(params.guestId),
			api.loyalty(),
		]);
		return { guest, program };
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 404)
			throw data(null, { status: 404 });
		throw e;
	}
}

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs) {
	const form = await request.formData();
	const points = Number(form.get("points"));
	const sign = form.get("sign") === "-" ? -1 : 1;
	const reason = String(form.get("reason") ?? "").trim();
	if (!Number.isInteger(points) || points <= 0 || !reason)
		return { error: "adjust_invalid" as const };
	try {
		await adminApi().adjustPoints(params.guestId, {
			points: sign * points,
			reason,
		});
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 422)
			return { error: "adjust_below_zero" as const };
		throw e;
	}
	flash(translator(savedLang())("points_adjusted"));
	return { error: null };
}

export default function Guest({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { guest: g, program } = loaderData;
	const { t, lang, place } = useShell();
	const nav = useNavigation();
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const money = (n: number) => (
		<bdi dir="ltr">
			{toDecimal(n, decimals)} {currency}
		</bdi>
	);
	const now = Date.now();
	const avg = g.visitCount ? Math.floor(g.totalSpent / g.visitCount) : 0;
	const rewardName = (id: string | null) => {
		const r = program.rewards.find((x) => x.id === id);
		return r ? loc(r.name, lang) : (id ?? "");
	};
	const next = [...program.rewards]
		.filter((r) => r.points > g.points)
		.sort((a, b) => a.points - b.points)[0];
	const can = program.rewards.filter((r) => r.points <= g.points);

	return (
		<>
			<Link to="/guests" className="back-link">
				<Icon name="chevron-back" />
				{t("guests_title")}
			</Link>
			<div className="page-head gx-headrow">
				<span className="avatar gx-avatar avatar--lg" aria-hidden="true">
					{initials(g.name ?? "?")}
				</span>
				<div>
					<h1>{g.name ?? t("guest_no_name")}</h1>
					<p className="muted small page-sub">
						<bdi dir="ltr">{g.phone}</bdi> ·{" "}
						{t("guest_since", {
							date: new Date(g.createdAt).toLocaleDateString(
								lang === "ar" ? "ar-OM" : "en-GB",
								{ month: "short", year: "numeric" },
							),
						})}{" "}
						· {t("last_visit")} {sinceLabel(g.lastVisitAt, now, t)}
					</p>
				</div>
			</div>

			<section className="stats stats--kpi">
				<div className="card stat">
					<span className="muted small">{t("visits")}</span>
					<strong>
						<bdi dir="ltr">{g.visitCount}</bdi>
					</strong>
				</div>
				<div className="card stat">
					<span className="muted small">{t("total_spent")}</span>
					<strong>{money(g.totalSpent)}</strong>
				</div>
				<div className="card stat">
					<span className="muted small">{t("avg_ticket")}</span>
					<strong>{money(avg)}</strong>
				</div>
				{program.enabled && (
					<div className="card stat">
						<span className="muted small">{t("points")}</span>
						<strong>
							<bdi dir="ltr">{g.points.toLocaleString("en")}</bdi>
						</strong>
						<span className="muted small">
							{can.length > 0
								? t("can_redeem", {
										rewards: can.map((r) => loc(r.name, lang)).join(", "),
									})
								: next
									? t("points_to_next", {
											points: next.points - g.points,
											reward: loc(next.name, lang),
										})
									: ""}
						</span>
					</div>
				)}
			</section>

			{g.favorites.length > 0 && (
				<section className="card">
					<h2 className="gx-title">{t("usually_orders")}</h2>
					<ul className="gx-chips">
						{g.favorites.map((f) => (
							<li key={f.name.en} className="chip">
								{loc(f.name, lang)}{" "}
								<span className="muted small">
									× <bdi dir="ltr">{f.count}</bdi>
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			<div className="gx-grid">
				<section className="card">
					<h2 className="gx-title">{t("recent_orders")}</h2>
					{g.orders.length === 0 ? (
						<p className="muted">{t("no_orders_yet")}</p>
					) : (
						<div className="table-wrap">
							<table className="table">
								<thead>
									<tr>
										<th>{t("date")}</th>
										<th>{t("location")}</th>
										<th>{t("ticket")}</th>
										<th className="num">{t("total")}</th>
									</tr>
								</thead>
								<tbody>
									{g.orders.map((o) => (
										<tr key={o.id}>
											<td>
												<bdi dir="ltr">{o.businessDate}</bdi>
											</td>
											<td>{o.locationName}</td>
											<td>
												<Link to={`/orders?order=${o.id}`}>
													<bdi dir="ltr">{o.ticketNumber}</bdi>
												</Link>
											</td>
											<td className="num">{money(o.total)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				<section className="card">
					<h2 className="gx-title">{t("points_history")}</h2>
					{g.ledger.length === 0 ? (
						<p className="muted">{t("no_points_yet")}</p>
					) : (
						<ul className="gx-ledger">
							{g.ledger.map((l) => (
								<li key={l.id}>
									<span
										className={
											l.points > 0 ? "gx-ledger__pts up" : "gx-ledger__pts down"
										}
									>
										<bdi dir="ltr">
											{l.points > 0 ? "+" : ""}
											{l.points}
										</bdi>
									</span>
									<span className="gx-ledger__what">
										{l.kind === "earn"
											? t("ledger_earn", { ticket: l.ticketNumber ?? "" })
											: l.kind === "redeem"
												? t("ledger_redeem", { reward: rewardName(l.rewardId) })
												: (l.reason ?? t("ledger_adjust"))}
									</span>
									<span className="muted small">
										{sinceLabel(l.createdAt, now, t)}
									</span>
								</li>
							))}
						</ul>
					)}

					<Form method="post" className="gx-adjust">
						<h3 className="small strong">{t("adjust_points")}</h3>
						<div className="gx-adjust__row">
							<select
								name="sign"
								className="input"
								aria-label={t("adjust_points")}
							>
								<option value="+">+</option>
								<option value="-">−</option>
							</select>
							<input
								name="points"
								className="input"
								inputMode="numeric"
								pattern="[0-9]*"
								placeholder="50"
								aria-label={t("points")}
								required
							/>
							<input
								name="reason"
								className="input"
								maxLength={200}
								placeholder={t("adjust_reason")}
								aria-label={t("adjust_reason")}
								required
							/>
							<button
								className="btn"
								type="submit"
								disabled={nav.state !== "idle"}
							>
								{t("save")}
							</button>
						</div>
						{actionData?.error && (
							<p className="error small" role="alert">
								{t(actionData.error)}
							</p>
						)}
					</Form>
				</section>
			</div>
		</>
	);
}
