import { useState } from "react";
import { data, Form, useFetcher, useNavigation } from "react-router";
import { adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import type { AdminDevice } from "../lib/contracts";
import type { MessageKey } from "../lib/i18n";
import {
	locationFormDefaults,
	parseLocationForm,
	pausedUntil,
	TICKET_PREFIX,
	WEEK,
} from "../lib/location-form";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/location-settings";

type Errors = Record<
	string,
	{ key: MessageKey; params?: Record<string, string | number> }
>;

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
	const api = adminApi();
	const [locations, devices] = await Promise.all([
		api.locations(),
		api.devices(params.locationId),
	]);
	const location = locations.find((l) => l.id === params.locationId);
	if (!location) throw data(null, { status: 404 });
	return { location, devices };
}

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs) {
	const form = await request.formData();
	const api = adminApi();
	const id = params.locationId;
	const intent = String(form.get("intent") ?? "save");

	if (intent === "pause") {
		const raw = String(form.get("minutes") ?? "");
		const minutes = raw === "resume" ? null : Number.parseInt(raw, 10);
		if (minutes !== null && !(minutes > 0 && minutes <= 24 * 60))
			return { intent, errors: {} as Errors };
		await api.updateLocation(id, { ordersPausedUntil: pausedUntil(minutes) });
		return { intent, ok: true };
	}
	if (intent === "register") {
		const name = String(form.get("name") ?? "").trim();
		const kind = String(form.get("kind") ?? "");
		const ticketPrefix = String(form.get("ticketPrefix") ?? "")
			.trim()
			.toUpperCase();
		const errors: Errors = {};
		if (!name || name.length > 80)
			errors.deviceName = { key: "required_field" };
		if (!TICKET_PREFIX.test(ticketPrefix))
			errors.ticketPrefix = { key: "invalid_prefix" };
		if (kind !== "pos" && kind !== "kds" && kind !== "kiosk")
			errors.kind = { key: "required_field" };
		if (Object.keys(errors).length > 0) return { intent, errors };
		try {
			const r = await api.registerDevice({
				locationId: id,
				name,
				kind: kind as AdminDevice["kind"],
				ticketPrefix,
			});
			return { intent, token: r.token, deviceName: name };
		} catch (e) {
			if (e instanceof AdminApiError && e.status === 409)
				return {
					intent,
					errors: { ticketPrefix: { key: "prefix_taken" } } as Errors,
				};
			throw e;
		}
	}
	if (intent === "revoke") {
		await api.revokeDevice(String(form.get("deviceId") ?? ""));
		return { intent, ok: true };
	}

	const [current, me] = await Promise.all([
		api.locations().then((ls) => ls.find((l) => l.id === id)),
		api.me(),
	]);
	if (!current) throw data(null, { status: 404 });
	const parsed = parseLocationForm(
		form,
		current,
		me.member.orgRole === "staff",
	);
	if (!parsed.ok) return { intent, errors: parsed.errors as Errors };
	await api.updateLocation(id, parsed.value);
	return { intent, saved: true };
}

