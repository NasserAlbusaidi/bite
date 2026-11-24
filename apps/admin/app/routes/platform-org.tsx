import { Badge, Money, useToast } from "@bite/ui";
import { useEffect, useRef, useState } from "react";
import {
	Form,
	Link,
	redirect,
	useActionData,
	useNavigation,
} from "react-router";
import { saveOrg } from "../lib/account";
import { AdminApiError } from "../lib/api-types";
import { ago, platform } from "../lib/platform";
import type { PlatformKey } from "../lib/platform-i18n";
import type { Route } from "./+types/platform-org";
import { usePlatform } from "./platform";
import { PLAN_TONE, StatusBadge, trialNote } from "./platform-orgs";

const OMR = { code: "OMR", decimals: 3 } as const;

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
	const api = platform();
	if (!api) throw new Response("no api", { status: 404 });
	try {
		return { org: await api.org(params.orgId) };
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 404)
			throw new Response("not found", { status: 404 });
		throw e;
	}
}

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs) {
	const api = platform();
	if (!api) return { error: true };
	const f = await request.formData();
	const intent = String(f.get("intent"));
	const id = params.orgId;
	const note = String(f.get("note") ?? "").trim() || undefined;
	try {
		if (intent === "support") {
			// The back office sends this org on every call; the API sees a
			// platform admin who isn't a member and serves it read-only.
			saveOrg(id);
			return redirect("/");
		}
		if (intent === "status") {
			const status = String(f.get("status")) as
				| "active"
				| "suspended"
				| "trial";
			await api.setStatus(id, { status, ...(note ? { note } : {}) });
		}
		if (intent === "plan") {
			const plan = String(f.get("plan")) as "free" | "essentials" | "pro";
			const until = String(f.get("until") ?? "");
			await api.setPlan(id, {
				plan,
				...(until
					? { until: new Date(`${until}T23:59:59+04:00`).toISOString() }
					: {}),
				...(note ? { note } : {}),
			});
		}
		if (intent === "trial") {
			await api.extendTrial(id, Number(f.get("days") ?? 14));
		}
		return { ok: Date.now() };
	} catch {
		return { error: true };
	}
}

