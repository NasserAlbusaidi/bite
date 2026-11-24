import { Icon } from "@bite/ui";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { adminApi } from "../lib/api";
import type { AdminCustomer, AdminCustomersQuery } from "../lib/contracts";
import { toDecimal } from "../lib/money";
import { initials } from "../lib/staff-list";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/guests";

const SORTS = ["recent", "visits", "spent", "points"] as const;
type Sort = (typeof SORTS)[number];

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const url = new URL(request.url);
	const q = url.searchParams.get("q")?.trim() || undefined;
	const raw = url.searchParams.get("sort");
	const sort: Sort = SORTS.includes(raw as Sort) ? (raw as Sort) : "recent";
	const query: AdminCustomersQuery = { sort, limit: 200, ...(q ? { q } : {}) };
	const api = adminApi();
	const [guests, program] = await Promise.all([
		api.customers(query),
		api.loyalty(),
	]);
	return { guests, program, q: q ?? "", sort };
}

/** "3 days ago", "today". */
export function sinceLabel(
	iso: string | null,
	now: number,
	t: ReturnType<typeof useShell>["t"],
): string {
	if (!iso) return "—";
	const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
	if (days <= 0) return t("today");
	if (days === 1) return t("yesterday");
	return t("days_ago", { count: days });
}

export default function Guests({ loaderData }: Route.ComponentProps) {
	const { guests, program, q, sort } = loaderData;
	const { t, place } = useShell();
	const [, setParams] = useSearchParams();
	const [text, setText] = useState(q);
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const now = Date.now();
	const regulars = guests.filter((g) => g.visitCount >= 3).length;
	const active30 = guests.filter(
		(g) => g.lastVisitAt && now - Date.parse(g.lastVisitAt) < 30 * 86_400_000,
	).length;
	const outstanding = guests.reduce((a, g) => a + g.points, 0);

	const go = (next: { q?: string; sort?: Sort }) =>
		setParams(
			(p) => {
				const qq = next.q ?? q;
				const ss = next.sort ?? sort;
				if (qq) p.set("q", qq);
				else p.delete("q");
				if (ss !== "recent") p.set("sort", ss);
				else p.delete("sort");
				return p;
			},
			{ replace: true },
		);

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("guests_title")}</h1>
					<p className="muted small page-sub">{t("guests_hint")}</p>
				</div>
				<div className="actions-row">
					<Link className="btn" to="/loyalty">
						<Icon name="star" />
						{program.enabled ? t("loyalty_title") : t("loyalty_turn_on")}
					</Link>
				</div>
			</div>

			<section className="stats stats--kpi">
				<div className="card stat">
					<span className="muted small">{t("guests_known")}</span>
					<strong>
						<bdi dir="ltr">{guests.length}</bdi>
					</strong>
				</div>
				<div className="card stat">
					<span className="muted small">{t("guests_regulars")}</span>
					<strong>
						<bdi dir="ltr">{regulars}</bdi>
					</strong>
					<span className="muted small">{t("guests_regulars_hint")}</span>
				</div>
				<div className="card stat">
					<span className="muted small">{t("guests_active_30")}</span>
					<strong>
						<bdi dir="ltr">{active30}</bdi>
					</strong>
				</div>
				<div className="card stat">
					<span className="muted small">{t("points_outstanding")}</span>
					<strong>
						<bdi dir="ltr">{outstanding.toLocaleString("en")}</bdi>
					</strong>
				</div>
			</section>

			<div className="toolbar">
				<form
					className="search-field"
					onSubmit={(e) => {
						e.preventDefault();
						go({ q: text.trim() });
					}}
				>
					<Icon name="search" />
					<span className="sr-only">{t("guests_search")}</span>
					<input
						type="search"
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							if (!e.target.value) go({ q: "" });
						}}
						placeholder={t("guests_search")}
					/>
				</form>
				<fieldset className="seg seg--set">
					<legend className="sr-only">{t("sort_by")}</legend>
					{SORTS.map((s) => (
						<button
							key={s}
							type="button"
							className="seg__btn"
							aria-pressed={sort === s}
							onClick={() => go({ sort: s })}
						>
							{t(`guests_sort_${s}`)}
						</button>
					))}
				</fieldset>
			</div>

			<section className="card card--flush">
				{guests.length === 0 ? (
					<p className="empty">
						{q ? t("guests_none_match") : t("guests_none")}
					</p>
				) : (
					<ul className="people">
						{guests.map((g) => (
							<GuestRow
								key={g.id}
								g={g}
								now={now}
								money={(n) => `${toDecimal(n, decimals)} ${currency}`}
								showPoints={program.enabled}
							/>
						))}
					</ul>
				)}
			</section>
		</>
	);
}

function GuestRow({
	g,
	now,
	money,
	showPoints,
}: {
	g: AdminCustomer;
	now: number;
	money: (n: number) => string;
	showPoints: boolean;
}) {
	const { t } = useShell();
	return (
		<li>
			<Link to={`/guests/${g.id}`} className="person">
				<span className="avatar gx-avatar" aria-hidden="true">
					{initials(g.name ?? "?")}
				</span>
				<span className="person__main">
					<span className="person__name">
						{g.name ?? t("guest_no_name")}
						{g.visitCount >= 10 && (
							<span className="gx-regular">{t("regular")}</span>
						)}
					</span>
					<span className="muted small" dir="ltr">
						{g.phone}
					</span>
				</span>
				<span className="person__roles gx-facts">
					<span>
						<strong>
							<bdi dir="ltr">{g.visitCount}</bdi>
						</strong>{" "}
						<span className="muted small">{t("visits")}</span>
					</span>
					<span>
						<strong>
							<bdi dir="ltr">{money(g.totalSpent)}</bdi>
						</strong>
					</span>
					{showPoints && (
						<span className="gx-pts">
							<bdi dir="ltr">{g.points}</bdi> {t("pts")}
						</span>
					)}
				</span>
				<span className="person__signin muted small">
					{sinceLabel(g.lastVisitAt, now, t)}
				</span>
				<Icon name="chevron-forward" className="person__chev" />
			</Link>
		</li>
	);
}
