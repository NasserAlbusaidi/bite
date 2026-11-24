import type { PlatformOrgDetail } from "@bite/contracts";
import { PLANS } from "@bite/core";
import { Badge, Icon, type IconName, Money, useToast } from "@bite/ui";
import { useEffect, useRef, useState } from "react";
import {
	Form,
	Link,
	redirect,
	useActionData,
	useNavigation,
} from "react-router";
import {
	agoText,
	Kpi,
	Monogram,
	PulseLabel,
	ShareBar,
} from "../components/platform-ui";
import { saveOrg } from "../lib/account";
import { AdminApiError } from "../lib/api-types";
import { platform } from "../lib/platform";
import type { PlatformKey } from "../lib/platform-i18n";
import type { Route } from "./+types/platform-org";
import { usePlatform } from "./platform";
import { PLAN_TONE, StatusBadge, trialNote } from "./platform-orgs";

const OMR = { code: "OMR", decimals: 3 } as const;
const PLAN_IDS = ["free", "essentials", "pro"] as const;

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
			const plan = String(f.get("plan")) as (typeof PLAN_IDS)[number];
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

const ACTION_ICON: Record<string, IconName> = {
	"platform.support_view": "eye",
	"platform.status_changed": "alert",
	"platform.plan_set": "tag",
	"platform.trial_set": "clock",
	"platform.org_created": "plus",
};