export default function PlatformOrg({ loaderData }: Route.ComponentProps) {
	const { t, lang } = usePlatform();
	const { org } = loaderData;
	const result = useActionData<typeof clientAction>();
	const toast = useToast();
	const busy = useNavigation().state !== "idle";
	const [confirming, setConfirming] = useState(false);
	const shown = useRef<unknown>(null);
	useEffect(() => {
		if (!result || shown.current === result) return;
		shown.current = result;
		if ("ok" in result) {
			toast(t("saved"), "success");
			setConfirming(false);
		} else toast(t("error"), "danger");
	}, [result, toast, t]);
	const date = (iso: string) =>
		new Date(iso).toLocaleDateString(lang === "ar" ? "ar-OM" : "en-GB", {
			day: "numeric",
			month: "short",
			year: "numeric",
		});
	const when = (iso: string) =>
		new Date(iso).toLocaleString(lang === "ar" ? "ar-OM" : "en-GB", {
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
	const suspended = org.status === "suspended";
	const actionLabel = (a: string) => {
		const k = `act_${a.replaceAll(".", "_")}` as PlatformKey;
		return k in ACTION_KEYS ? t(k) : a;
	};

	return (
		<>
			<p className="small">
				<Link to="/platform">← {t("back_to_list")}</Link>
			</p>
			<div className="page-head">
				<div>
					<h1 className="pf-title">
						{org.name} <StatusBadge row={org} t={t} />
					</h1>
					<p className="muted small">
						<span dir="ltr">{org.slug}</span> · {t("created")}{" "}
						{date(org.createdAt)}
						{trialNote(org, t) && <> · {trialNote(org, t)}</>}
					</p>
				</div>
				<div className="actions-row">
					<Form method="post">
						<input type="hidden" name="intent" value="support" />
						<button
							type="submit"
							className="btn btn--primary"
							title={t("open_back_office_hint")}
							disabled={suspended}
						>
							{t("open_back_office")}
						</button>
					</Form>
					{suspended ? (
						<Form method="post">
							<input type="hidden" name="intent" value="status" />
							<input
								type="hidden"
								name="status"
								value={
									org.trialEndsAt && new Date(org.trialEndsAt) > new Date()
										? "trial"
										: "active"
								}
							/>
							<button type="submit" className="btn" disabled={busy}>
								{t("reactivate")}
							</button>
						</Form>
					) : (
						<button
							type="button"
							className="btn btn--danger"
							onClick={() => setConfirming(true)}
						>
							{t("suspend")}
						</button>
					)}
				</div>
			</div>

			{confirming && !suspended && (
				<Form method="post" className="card warn pf-confirm">
					<input type="hidden" name="intent" value="status" />
					<input type="hidden" name="status" value="suspended" />
					<p>{t("suspend_confirm", { name: org.name })}</p>
					<label className="pf-field">
						<span className="small">{t("suspend_note")}</span>
						<input className="input" name="note" maxLength={200} />
					</label>
					<div className="form-actions">
						<button type="submit" className="btn btn--danger" disabled={busy}>
							{t("suspend")}
						</button>
						<button
							type="button"
							className="btn"
							onClick={() => setConfirming(false)}
						>
							✕
						</button>
					</div>
				</Form>
			)}

			<section className="pf-kpis">
				<div className="card pf-kpi">
					<span className="muted small">{t("orders_today")}</span>
					<strong>{org.usage.ordersToday}</strong>
				</div>
				<div className="card pf-kpi">
					<span className="muted small">{t("orders_30d")}</span>
					<strong>{org.usage.orders30d}</strong>
				</div>
				<div className="card pf-kpi">
					<span className="muted small">{t("sales_30d")}</span>
					<strong>
						<Money amount={org.usage.sales30d} currency={OMR} />
					</strong>
				</div>
				<div className="card pf-kpi">
					<span className="muted small">{t("devices")}</span>
					<strong>{org.usage.devices}</strong>
				</div>
				<div className="card pf-kpi">
					<span className="muted small">{t("people")}</span>
					<strong>{org.memberCount}</strong>
				</div>
			</section>

			<div className="pf-grid">
				<section className="card pf-plan">
					<div className="card-head">
						<h2>{t("plan_card")}</h2>
						<Badge tone={PLAN_TONE[org.plan]}>{t(`plan_${org.plan}`)}</Badge>
					</div>
					<p className="muted small">
						{t(`plan_source_${org.planSource}` as PlatformKey)}
						{org.entitlements.paidUntil && (
							<> · {date(org.entitlements.paidUntil)}</>
						)}
					</p>
					<Form method="post" className="pf-inline">
						<input type="hidden" name="intent" value="plan" />
						<select
							className="input"
							name="plan"
							defaultValue={org.plan}
							aria-label={t("plan")}
						>
							<option value="free">{t("plan_free")}</option>
							<option value="essentials">{t("plan_essentials")}</option>
							<option value="pro">{t("plan_pro")}</option>
						</select>
						<input
							className="input"
							type="date"
							name="until"
							aria-label={t("plan_until")}
							title={t("plan_until")}
						/>
						<button type="submit" className="btn" disabled={busy}>
							{t("set_plan")}
						</button>
					</Form>
					<h3 className="pf-sub">{t("trial_card")}</h3>
					<Form method="post" className="pf-inline">
						<input type="hidden" name="intent" value="trial" />
						<span className="small">{t("extend_trial")}</span>
						<input
							className="input input--short"
							type="number"
							name="days"
							min={1}
							max={365}
							defaultValue={14}
							aria-label={t("days")}
						/>
						<span className="small">{t("days")}</span>
						<button type="submit" className="btn" disabled={busy}>
							{t("apply")}
						</button>
					</Form>
				</section>

				<section className="card">
					<div className="card-head">
						<h2>{t("branches")}</h2>
						<span className="muted small">{t("last_30d")}</span>
					</div>
					<table className="table">
						<thead>
							<tr>
								<th>{t("branch")}</th>
								<th className="num">{t("orders_short")}</th>
								<th className="num">{t("sales_short")}</th>
								<th className="num">{t("devices")}</th>
								<th>{t("last_order")}</th>
							</tr>
						</thead>
						<tbody>
							{org.locations.map((l) => (
								<tr key={l.id} className={l.isActive ? "" : "row-muted"}>
									<td>
										{l.name}
										<div className="muted small" dir="ltr">
											/{l.slug}
										</div>
										{l.ordersPausedUntil &&
											new Date(l.ordersPausedUntil) > new Date() && (
												<Badge tone="warning">{t("paused")}</Badge>
											)}
									</td>
									<td className="num">{l.usage.orders30d}</td>
									<td className="num">
										<Money amount={l.usage.sales30d} currency={OMR} />
									</td>
									<td className="num">{l.usage.devices}</td>
									<td className="small">
										{ago(l.usage.lastOrderAt) ?? (
											<span className="muted">{t("no_orders")}</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>

				<section className="card">
					<div className="card-head">
						<h2>{t("people")}</h2>
					</div>
					<ul className="plain-list pf-people">
						{org.members
							.filter((m) => m.orgRole !== "staff" || m.hasLogin)
							.map((m) => (
								<li key={m.id} className={m.isActive ? "" : "row-muted"}>
									<span>
										<strong>{m.displayName}</strong>
										{m.email && (
											<span className="muted small" dir="ltr">
												{" "}
												{m.email}
											</span>
										)}
									</span>
									<span className="small muted">
										{t(`role_${m.orgRole}`)} ·{" "}
										{!m.isActive
											? t("inactive")
											: m.hasLogin
												? t("login")
												: m.email
													? t("invite_pending")
													: t("pin_only")}
									</span>
								</li>
							))}
					</ul>
				</section>

				<section className="card">
					<div className="card-head">
						<h2>{t("activity")}</h2>
					</div>
					{org.activity.length === 0 ? (
						<p className="muted small">{t("no_activity")}</p>
					) : (
						<ul className="plain-list pf-activity">
							{org.activity.map((a) => (
								<li key={a.id}>
									<span>
										{actionLabel(a.action)}
										{describe(a.data)}
									</span>
									<span className="muted small">
										{when(a.createdAt)}
										{typeof a.data?.by === "string" && (
											<span dir="ltr"> · {a.data.by}</span>
										)}
									</span>
								</li>
							))}
						</ul>
					)}
					<h3 className="pf-sub">{t("billing")}</h3>
					{org.subscriptions.length === 0 ? (
						<p className="muted small">{t("no_billing")}</p>
					) : (
						<ul className="plain-list pf-activity">
							{org.subscriptions.map((s) => (
								<li key={s.id}>
									<span>
										{s.plan} · {s.provider} · {s.status}
									</span>
									<span className="muted small">
										{date(s.createdAt)}
										{s.currentPeriodEnd && <> → {date(s.currentPeriodEnd)}</>}
									</span>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</>
	);
}

const ACTION_KEYS = {
	act_platform_support_view: 1,
	act_platform_status_changed: 1,
	act_platform_plan_set: 1,
	act_platform_trial_set: 1,
	act_platform_org_created: 1,
};

/** ": suspended → active", ": pro", "(unpaid)" */
function describe(d: Record<string, unknown> | null): string {
	if (!d) return "";
	const parts: string[] = [];
	if (typeof d.from === "string" && typeof d.to === "string")
		parts.push(`${d.from} → ${d.to}`);
	if (typeof d.plan === "string") parts.push(d.plan);
	if (typeof d.days === "number") parts.push(`${d.days}d`);
	if (typeof d.note === "string") parts.push(`“${d.note}”`);
	return parts.length ? `: ${parts.join(" · ")}` : "";
}
