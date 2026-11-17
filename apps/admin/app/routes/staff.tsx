import { Link } from "react-router";
import { adminApi } from "../lib/api";
import { staffPowers } from "../lib/permissions";
import { rolesSummary } from "../lib/staff-form";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/staff";

export async function clientLoader() {
	return { staff: await adminApi().staff() };
}

export default function StaffPage({ loaderData }: Route.ComponentProps) {
	const { t, lang, places, me } = useShell();
	const powers = staffPowers(me);
	const names = new Map(places.map((p) => [p.id, p.name]));
	const sep = lang === "ar" ? "، " : ", ";
	const sorted = [...loaderData.staff].sort(
		(a, b) =>
			Number(b.isActive) - Number(a.isActive) ||
			a.displayName.localeCompare(b.displayName),
	);
	return (
		<>
			<div className="page-head">
				<h1>{t("staff")}</h1>
				<div className="actions-row">
					{powers.canInvite && (
						<Link className="btn" to="/staff/new?kind=invite">
							{t("invite_manager")}
						</Link>
					)}
					<Link className="btn btn--primary" to="/staff/new?kind=pin">
						{t("add_pin_staff")}
					</Link>
				</div>
			</div>
			<p className="muted">{t("staff_hint")}</p>
			<section className="card">
				<table className="table">
					<thead>
						<tr>
							<th>{t("name")}</th>
							<th>{t("access")}</th>
							<th>{t("sign_in")}</th>
						</tr>
					</thead>
					<tbody>
						{sorted.map((s) => (
							<tr key={s.id} className={s.isActive ? "" : "row-muted"}>
								<td>
									<Link to={`/staff/${s.id}`}>{s.displayName}</Link>
									{s.email && (
										<div className="muted small" dir="ltr">
											{s.email}
										</div>
									)}
								</td>
								<td className="small">
									{s.orgRole === "owner" || s.orgRole === "admin"
										? t(`org_${s.orgRole}`)
										: rolesSummary(
												s,
												names,
												(r) => t(`role_${r}`),
												(role, place) => t("role_at", { role, place }),
												sep,
											) || "—"}
								</td>
								<td className="small">
									{!s.isActive
										? t("deactivated")
										: [s.email ? t("login") : null, s.hasPin ? t("pin") : null]
												.filter(Boolean)
												.join(" + ") || t("invite_pending")}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>
		</>
	);
}
