import type { PlatformOrgRow } from "@bite/contracts";
import { Badge, type BadgeTone, Icon, Money } from "@bite/ui";
import {
	Form,
	Link,
	useNavigate,
	useNavigation,
	useSearchParams,
	useSubmit,
} from "react-router";
import { Kpi, Monogram, PulseLabel, ShareBar } from "../components/platform-ui";
import { daysUntil, platform } from "../lib/platform";
import type { PT } from "../lib/platform-i18n";
import type { Route } from "./+types/platform-orgs";
import { usePlatform } from "./platform";

const OMR = { code: "OMR", decimals: 3 } as const;
const STATUSES = ["trial", "active", "suspended"] as const;
const PLANS = ["free", "essentials", "pro"] as const;
const SORTS = ["newest", "sales", "orders", "recent", "name"] as const;
type Sort = (typeof SORTS)[number];

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const api = platform();
	if (!api) throw new Response("no api", { status: 404 });
	const q = new URL(request.url).searchParams;
	const pick = <T extends string>(v: string | null, ok: readonly T[]) =>
		ok.includes(v as T) ? (v as T) : undefined;
	const query = {
		q: q.get("q") ?? "",
		status: pick(q.get("status"), STATUSES),
		plan: pick(q.get("plan"), PLANS),
	};
	const sort = pick(q.get("sort"), SORTS) ?? "newest";
	// Totals and chip counts come from the unfiltered list.
	return { list: await api.orgs(query), query, sort };
}

export const STATUS_TONE: Record<PlatformOrgRow["status"], BadgeTone> = {
	trial: "warning",
	active: "success",
	suspended: "danger",
};
export const PLAN_TONE: Record<PlatformOrgRow["plan"], BadgeTone> = {
	free: "neutral",
	essentials: "brand",
	pro: "success",
};

export function StatusBadge({ row, t }: { row: PlatformOrgRow; t: PT }) {
	return (
		<Badge tone={STATUS_TONE[row.status]}>{t(`status_${row.status}`)}</Badge>
	);
}

export function trialNote(row: PlatformOrgRow, t: PT) {
	if (row.status !== "trial" || !row.trialEndsAt) return null;
	const n = daysUntil(row.trialEndsAt);
	return n > 0 ? t("trial_left", { n }) : t("trial_over");
}

function sorted(rows: PlatformOrgRow[], sort: Sort) {
	const r = [...rows];
	const last = (x: PlatformOrgRow) =>
		x.usage.lastOrderAt ? Date.parse(x.usage.lastOrderAt) : 0;
	if (sort === "sales") r.sort((a, b) => b.usage.sales30d - a.usage.sales30d);
	if (sort === "orders")
		r.sort((a, b) => b.usage.orders30d - a.usage.orders30d);
	if (sort === "recent") r.sort((a, b) => last(b) - last(a));
	if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
	return r;
}

