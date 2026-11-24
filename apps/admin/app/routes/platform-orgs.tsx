import type { PlatformOrgRow } from "@bite/contracts";
import { Badge, type BadgeTone, Money } from "@bite/ui";
import { Form, Link, useNavigation, useSubmit } from "react-router";
import { ago, daysUntil, platform } from "../lib/platform";
import type { PT } from "../lib/platform-i18n";
import type { Route } from "./+types/platform-orgs";
import { usePlatform } from "./platform";

const OMR = { code: "OMR", decimals: 3 } as const;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const api = platform();
	if (!api) throw new Response("no api", { status: 404 });
	const q = new URL(request.url).searchParams;
	const status = q.get("status") ?? "";
	const plan = q.get("plan") ?? "";
	const query = {
		q: q.get("q") ?? "",
		status: (["trial", "active", "suspended"].includes(status)
			? status
			: undefined) as PlatformOrgRow["status"] | undefined,
		plan: (["free", "essentials", "pro"].includes(plan) ? plan : undefined) as
			| PlatformOrgRow["plan"]
			| undefined,
	};
	return { list: await api.orgs(query), query };
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

export default function PlatformOrgs({ loaderData }: Route.ComponentProps) {
	const { t } = usePlatform();
	const { list, query } = loaderData;
	const { totals } = list;
	const submit = useSubmit();
	const busy = useNavigation().state === "loading";
	return (
		<>
			<div className="page-head">
				<h1>{t("businesses")}</h1>
				<div className="actions-row">
					<Link className="btn btn--primary" to="/platform/new">
						{t("new_business")}
					</Link>
				</div>
			</div>

			<section className="pf-kpis">
				<Kpi label={t("total_businesses")} value={totals.orgs}>
					<span>
						{t("on_trial")} {totals.byStatus.trial ?? 0} ·{" "}
						{t("suspended_count")} {totals.byStatus.suspended ?? 0}
					</span>
				</Kpi>
				<Kpi
					label={t("paying")}
					value={(totals.byPlan.essentials ?? 0) + (totals.byPlan.pro ?? 0)}
				>
					<span>
						{t("plan_essentials")} {totals.byPlan.essentials ?? 0} ·{" "}
						{t("plan_pro")} {totals.byPlan.pro ?? 0}
					</span>
				</Kpi>
				<Kpi label={t("total_branches")} value={totals.locations} />
				<Kpi label={t("orders_today")} value={totals.ordersToday} />
				<Kpi label={t("orders_30d")} value={totals.orders30d} />
				<Kpi
					label={t("sales_30d")}
					value={<Money amount={totals.sales30d} currency={OMR} />}
				/>
			</section>

			{!list.planEnforcement && (
				<p className="pf-note small">{t("enforcement_off")}</p>
			)}

			<Form
				className="pf-filters"
				role="search"
				onChange={(e) => submit(e.currentTarget, { replace: true })}
			>
				<input
					className="input"
					type="search"
					name="q"
					defaultValue={query.q}
					placeholder={t("search")}
					aria-label={t("search")}
				/>
				<select
					className="input"
					name="status"
					defaultValue={query.status ?? ""}
					aria-label={t("status")}
				>
					<option value="">{t("all_statuses")}</option>
					<option value="trial">{t("status_trial")}</option>
					<option value="active">{t("status_active")}</option>
					<option value="suspended">{t("status_suspended")}</option>
				</select>
				<select
					className="input"
					name="plan"
					defaultValue={query.plan ?? ""}
					aria-label={t("plan")}
				>
					<option value="">{t("all_plans")}</option>
					<option value="free">{t("plan_free")}</option>
					<option value="essentials">{t("plan_essentials")}</option>
					<option value="pro">{t("plan_pro")}</option>
				</select>
			</Form>

			<section className={`card table-wrap${busy ? " pf-busy" : ""}`}>
				<table className="table pf-table">
					<thead>
						<tr>
							<th>{t("business")}</th>
							<th>{t("status")}</th>
							<th>{t("plan")}</th>
							<th className="num">{t("branches")}</th>
							<th className="num">{t("orders_30d")}</th>
							<th className="num">{t("sales_30d")}</th>
							<th>{t("last_order")}</th>
						</tr>
					</thead>
					<tbody>
						{list.items.map((r) => (
							<tr
								key={r.id}
								className={r.status === "suspended" ? "row-muted" : ""}
							>
								<td>
									<Link className="pf-org" to={`/platform/orgs/${r.id}`}>
										{r.name}
									</Link>
									<div className="muted small" dir="ltr">
										{r.ownerEmail ?? r.slug}
									</div>
								</td>
								<td>
									<StatusBadge row={r} t={t} />
									{trialNote(r, t) && (
										<div className="muted small">{trialNote(r, t)}</div>
									)}
								</td>
								<td>
									<Badge tone={PLAN_TONE[r.plan]}>{t(`plan_${r.plan}`)}</Badge>
								</td>
								<td className="num">{r.locationCount}</td>
								<td className="num">{r.usage.orders30d}</td>
								<td className="num">
									<Money amount={r.usage.sales30d} currency={OMR} />
								</td>
								<td className="small">
									{ago(r.usage.lastOrderAt) ?? (
										<span className="muted">{t("no_orders")}</span>
									)}
								</td>
							</tr>
						))}
						{list.items.length === 0 && (
							<tr>
								<td colSpan={7} className="muted">
									{t("none_match")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</>
	);
}

function Kpi({
	label,
	value,
	children,
}: {
	label: string;
	value: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<div className="card pf-kpi">
			<span className="muted small">{label}</span>
			<strong>{value}</strong>
			{children && <span className="muted small">{children}</span>}
		</div>
	);
}
