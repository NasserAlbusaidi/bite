import { Icon } from "@bite/ui";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Roles, SignIn } from "../components/StaffBadges";
import { adminApi } from "../lib/api";
import {
	filterStaff,
	initials,
	isOffice,
	STAFF_FILTERS,
	type StaffFilter,
	staffCounts,
} from "../lib/staff-list";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/staff";

export async function clientLoader() {
	return { staff: await adminApi().staff() };
}

export default function StaffPage({ loaderData }: Route.ComponentProps) {
	const { t, places, place, locationId } = useShell();
	const [params, setParams] = useSearchParams();
	const filter = (
		STAFF_FILTERS.includes(params.get("show") as StaffFilter)
			? params.get("show")
			: "all"
	) as StaffFilter;
	const [q, setQ] = useState("");
	const counts = staffCounts(loaderData.staff, locationId);
	const list = filterStaff(loaderData.staff, { q, filter, locationId });
	const names = new Map(places.map((p) => [p.id, p.name]));

	const chips = STAFF_FILTERS.filter(
		(f) =>
			f === "all" ||
			(f === "branch" && places.length > 1) ||
			(f !== "branch" && counts[f] > 0),
	);

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("staff")}</h1>
					<p className="muted small page-sub">{t("staff_hint")}</p>
				</div>
				<Link className="btn btn--primary" to="/staff/new">
					<Icon name="plus" />
					{t("ap_title")}
				</Link>
			</div>

			<div className="toolbar">
				<label className="search-field">
					<Icon name="search" />
					<span className="sr-only">{t("staff_search")}</span>
					<input
						type="search"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder={t("staff_search")}
					/>
				</label>
				<fieldset className="seg seg--set">
					<legend className="sr-only">{t("staff")}</legend>
					{chips.map((f) => (
						<button
							key={f}
							type="button"
							className="seg__btn"
							aria-pressed={filter === f}
							onClick={() =>
								setParams(
									(p) => {
										if (f === "all") p.delete("show");
										else p.set("show", f);
										return p;
									},
									{ replace: true },
								)
							}
						>
							{t(`staff_filter_${f}`, { branch: place?.name ?? "" })}
							<span className="seg__count">{counts[f]}</span>
						</button>
					))}
				</fieldset>
			</div>

			<section className="card card--flush">
				{list.length === 0 ? (
					<p className="empty">{t("staff_none_match")}</p>
				) : (
					<ul className="people">
						{list.map((s) => (
							<li key={s.id}>
								<Link to={`/staff/${s.id}`} className="person">
									<span
										className={`avatar avatar--${isOffice(s) ? "office" : "floor"}`}
										aria-hidden="true"
									>
										{initials(s.displayName)}
									</span>
									<span className="person__main">
										<span className="person__name">{s.displayName}</span>
										{s.email && (
											<span className="muted small" dir="ltr">
												{s.email}
											</span>
										)}
									</span>
									<span className="person__roles">
										<Roles s={s} names={names} current={locationId} t={t} />
									</span>
									<span className="person__signin">
										<SignIn s={s} t={t} />
									</span>
									<Icon name="chevron-forward" className="person__chev" />
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			<details className="card guide">
				<summary>
					<Icon name="info" />
					{t("roles_guide_title")}
				</summary>
				<dl className="guide__list">
					{(
						[
							"owner",
							"admin",
							"manager",
							"cashier",
							"server",
							"kitchen",
						] as const
					).map((r) => (
						<div key={r}>
							<dt>
								{r === "owner" || r === "admin"
									? t(`role_${r}_short`)
									: t(`role_${r}`)}
							</dt>
							<dd>{t(`role_desc_${r}`)}</dd>
						</div>
					))}
				</dl>
			</details>
		</>
	);
}