export default function LocationSettings({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { location, devices } = loaderData;
	const { t, me } = useShell();
	// Managers can't change name, tax or the day cutoff (the API returns 403).
	const locked = me.member.orgRole === "staff";
	const nav = useNavigation();
	const busy = nav.state !== "idle";
	const d = locationFormDefaults(location);
	const errors: Errors =
		actionData?.intent === "save" && "errors" in actionData
			? (actionData.errors ?? {})
			: {};
	const saved = actionData?.intent === "save" && "saved" in actionData;
	const err = (k: string) => {
		const e = errors[k];
		return e ? (
			<span className="error small" role="alert">
				{t(e.key, e.params)}
			</span>
		) : null;
	};

	return (
		<>
			<div className="page-head">
				<h1>{t("location_settings", { location: location.name })}</h1>
			</div>
			<PauseCard until={location.ordersPausedUntil} />
			<Form method="post" className="card form" key={location.id}>
				<h2>{t("details")}</h2>
				<div className="grid2">
					<label>
						{t("name")}
						<input
							name="name"
							className="input"
							defaultValue={d.name}
							required
							disabled={locked}
						/>
						{err("name")}
					</label>
					<label>
						{t("timezone")}
						<input
							className="input"
							dir="ltr"
							value={location.timezone}
							readOnly
							disabled
						/>
					</label>
					<label>
						{t("address")}
						<input name="address" className="input" defaultValue={d.address} />
					</label>
					<label>
						{t("phone")}
						<input
							name="phone"
							className="input"
							dir="ltr"
							inputMode="tel"
							defaultValue={d.phone}
						/>
					</label>
					<label>
						{t("whatsapp")}
						<input
							name="whatsappNumber"
							className="input"
							dir="ltr"
							inputMode="tel"
							defaultValue={d.whatsappNumber}
						/>
					</label>
					<label>
						{t("day_cutoff")}
						<input
							name="dayCutoff"
							type="time"
							className="input"
							dir="ltr"
							defaultValue={d.dayCutoff}
							disabled={locked}
						/>
						<span className="muted small">{t("day_cutoff_hint")}</span>
						{err("dayCutoff")}
					</label>
				</div>

				<h2>{t("tax")}</h2>
				{locked && <p className="muted small">{t("owner_admin_only")}</p>}
				<fieldset className="grid2 bare" disabled={locked}>
					<label>
						{t("vat_rate")}
						<input
							name="taxPercent"
							className="input"
							inputMode="decimal"
							dir="ltr"
							defaultValue={d.taxPercent}
						/>
						{err("taxPercent")}
					</label>
					<label>
						{t("vat_number")}
						<input
							name="vatNumber"
							className="input"
							dir="ltr"
							defaultValue={d.vatNumber}
						/>
					</label>
					<label className="check">
						<input
							type="checkbox"
							name="pricesIncludeTax"
							defaultChecked={d.pricesIncludeTax}
						/>
						{t("prices_include_tax")}
					</label>
					<span className="muted small">{t("prices_include_tax_hint")}</span>
				</fieldset>

				<h2>{t("opening_hours")}</h2>
				<p className="muted small">{t("opening_hours_hint")}</p>
				<div className="hours">
					{WEEK.map((day) => (
						<div key={day} className="hours-row">
							<span>{t(`weekday_${day}`)}</span>
							<input
								name={`open:${day}`}
								type="time"
								className="input input--sm"
								dir="ltr"
								aria-label={`${t(`weekday_${day}`)} ${t("opens")}`}
								defaultValue={d.hours[day].open}
							/>
							<span className="muted">–</span>
							<input
								name={`close:${day}`}
								type="time"
								className="input input--sm"
								dir="ltr"
								aria-label={`${t(`weekday_${day}`)} ${t("closes")}`}
								defaultValue={d.hours[day].close}
							/>
							{d.hours[day].extra > 0 && (
								<span className="muted small">
									{t("extra_ranges", { count: d.hours[day].extra })}
								</span>
							)}
							{err(`hours:${day}`)}
						</div>
					))}
				</div>

				<h2>{t("guest_menu_look")}</h2>
				<div className="grid2">
					<label>
						{t("accent_color")}
						<input
							name="accent"
							type="color"
							className="input input--color"
							defaultValue={d.accent || "#b5532a"}
						/>
						{err("accent")}
					</label>
					<label>
						{t("logo_url")}
						<input
							name="logoUrl"
							type="url"
							className="input"
							dir="ltr"
							defaultValue={d.logoUrl}
						/>
						{err("logoUrl")}
					</label>
					<label>
						{t("receipt_header")}
						<textarea
							name="receiptHeader"
							className="input"
							rows={2}
							defaultValue={d.receiptHeader}
						/>
					</label>
				</div>

				<div className="form-actions">
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{busy ? t("saving") : t("save")}
					</button>
					{saved && !busy && <span className="muted small">{t("saved")}</span>}
				</div>
			</Form>
			<Devices devices={devices} />
		</>
	);
}

function PauseCard({ until }: { until: string | null }) {
	const { t, lang } = useShell();
	const fetcher = useFetcher<typeof clientAction>();
	const paused = until !== null && Date.parse(until) > Date.now();
	const busy = fetcher.state !== "idle";
	const pause = (minutes: string) =>
		fetcher.submit({ intent: "pause", minutes }, { method: "post" });
	const at = until
		? new Date(until).toLocaleTimeString(lang === "ar" ? "ar-OM" : "en-GB", {
				hour: "2-digit",
				minute: "2-digit",
				numberingSystem: "latn",
			})
		: "";
	return (
		<section className={`card pause${paused ? " pause--on" : ""}`}>
			<div>
				<strong>
					{paused ? t("orders_paused_until", { time: at }) : t("orders_open")}
				</strong>
				<div className="muted small">{t("pause_hint")}</div>
			</div>
			<div className="actions-row">
				{paused ? (
					<button
						type="button"
						className="btn btn--primary"
						disabled={busy}
						onClick={() => pause("resume")}
					>
						{t("resume_orders")}
					</button>
				) : (
					[15, 30, 60, 120].map((m) => (
						<button
							key={m}
							type="button"
							className="btn"
							disabled={busy}
							onClick={() => pause(String(m))}
						>
							{t("pause_for", { minutes: m })}
						</button>
					))
				)}
			</div>
		</section>
	);
}

function Devices({ devices }: { devices: AdminDevice[] }) {
	const { t, lang } = useShell();
	const reg = useFetcher<typeof clientAction>();
	const revoker = useFetcher();
	const [copied, setCopied] = useState(false);
	const res = reg.data && reg.data.intent === "register" ? reg.data : undefined;
	const token = res && "token" in res ? res.token : undefined;
	const errors: Errors = res && "errors" in res ? (res.errors ?? {}) : {};
	const live = devices.filter((d) => !d.revokedAt);
	const revoked = devices.filter((d) => d.revokedAt);
	const when = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleString(lang === "ar" ? "ar-OM" : "en-GB", {
					dateStyle: "medium",
					timeStyle: "short",
					numberingSystem: "latn",
				})
			: t("never");

	return (
		<section className="card">
			<h2>{t("devices")}</h2>
			<p className="muted small">{t("devices_hint")}</p>
			<table className="table">
				<thead>
					<tr>
						<th>{t("device")}</th>
						<th>{t("device_kind")}</th>
						<th>{t("ticket_prefix")}</th>
						<th>{t("last_seen")}</th>
						<th className="actions" />
					</tr>
				</thead>
				<tbody>
					{[...live, ...revoked].map((d) => (
						<tr key={d.id} className={d.revokedAt ? "row-muted" : ""}>
							<td>{d.name}</td>
							<td>{t(`kind_${d.kind}`)}</td>
							<td dir="ltr">{d.ticketPrefix}</td>
							<td className="small">{when(d.lastSeenAt)}</td>
							<td className="actions">
								{d.revokedAt ? (
									<span className="muted small">{t("revoked")}</span>
								) : (
									<button
										type="button"
										className="link-btn danger"
										onClick={() => {
											if (window.confirm(t("revoke_confirm", { name: d.name })))
												revoker.submit(
													{ intent: "revoke", deviceId: d.id },
													{ method: "post" },
												);
										}}
									>
										{t("revoke")}
									</button>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{token ? (
				<div className="token" role="status">
					<strong>
						{t("device_token_title", {
							name: res && "deviceName" in res ? res.deviceName : "",
						})}
					</strong>
					<p className="small">{t("device_token_hint")}</p>
					<code dir="ltr">{token}</code>
					<button
						type="button"
						className="btn"
						onClick={() => {
							navigator.clipboard?.writeText(token).then(
								() => setCopied(true),
								() => setCopied(false),
							);
						}}
					>
						{copied ? t("copied") : t("copy")}
					</button>
				</div>
			) : (
				<reg.Form method="post" className="inline-form">
					<input type="hidden" name="intent" value="register" />
					<label>
						{t("device_name")}
						<input
							name="name"
							className="input input--sm"
							placeholder={t("device_name_ph")}
							required
							maxLength={80}
						/>
						{errors.deviceName && (
							<span className="error small" role="alert">
								{t(errors.deviceName.key)}
							</span>
						)}
					</label>
					<label>
						{t("device_kind")}
						<select name="kind" className="input input--sm" defaultValue="pos">
							<option value="pos">{t("kind_pos")}</option>
							<option value="kds">{t("kind_kds")}</option>
							<option value="kiosk">{t("kind_kiosk")}</option>
						</select>
					</label>
					<label>
						{t("ticket_prefix")}
						<input
							name="ticketPrefix"
							className="input input--sm input--short"
							dir="ltr"
							maxLength={2}
							required
							autoCapitalize="characters"
						/>
						{errors.ticketPrefix && (
							<span className="error small" role="alert">
								{t(errors.ticketPrefix.key)}
							</span>
						)}
					</label>
					<button
						type="submit"
						className="btn btn--primary"
						disabled={reg.state !== "idle"}
					>
						{t("register_device")}
					</button>
				</reg.Form>
			)}
		</section>
	);
}