export default function PlatformOrgs({ loaderData }: Route.ComponentProps) {
	const { t } = usePlatform();
	const { list, query, sort } = loaderData;
	const { totals } = list;
	const submit = useSubmit();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const busy = useNavigation().state === "loading";
	const rows = sorted(list.items, sort);
	const paid = (totals.byPlan.essentials ?? 0) + (totals.byPlan.pro ?? 0);

	/** Same page with one filter changed, the others kept. */
	const withParam = (key: string, value: string | undefined) => {
		const p = new URLSearchParams(params);
		if (value) p.set(key, value);
		else p.delete(key);
		const s = p.toString();
		return s ? `?${s}` : "?";
	};

	return (
		<>
			<div className="pf-head">
				<div>
					<h1>{t("businesses")}</h1>
					<p className="muted">
						{t("total_businesses")}: {totals.orgs} · {t("total_branches")}:{" "}
						{totals.locations}
					</p>
				</div>
				<Link className="btn btn--primary pf-btn-icon" to="/platform/new">
					<Icon name="plus" />
					{t("new_business")}
				</Link>
			</div>

			<section className="pf-kpis">
				<Kpi icon="store" label={t("total_businesses")} value={totals.orgs}>
					{t("on_trial")} {totals.byStatus.trial ?? 0} · {t("suspended_count")}{" "}
					{totals.byStatus.suspended ?? 0}
				</Kpi>
				<Kpi icon="tag" label={t("paying")} value={paid}>
					{t("plan_essentials")} {totals.byPlan.essentials ?? 0} ·{" "}
					{t("plan_pro")} {totals.byPlan.pro ?? 0}
				</Kpi>
				<Kpi
					icon="receipt"
					label={t("orders_today")}
					value={totals.ordersToday}
				>
					{t("orders_30d")}: {totals.orders30d}
				</Kpi>
				<Kpi
					icon="chart"
					label={t("sales_30d")}
					value={<Money amount={totals.sales30d} currency={OMR} />}
				>
					{t("total_branches")}: {totals.locations}
				</Kpi>
			</section>

			{!list.planEnforcement && (
				<p className="pf-note">
					<Icon name="info" />
					<span>{t("enforcement_off")}</span>
				</p>
			)}

			<section className="pf-panel">
				<div className="pf-toolbar">
					<Form
						className="pf-search"
						role="search"
						onChange={(e) => submit(e.currentTarget, { replace: true })}
					>
						<Icon name="search" />
						<input
							type="search"
							name="q"
							defaultValue={query.q}
							placeholder={t("search")}
							aria-label={t("search")}
						/>
						{query.status && (
							<input type="hidden" name="status" value={query.status} />
						)}
						{query.plan && (
							<input type="hidden" name="plan" value={query.plan} />
						)}
						{sort !== "newest" && (
							<input type="hidden" name="sort" value={sort} />
						)}
					</Form>
					<label className="pf-sort">
						<span>{t("sort_label")}</span>
						<select
							value={sort}
							onChange={(e) =>
								navigate(
									withParam(
										"sort",
										e.target.value === "newest" ? undefined : e.target.value,
									),
									{ replace: true },
								)
							}
						>
							{SORTS.map((s) => (
								<option key={s} value={s}>
									{t(`sort_${s}`)}
								</option>
							))}
						</select>
					</label>
				</div>
				<div className="pf-chips">
					<nav aria-label={t("status")}>
						<Link
							replace
							className={`pf-chip${query.status ? "" : " is-on"}`}
							to={withParam("status", undefined)}
						>
							{t("all")} <span>{totals.orgs}</span>
						</Link>
						{STATUSES.map((s) => (
							<Link
								replace
								key={s}
								className={`pf-chip pf-chip--${s}${query.status === s ? " is-on" : ""}`}
								to={withParam("status", query.status === s ? undefined : s)}
							>
								{t(`status_${s}`)} <span>{totals.byStatus[s] ?? 0}</span>
							</Link>
						))}
					</nav>
					<nav aria-label={t("plan")}>
						{PLANS.map((p) => (
							<Link
								replace
								key={p}
								className={`pf-chip${query.plan === p ? " is-on" : ""}`}
								to={withParam("plan", query.plan === p ? undefined : p)}
							>
								{t(`plan_${p}`)} <span>{totals.byPlan[p] ?? 0}</span>
							</Link>
						))}
					</nav>
				</div>

				<div className={`table-wrap${busy ? " pf-busy" : ""}`}>
					<table className="table pf-table">
						<thead>
							<tr>
								<th>{t("business")}</th>
								<th>{t("status")}</th>
								<th>{t("plan")}</th>
								<th className="num">{t("branches")}</th>
								<th className="num">{t("orders_short")}</th>
								<th className="num">{t("sales_short")}</th>
								<th>{t("last_order")}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr
									key={r.id}
									className={`pf-row${r.status === "suspended" ? " row-muted" : ""}`}
									onClick={(e) => {
										if ((e.target as HTMLElement).closest("a")) return;
										navigate(`/platform/orgs/${r.id}`);
									}}
								>
									<td>
										<span className="pf-who">
											<Monogram id={r.id} name={r.name} />
											<span>
												<Link className="pf-org" to={`/platform/orgs/${r.id}`}>
													{r.name}
												</Link>
												<span className="pf-who__sub" dir="ltr">
													{r.ownerEmail ?? r.slug}
												</span>
											</span>
										</span>
									</td>
									<td>
										<StatusBadge row={r} t={t} />
										{trialNote(r, t) && (
											<div className="pf-who__sub">{trialNote(r, t)}</div>
										)}
									</td>
									<td>
										<Badge tone={PLAN_TONE[r.plan]}>
											{t(`plan_${r.plan}`)}
										</Badge>
									</td>
									<td className="num">{r.locationCount}</td>
									<td className="num">{r.usage.orders30d}</td>
									<td className="num">
										<Money amount={r.usage.sales30d} currency={OMR} />
										{totals.sales30d > 0 && r.usage.sales30d > 0 && (
											<ShareBar
												share={r.usage.sales30d / totals.sales30d}
												label={t("share_of_sales", {
													pct: Math.round(
														(100 * r.usage.sales30d) / totals.sales30d,
													),
												})}
											/>
										)}
									</td>
									<td>
										<PulseLabel t={t} lastOrderAt={r.usage.lastOrderAt} />
									</td>
								</tr>
							))}
							{rows.length === 0 && (
								<tr>
									<td colSpan={7} className="pf-empty">
										<Icon name="search" />
										<span>{t("none_match")}</span>
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</section>
		</>
	);
}