export default function PlatformOrg({ loaderData }: Route.ComponentProps) {
	const { t, lang } = usePlatform();
	const { org } = loaderData;
	const result = useActionData<typeof clientAction>();
	const toast = useToast();
	const busy = useNavigation().state !== "idle";
	const [confirming, setConfirming] = useState(false);
	const [plan, setPlan] = useState(org.plan);
	useEffect(() => setPlan(org.plan), [org.plan]);
	const shown = useRef<unknown>(null);
	useEffect(() => {
		if (!result || shown.current === result) return;
		shown.current = result;
		if ("ok" in result) {
			toast(t("saved"), "success");
			setConfirming(false);
		} else toast(t("error"), "danger");
	}, [result, toast, t]);

	const locale = lang === "ar" ? "ar-OM" : "en-GB";
	const date = (iso: string) =>
		new Date(iso).toLocaleDateString(locale, {
			day: "numeric",
			month: "short",
			year: "numeric",
		});
	const when = (iso: string) =>
		new Date(iso).toLocaleString(locale, {
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
	const suspended = org.status === "suspended";
	const trialRunning =
		org.trialEndsAt !== null && new Date(org.trialEndsAt) > new Date();
	const actionLabel = (a: string) => {
		const k = `act_${a.replaceAll(".", "_")}` as PlatformKey;
		return ACTION_ICON[a] ? t(k) : a;
	};
	const logins = org.members.filter((m) => m.orgRole !== "staff" || m.hasLogin);
	const price = (id: (typeof PLAN_IDS)[number]) => PLANS[id].monthlyPrice;

	return (
		<>
			<Link className="pf-back" to="/platform">
				<Icon name="arrow-back" />
				{t("back_to_list")}
			</Link>

			<header className={`pf-hero${suspended ? " pf-hero--off" : ""}`}>
				<Monogram id={org.id} name={org.name} size="lg" />
				<div className="pf-hero__text">
					<h1>{org.name}</h1>
					<p className="pf-hero__meta">
						<StatusBadge row={org} t={t} />
						<Badge tone={PLAN_TONE[org.plan]}>{t(`plan_${org.plan}`)}</Badge>
						<span dir="ltr">{org.slug}</span>
						<span>
							{t("created")} {date(org.createdAt)}
						</span>
						{trialNote(org, t) && <span>{trialNote(org, t)}</span>}
					</p>
				</div>
				<div className="pf-hero__actions">
					<Form method="post">
						<input type="hidden" name="intent" value="support" />
						<button
							type="submit"
							className="btn btn--primary pf-btn-icon"
							title={t("open_back_office_hint")}
							disabled={suspended}
						>
							<Icon name="eye" />
							{t("open_back_office")}
						</button>
					</Form>
					{suspended ? (
						<Form method="post">
							<input type="hidden" name="intent" value="status" />
							<input
								type="hidden"
								name="status"
								value={trialRunning ? "trial" : "active"}
							/>
							<button type="submit" className="btn pf-btn-icon" disabled={busy}>
								<Icon name="refresh" />
								{t("reactivate")}
							</button>
						</Form>
					) : (
						<button
							type="button"
							className="btn pf-btn-danger"
							onClick={() => setConfirming(true)}
						>
							{t("suspend")}
						</button>
					)}
				</div>
			</header>

			{confirming && !suspended && (
				<Form method="post" className="pf-confirm">
					<input type="hidden" name="intent" value="status" />
					<input type="hidden" name="status" value="suspended" />
					<Icon name="alert" />
					<div className="pf-confirm__body">
						<p>{t("suspend_confirm", { name: org.name })}</p>
						<label className="pf-field">
							<span>{t("suspend_note")}</span>
							<input className="input" name="note" maxLength={200} />
						</label>
						<div className="form-actions">
							<button type="submit" className="btn btn--danger" disabled={busy}>
								{t("suspend")}
							</button>
							<button
								type="button"
								className="btn"
								aria-label="✕"
								onClick={() => setConfirming(false)}
							>
								<Icon name="close" />
							</button>
						</div>
					</div>
				</Form>
			)}

			<section className="pf-kpis">
				<Kpi
					icon="receipt"
					label={t("orders_today")}
					value={org.usage.ordersToday}
				>
					<PulseLabel t={t} lastOrderAt={org.usage.lastOrderAt} />
				</Kpi>
				<Kpi icon="chart" label={t("orders_30d")} value={org.usage.orders30d} />
				<Kpi
					icon="cash"
					label={t("sales_30d")}
					value={<Money amount={org.usage.sales30d} currency={OMR} />}
				/>
				<Kpi icon="tablet" label={t("devices")} value={org.usage.devices}>
					{t("branches")}: {org.locationCount} · {t("people")}:{" "}
					{org.memberCount}
				</Kpi>
			</section>

			<div className="pf-grid">
				<section className="pf-panel pf-plan">
					<div className="pf-panel__head">
						<h2>{t("plan_card")}</h2>
						<span className="muted small">
							{t(`plan_source_${org.planSource}` as PlatformKey)}
							{org.entitlements.paidUntil && (
								<> · {date(org.entitlements.paidUntil)}</>
							)}
						</span>
					</div>
					<Form method="post" className="pf-plan__form">
						<input type="hidden" name="intent" value="plan" />
						<fieldset className="pf-tiles">
							<legend className="sr-only">{t("plan")}</legend>
							{PLAN_IDS.map((id) => (
								<label
									key={id}
									className={`pf-tile${plan === id ? " is-on" : ""}`}
								>
									<input
										type="radio"
										name="plan"
										value={id}
										checked={plan === id}
										onChange={() => setPlan(id)}
									/>
									<span className="pf-tile__name">
										{t(`plan_${id}`)}
										{org.plan === id && (
											<span className="pf-tile__now">{t("current_plan")}</span>
										)}
									</span>
									<span className="pf-tile__price">
										{price(id) > 0 ? (
											t("per_branch_month", {
												price: `${(price(id) / 1000).toFixed(3)} OMR`,
											})
										) : (
											<>&nbsp;</>
										)}
									</span>
								</label>
							))}
						</fieldset>
						<div className="pf-inline">
							<label className="pf-field">
								<span>{t("plan_until")}</span>
								<input className="input" type="date" name="until" />
							</label>
							<button
								type="submit"
								className="btn btn--primary"
								disabled={busy || plan === org.plan}
							>
								{t("set_plan")}
							</button>
						</div>
					</Form>

					<div className="pf-divider" />
					<h3 className="pf-sub">
						<Icon name="clock" />
						{t("trial_card")}
						{trialRunning && org.trialEndsAt && (
							<span className="muted small">
								{t("trial_until", { date: date(org.trialEndsAt) })}
							</span>
						)}
					</h3>
					<div className="pf-inline">
						<span className="small muted">{t("trial_quick")}</span>
						{[7, 14, 30].map((d) => (
							<Form method="post" key={d}>
								<input type="hidden" name="intent" value="trial" />
								<input type="hidden" name="days" value={d} />
								<button type="submit" className="pf-chip" disabled={busy}>
									{d} {t("days")}
								</button>
							</Form>
						))}
					</div>
				</section>

				<section className="pf-panel">
					<div className="pf-panel__head">
						<h2>{t("branches")}</h2>
						<span className="muted small">{t("last_30d")}</span>
					</div>
					<ul className="pf-list">
						{org.locations.map((l) => (
							<li key={l.id} className={l.isActive ? "" : "row-muted"}>
								<div className="pf-list__main">
									<span className="pf-list__title">
										<Icon name="store" />
										{l.name}
										{l.ordersPausedUntil &&
											new Date(l.ordersPausedUntil) > new Date() && (
												<Badge tone="warning">{t("paused")}</Badge>
											)}
									</span>
									<span className="pf-who__sub" dir="ltr">
										/{l.slug}
									</span>
									{org.usage.sales30d > 0 && (
										<ShareBar share={l.usage.sales30d / org.usage.sales30d} />
									)}
								</div>
								<div className="pf-list__nums">
									<span>
										<strong>
											<Money amount={l.usage.sales30d} currency={OMR} />
										</strong>
										<small>
											{l.usage.orders30d} {t("orders_short")} ·{" "}
											{l.usage.devices} {t("devices")}
										</small>
									</span>
									<PulseLabel t={t} lastOrderAt={l.usage.lastOrderAt} />
								</div>
							</li>
						))}
					</ul>
				</section>

				<section className="pf-panel">
					<div className="pf-panel__head">
						<h2>{t("people_logins")}</h2>
						<span className="muted small">{logins.length}</span>
					</div>
					{logins.length === 0 ? (
						<p className="muted small">{t("no_people")}</p>
					) : (
						<ul className="pf-list">
							{logins.map((m) => (
								<li key={m.id} className={m.isActive ? "" : "row-muted"}>
									<span className="pf-who">
										<Monogram id={m.id} name={m.displayName} size="sm" />
										<span>
											<strong>{m.displayName}</strong>
											{m.email && (
												<span className="pf-who__sub" dir="ltr">
													{m.email}
												</span>
											)}
										</span>
									</span>
									<span className="pf-person-tags">
										<Badge tone={m.orgRole === "owner" ? "brand" : "neutral"}>
											{t(`role_${m.orgRole}`)}
										</Badge>
										<span className="small muted">
											{!m.isActive
												? t("inactive")
												: m.hasLogin
													? t("login")
													: m.email
														? t("invite_pending")
														: t("pin_only")}
										</span>
									</span>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="pf-panel">
					<div className="pf-panel__head">
						<h2>{t("activity")}</h2>
					</div>
					{org.activity.length === 0 ? (
						<p className="muted small">{t("no_activity")}</p>
					) : (
						<ol className="pf-timeline">
							{collapse(org.activity).map(({ a, n }) => (
								<li key={a.id}>
									<span className="pf-timeline__icon">
										<Icon name={ACTION_ICON[a.action] ?? "info"} />
									</span>
									<span className="pf-timeline__body">
										<span>
											{actionLabel(a.action)}
											{describe(a.data)}
											{n > 1 && (
												<span className="pf-timeline__count">×{n}</span>
											)}
										</span>
										<span className="pf-who__sub">
											<span title={when(a.createdAt)}>
												{agoText(t, a.createdAt)}
											</span>
											{typeof a.data?.by === "string" && (
												<span dir="ltr"> · {a.data.by}</span>
											)}
										</span>
									</span>
								</li>
							))}
						</ol>
					)}
					<h3 className="pf-sub">
						<Icon name="receipt" />
						{t("billing")}
					</h3>
					{org.subscriptions.length === 0 ? (
						<p className="muted small">{t("no_billing")}</p>
					) : (
						<ul className="pf-list pf-list--tight">
							{org.subscriptions.map((s) => (
								<li key={s.id}>
									<span>
										<strong>{s.plan}</strong>{" "}
										<span className="muted small">
											{s.provider} · {s.status}
										</span>
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

type Act = PlatformOrgDetail["activity"][number];

/** Back-to-back entries of the same action by the same person show once, ×n. */
function collapse(list: Act[]): { a: Act; n: number }[] {
	const out: { a: Act; n: number }[] = [];
	for (const a of list) {
		const prev = out.at(-1);
		const same =
			prev &&
			prev.a.action === a.action &&
			prev.a.data?.by === a.data?.by &&
			describe(prev.a.data) === describe(a.data);
		if (same) prev.n++;
		else out.push({ a, n: 1 });
	}
	return out;
}

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
