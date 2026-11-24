import { encodePairingCode } from "@bite/contracts";
import {
	Badge,
	Dialog,
	Icon,
	Logo,
	Sheet,
	tenantAccent,
	useToast,
} from "@bite/ui";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { data, Form, useFetcher, useNavigation } from "react-router";
import { QrCode, qrSvg } from "../components/QrCode";
import { adminApi, isDemo } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import {
	agoText,
	type DayHours,
	deviceStatus,
	openStatus,
	suggestPrefix,
	vatExample,
} from "../lib/branch-settings";
import type { AdminDevice } from "../lib/contracts";
import type { MessageKey } from "../lib/i18n";
import { guestMenuUrl, pairingServerUrl } from "../lib/links";
import {
	type Day,
	locationFormDefaults,
	parseLocationForm,
	pausedUntil,
	TICKET_PREFIX,
	WEEK,
} from "../lib/location-form";
import { fromDecimal, toDecimal } from "../lib/money";
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

const SECTIONS = [
	{ id: "details", key: "details" },
	{ id: "hours", key: "opening_hours" },
	{ id: "tax", key: "tax" },
	{ id: "receipts", key: "receipts_section" },
	{ id: "look", key: "guest_look_section" },
	{ id: "qr", key: "guest_qr" },
	{ id: "devices", key: "devices" },
] as const satisfies readonly { id: string; key: MessageKey }[];

type Draft = {
	name: string;
	address: string;
	phone: string;
	vatNumber: string;
	taxPercent: string;
	pricesIncludeTax: boolean;
	receiptHeader: string;
	accent: string;
};

function readDraft(form: HTMLFormElement): Draft {
	const f = new FormData(form);
	const s = (k: string) => String(f.get(k) ?? "");
	return {
		name: s("name"),
		address: s("address"),
		phone: s("phone"),
		vatNumber: s("vatNumber"),
		taxPercent: s("taxPercent"),
		pricesIncludeTax: f.get("pricesIncludeTax") === "on",
		receiptHeader: s("receiptHeader"),
		accent: s("accent"),
	};
}

/** Everything the form would submit, as one string, to tell if it changed. */
const snapshot = (form: HTMLFormElement) =>
	JSON.stringify([...new FormData(form).entries()]);

export default function LocationSettings({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { location, devices } = loaderData;
	const { t, me, place } = useShell();
	const toast = useToast();
	// Managers can't change name, tax or the day cutoff (the API returns 403).
	const locked = me.member.orgRole === "staff";
	const nav = useNavigation();
	const busy = nav.state !== "idle";
	const d = locationFormDefaults(location);
	const errors: Errors =
		actionData?.intent === "save" && "errors" in actionData
			? (actionData.errors ?? {})
			: {};
	const err = (k: string) => {
		const e = errors[k];
		return e ? (
			<span className="error small" role="alert">
				{t(e.key, e.params)}
			</span>
		) : null;
	};

	const formRef = useRef<HTMLFormElement>(null);
	const [formKey, setFormKey] = useState(0);
	const [hours, setHours] = useState(() => hoursOf(d.hours));
	const [draft, setDraft] = useState<Draft | null>(null);
	const [dirty, setDirty] = useState(false);
	const initial = useRef("");
	const [rev, setRev] = useState(0);
	const edited = () => setRev((r) => r + 1);

	// A fresh baseline whenever the saved location changes (load, save, discard).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on new data or a discard
	useEffect(() => {
		setHours(hoursOf(locationFormDefaults(location).hours));
		requestAnimationFrame(() => {
			const form = formRef.current;
			if (!form) return;
			initial.current = snapshot(form);
			setDraft(readDraft(form));
			setDirty(false);
		});
	}, [location, formKey]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-read the form after every edit
	useEffect(() => {
		const form = formRef.current;
		if (!form || !initial.current) return;
		setDraft(readDraft(form));
		setDirty(snapshot(form) !== initial.current);
	}, [rev, hours]);

	const toasted = useRef<unknown>(undefined);
	useEffect(() => {
		if (toasted.current === actionData) return;
		toasted.current = actionData;
		if (actionData?.intent === "save" && "saved" in actionData)
			toast(t("settings_saved"), "success");
	}, [actionData, toast, t]);

	const status = openStatus(hours, location.timezone);
	const v = draft ?? {
		...d,
		accent: d.accent || "#b5532a",
	};
	const taxBps = fromDecimal(v.taxPercent, 2);

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("location_settings", { location: location.name })}</h1>
					{status && (
						<p className="page-sub">
							<Badge tone={status.open ? "success" : "neutral"}>
								{status.open
									? t("open_now_until", { time: status.closes })
									: status.opens
										? t("closed_now_opens", { time: status.opens })
										: t("closed_now")}
							</Badge>
						</p>
					)}
				</div>
			</div>
			<nav className="section-nav" aria-label={t("settings_jump")}>
				{SECTIONS.map((s) => (
					<a key={s.id} href={`#${s.id}`}>
						{t(s.key)}
					</a>
				))}
			</nav>
			<PauseCard until={location.ordersPausedUntil} />
			<Form
				method="post"
				className="settings-form"
				key={`${location.id}-${formKey}`}
				ref={formRef}
				onChange={edited}
				onInput={edited}
			>
				<section className="card form" id="details">
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
							<input
								name="address"
								className="input"
								defaultValue={d.address}
							/>
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
				</section>

				<section className="card form" id="hours">
					<h2>{t("opening_hours")}</h2>
					<p className="muted small">{t("opening_hours_hint")}</p>
					<HoursEditor
						hours={hours}
						extra={d.hours}
						onChange={setHours}
						err={err}
					/>
				</section>

				<section className="card form" id="tax">
					<h2>{t("tax")}</h2>
					{locked && <p className="muted small">{t("owner_admin_only")}</p>}
					<div className="split">
						<fieldset className="grid1 bare" disabled={locked}>
							<label>
								{t("vat_rate")}
								<input
									name="taxPercent"
									className="input input--md"
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
							<span className="muted small">
								{t("prices_include_tax_hint")}
							</span>
						</fieldset>
						{place && taxBps !== null && taxBps <= 10_000 && (
							<VatExample
								taxBps={taxBps}
								inclusive={v.pricesIncludeTax}
								decimals={place.decimals}
								currency={place.currencyCode}
							/>
						)}
					</div>
				</section>

				<section className="card form" id="receipts">
					<h2>{t("receipts_section")}</h2>
					<div className="split">
						<label>
							{t("receipt_header")}
							<textarea
								name="receiptHeader"
								className="input"
								rows={4}
								defaultValue={d.receiptHeader}
							/>
						</label>
						{place && taxBps !== null && taxBps <= 10_000 && (
							<ReceiptPreview
								draft={v}
								taxBps={taxBps}
								decimals={place.decimals}
								currency={place.currencyCode}
							/>
						)}
					</div>
				</section>

				<section className="card form" id="look">
					<h2>{t("guest_look_section")}</h2>
					<div className="split">
						<div className="grid1">
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
						</div>
						<AccentPreview accent={v.accent} name={v.name} />
					</div>
				</section>

				<div className={`savebar${dirty || busy ? " savebar--on" : ""}`}>
					<span className="savebar__msg">
						{dirty ? t("unsaved_changes") : ""}
					</span>
					{Object.keys(errors).length > 0 && (
						<span className="error small" role="alert">
							{t("save_failed")}
						</span>
					)}
					<button
						type="button"
						className="btn"
						disabled={busy || !dirty}
						onClick={() => setFormKey((k) => k + 1)}
					>
						{t("discard")}
					</button>
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{busy ? t("saving") : t("save")}
					</button>
				</div>
			</Form>
			<div id="qr" className="anchor">
				<GuestQr name={location.name} slug={location.slug} />
			</div>
			<div id="devices" className="anchor">
				<Devices devices={devices} />
			</div>
		</>
	);
}

const hoursOf = (h: Record<Day, { open: string; close: string }>) =>
	Object.fromEntries(
		WEEK.map((day) => [day, { open: h[day].open, close: h[day].close }]),
	) as Record<Day, DayHours>;

function HoursEditor({
	hours,
	extra,
	onChange,
	err,
}: {
	hours: Record<Day, DayHours>;
	extra: Record<Day, { extra: number }>;
	onChange: (h: Record<Day, DayHours>) => void;
	err: (k: string) => ReactNode;
}) {
	const { t } = useShell();
	const set = (day: Day, v: Partial<DayHours>) =>
		onChange({ ...hours, [day]: { ...hours[day], ...v } });
	const firstOpen = WEEK.find((day) => hours[day].open && hours[day].close);
	return (
		<div className="hours">
			{WEEK.map((day) => {
				const h = hours[day];
				const closed = !h.open && !h.close;
				return (
					<div
						key={day}
						className={`hours-row${closed ? " hours-row--closed" : ""}`}
					>
						<span className="hours-row__day">{t(`weekday_${day}`)}</span>
						<label className="switch-mini">
							<input
								type="checkbox"
								checked={!closed}
								onChange={(e) =>
									set(
										day,
										e.target.checked
											? { open: "09:00", close: "22:00" }
											: { open: "", close: "" },
									)
								}
							/>
							<span>{closed ? t("hours_closed") : t("hours_open")}</span>
						</label>
						{/* Hidden fields keep the names the action reads when the day is closed. */}
						{closed ? (
							<>
								<input type="hidden" name={`open:${day}`} value="" />
								<input type="hidden" name={`close:${day}`} value="" />
							</>
						) : (
							<span className="hours-row__times">
								<input
									name={`open:${day}`}
									type="time"
									className="input input--sm"
									dir="ltr"
									aria-label={`${t(`weekday_${day}`)} ${t("opens")}`}
									value={h.open}
									onChange={(e) => set(day, { open: e.target.value })}
								/>
								<span className="muted">–</span>
								<input
									name={`close:${day}`}
									type="time"
									className="input input--sm"
									dir="ltr"
									aria-label={`${t(`weekday_${day}`)} ${t("closes")}`}
									value={h.close}
									onChange={(e) => set(day, { close: e.target.value })}
								/>
							</span>
						)}
						{extra[day].extra > 0 && (
							<span className="muted small">
								{t("extra_ranges", { count: extra[day].extra })}
							</span>
						)}
						{err(`hours:${day}`)}
					</div>
				);
			})}
			{firstOpen && (
				<div>
					<button
						type="button"
						className="btn btn--sm"
						onClick={() =>
							onChange(
								Object.fromEntries(
									WEEK.map((day) => [day, { ...hours[firstOpen] }]),
								) as Record<Day, DayHours>,
							)
						}
					>
						<Icon name="copy" />
						{t("hours_copy_all", { day: t(`weekday_${firstOpen}`) })}
					</button>
				</div>
			)}
		</div>
	);
}

function VatExample({
	taxBps,
	inclusive,
	decimals,
	currency,
}: {
	taxBps: number;
	inclusive: boolean;
	decimals: number;
	currency: string;
}) {
	const { t } = useShell();
	const price = 10 ** decimals;
	const x = vatExample(price, taxBps, inclusive);
	const fmt = (n: number) => `${toDecimal(n, decimals)} ${currency}`;
	const rate = toDecimal(taxBps, 2).replace(/\.?0+$/, "") || "0";
	return (
		<div className="preview-card" aria-live="polite">
			<span className="preview-card__title">
				{t("vat_example_title", { price: fmt(price) })}
			</span>
			<dl className="kv">
				<dt>{t("vat_net")}</dt>
				<dd dir="ltr">{fmt(x.net)}</dd>
				<dt>{t("vat_amount", { rate })}</dt>
				<dd dir="ltr">{fmt(x.vat)}</dd>
				<dt className="strong">{t("vat_total")}</dt>
				<dd className="strong" dir="ltr">
					{fmt(x.total)}
				</dd>
			</dl>
		</div>
	);
}

function ReceiptPreview({
	draft,
	taxBps,
	decimals,
	currency,
}: {
	draft: Draft;
	taxBps: number;
	decimals: number;
	currency: string;
}) {
	const { t } = useShell();
	const unit = 10 ** decimals;
	const lines = [
		{ name: t("receipt_sample_1"), qty: 2, price: Math.round(unit * 1.6) },
		{ name: t("receipt_sample_2"), qty: 1, price: Math.round(unit * 1.2) },
	];
	const menuTotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
	const x = vatExample(menuTotal, taxBps, draft.pricesIncludeTax);
	const fmt = (n: number) => toDecimal(n, decimals);
	const rate = toDecimal(taxBps, 2).replace(/\.?0+$/, "") || "0";
	return (
		<figure className="receipt" aria-label={t("receipt_preview")}>
			<figcaption className="preview-card__title">
				{t("receipt_preview")}
			</figcaption>
			<div className="receipt__paper">
				<strong className="receipt__name">{draft.name || "—"}</strong>
				{draft.address && <span>{draft.address}</span>}
				{draft.phone && <span dir="ltr">{draft.phone}</span>}
				{draft.vatNumber && (
					<span>{t("receipt_vat_no", { number: draft.vatNumber })}</span>
				)}
				{draft.receiptHeader && (
					<span className="receipt__header">{draft.receiptHeader}</span>
				)}
				<hr />
				{lines.map((l) => (
					<span key={l.name} className="receipt__line">
						<span>
							{l.qty} × {l.name}
						</span>
						<span dir="ltr">{fmt(l.qty * l.price)}</span>
					</span>
				))}
				<hr />
				<span className="receipt__line">
					<span>{t("receipt_subtotal")}</span>
					<span dir="ltr">{fmt(x.net)}</span>
				</span>
				<span className="receipt__line">
					<span>{t("vat_amount", { rate })}</span>
					<span dir="ltr">{fmt(x.vat)}</span>
				</span>
				<span className="receipt__line receipt__total">
					<span>{t("receipt_total")}</span>
					<span dir="ltr">
						{fmt(x.total)} {currency}
					</span>
				</span>
				<span className="receipt__thanks">{t("receipt_thanks")}</span>
			</div>
		</figure>
	);
}

function AccentPreview({ accent, name }: { accent: string; name: string }) {
	const { t } = useShell();
	const a = tenantAccent(accent);
	return (
		<div className="preview-card">
			<span className="preview-card__title">{name}</span>
			<div className="accent-demo" style={a.vars as CSSProperties}>
				<span className="accent-demo__item">
					<span>{t("receipt_sample_1")}</span>
					<span className="accent-demo__btn">{t("accent_preview")}</span>
				</span>
			</div>
			{!a.usable && accent && (
				<p className="warn-text small">{t("accent_unusable")}</p>
			)}
		</div>
	);
}

const MAX_TABLES = 99;

/**
 * The QR code guests scan to open this location's menu, with a printable
 * table card. The address never carries a language, so one sticker serves
 * Arabic and English guests.
 */
function GuestQr({ name, slug }: { name: string; slug: string }) {
	const { t } = useShell();
	const [copied, setCopied] = useState(false);
	const [tables, setTables] = useState(0);
	// Demo data has no real menu behind it: show a sample address.
	const url =
		guestMenuUrl(slug) ?? (isDemo() ? `https://menu.example/${slug}` : null);
	if (!url)
		return (
			<section className="card">
				<h2>{t("guest_qr")}</h2>
				<p className="muted small">{t("guest_qr_unset")}</p>
			</section>
		);
	const download = () => {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(
			new Blob([qrSvg(url)], { type: "image/svg+xml" }),
		);
		a.download = `${slug}-menu-qr.svg`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	};
	return (
		<section className="card card--print">
			<h2>{t("guest_qr")}</h2>
			<div className="qr-row">
				<QrCode value={url} size={148} label={t("guest_qr_alt")} />
				<div className="qr-row__body">
					<p className="muted small">{t("guest_qr_hint")}</p>
					<code dir="ltr">{url}</code>
					<div className="actions-row">
						<button
							type="button"
							className="btn btn--primary"
							onClick={() => window.print()}
						>
							{tables > 0
								? t("print_table_cards", { count: tables })
								: t("print_table_card")}
						</button>
						<button type="button" className="btn" onClick={download}>
							{t("download_svg")}
						</button>
						<button
							type="button"
							className="btn"
							onClick={() => {
								navigator.clipboard?.writeText(url).then(
									() => setCopied(true),
									() => setCopied(false),
								);
							}}
						>
							{copied ? t("copied") : t("copy_link")}
						</button>
					</div>
				</div>
			</div>
			<label className="table-count">
				{t("table_count")}
				<input
					className="input"
					type="number"
					inputMode="numeric"
					min={0}
					max={MAX_TABLES}
					value={tables}
					onChange={(e) =>
						setTables(
							Math.max(0, Math.min(MAX_TABLES, Number(e.target.value) || 0)),
						)
					}
				/>
				<span className="muted small">{t("table_count_hint")}</span>
			</label>
			{/* Only these cards print (see @media print in styles.css), one per page. Both languages on each. */}
			{(tables > 0
				? Array.from({ length: tables }, (_, i) => String(i + 1))
				: [null]
			).map((table) => {
				const cardUrl = table
					? `${url}?table=${encodeURIComponent(table)}`
					: url;
				return (
					<div className="table-card" aria-hidden="true" key={table ?? "one"}>
						<strong className="table-card__name">{name}</strong>
						{table && (
							<strong className="table-card__table">
								Table {table} ·{" "}
								<span lang="ar" dir="rtl">
									طاولة {table}
								</span>
							</strong>
						)}
						<span className="table-card__cta">Scan to order</span>
						<span className="table-card__cta" lang="ar" dir="rtl">
							امسح الرمز للطلب
						</span>
						<QrCode
							value={cardUrl}
							size={260}
							label=""
							className="table-card__qr"
						/>
						<span className="table-card__url" dir="ltr">
							{cardUrl.replace(/^https?:\/\//, "")}
						</span>
						<Logo height={18} />
					</div>
				);
			})}
		</section>
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

function StatusBadge({ d }: { d: AdminDevice }) {
	const { t } = useShell();
	const st = deviceStatus(d);
	if (st.kind === "online")
		return (
			<Badge tone="success">
				<span className="dot" aria-hidden="true" />
				{t("device_online")}
			</Badge>
		);
	if (st.kind === "unpaired")
		return <Badge tone="warning">{t("device_unpaired")}</Badge>;
	return <Badge>{t("device_offline")}</Badge>;
}

const KIND_ICON = { pos: "tablet", kds: "monitor", kiosk: "bag" } as const;

function Devices({ devices }: { devices: AdminDevice[] }) {
	const { t, lang } = useShell();
	const toast = useToast();
	const reg = useFetcher<typeof clientAction>();
	const revoker = useFetcher();
	const [adding, setAdding] = useState(false);
	const [kind, setKind] = useState<AdminDevice["kind"]>("pos");
	const [revoking, setRevoking] = useState<AdminDevice | null>(null);
	const res = reg.data && reg.data.intent === "register" ? reg.data : undefined;
	const [stale, setStale] = useState<unknown>(undefined);
	const fresh = res !== stale ? res : undefined;
	const token = fresh && "token" in fresh ? fresh.token : undefined;
	const errors: Errors = fresh && "errors" in fresh ? (fresh.errors ?? {}) : {};
	const live = devices.filter((d) => !d.revokedAt);
	const revoked = devices.filter((d) => d.revokedAt);
	const prefix = suggestPrefix(devices);
	const when = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleString(lang === "ar" ? "ar-OM" : "en-GB", {
					dateStyle: "medium",
					timeStyle: "short",
					numberingSystem: "latn",
				})
			: t("never");
	const open = () => {
		setStale(res);
		setKind("pos");
		setAdding(true);
	};

	return (
		<section className="card">
			<div className="card-head">
				<h2>{t("devices")}</h2>
				<button type="button" className="btn btn--primary" onClick={open}>
					<Icon name="plus" />
					{t("device_add")}
				</button>
			</div>
			<p className="muted small">{t("devices_hint")}</p>
			{devices.length === 0 ? (
				<p className="empty">{t("devices_empty")}</p>
			) : (
				<ul className="device-grid">
					{[...live, ...revoked].map((d) => (
						<li
							key={d.id}
							className={`device${d.revokedAt ? " device--off" : ""}`}
						>
							<span className="device__icon">
								<Icon name={KIND_ICON[d.kind]} size={22} />
							</span>
							<span className="device__body">
								<strong>{d.name}</strong>
								<span className="muted small">
									{t(`kind_${d.kind}`)} · {t("ticket_prefix")}{" "}
									<b dir="ltr">{d.ticketPrefix}</b>
								</span>
								{d.lastSeenAt && (
									<span className="muted small" title={when(d.lastSeenAt)}>
										{t("last_seen")}:{" "}
										{agoText(
											Math.max(
												0,
												Math.floor(
													(Date.now() - Date.parse(d.lastSeenAt)) / 60_000,
												),
											),
											lang,
										)}
									</span>
								)}
							</span>
							<span className="device__side">
								{d.revokedAt ? (
									<Badge tone="danger">{t("revoked")}</Badge>
								) : (
									<>
										<StatusBadge d={d} />
										<button
											type="button"
											className="link-btn danger small"
											onClick={() => setRevoking(d)}
										>
											{t("revoke")}
										</button>
									</>
								)}
							</span>
						</li>
					))}
				</ul>
			)}

			<Dialog
				open={revoking !== null}
				onClose={() => setRevoking(null)}
				title={t("device_revoke_title", { name: revoking?.name ?? "" })}
				footer={
					<div className="actions-row">
						<button
							type="button"
							className="btn"
							onClick={() => setRevoking(null)}
						>
							{t("cancel")}
						</button>
						<button
							type="button"
							className="btn btn--danger"
							onClick={() => {
								if (!revoking) return;
								revoker.submit(
									{ intent: "revoke", deviceId: revoking.id },
									{ method: "post" },
								);
								toast(t("device_revoked", { name: revoking.name }), "neutral");
								setRevoking(null);
							}}
						>
							{t("revoke")}
						</button>
					</div>
				}
			>
				<p>{t("revoke_confirm", { name: revoking?.name ?? "" })}</p>
			</Dialog>

			<Sheet
				open={adding}
				onClose={() => setAdding(false)}
				title={
					token
						? t("pair_title", {
								name: res && "deviceName" in res ? res.deviceName : "",
							})
						: t("device_add")
				}
			>
				{token ? (
					<PairingPanel
						token={token}
						deviceName={res && "deviceName" in res ? res.deviceName : ""}
					/>
				) : (
					<reg.Form method="post" className="form device-form">
						<input type="hidden" name="intent" value="register" />
						<fieldset className="kind-pick bare">
							<legend className="field">{t("device_kind")}</legend>
							{(["pos", "kds", "kiosk"] as const).map((k) => (
								<label
									key={k}
									className={`kind-card${kind === k ? " kind-card--on" : ""}`}
								>
									<input
										type="radio"
										name="kind"
										value={k}
										checked={kind === k}
										onChange={() => setKind(k)}
									/>
									<Icon name={KIND_ICON[k]} size={24} />
									<strong>{t(`kind_${k}`)}</strong>
									<span className="muted small">{t(`kind_${k}_desc`)}</span>
								</label>
							))}
						</fieldset>
						<div className="grid2">
							<label>
								{t("device_name")}
								<input
									name="name"
									className="input"
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
								{t("ticket_prefix")}
								<input
									name="ticketPrefix"
									className="input input--short"
									dir="ltr"
									maxLength={2}
									required
									autoCapitalize="characters"
									defaultValue={prefix}
								/>
								<span className="muted small">
									{t("prefix_hint", { prefix: prefix || "A" })}
								</span>
								{errors.ticketPrefix && (
									<span className="error small" role="alert">
										{t(errors.ticketPrefix.key)}
									</span>
								)}
							</label>
						</div>
						<div className="form-actions">
							<button
								type="submit"
								className="btn btn--primary"
								disabled={reg.state !== "idle"}
							>
								{t("register_device")}
							</button>
						</div>
					</reg.Form>
				)}
			</Sheet>
		</section>
	);
}

/**
 * Shown once, right after a device is added: a QR the tablet scans to pair
 * (API address + token in one code), with copy and the bare token as fallbacks.
 */
function PairingPanel({
	token,
	deviceName,
}: {
	token: string;
	deviceName: string;
}) {
	const { t } = useShell();
	const [copied, setCopied] = useState(false);
	const code = encodePairingCode({ serverUrl: pairingServerUrl(), token });
	return (
		<div className="token" role="status">
			<strong>{t("pair_title", { name: deviceName })}</strong>
			<div className="qr-row">
				<QrCode value={code} size={196} label={t("pair_qr_alt")} />
				<div className="qr-row__body">
					<ol className="steps small">
						<li>{t("pair_step_open")}</li>
						<li>{t("pair_step_scan")}</li>
					</ol>
					<p className="small strong">{t("pair_once")}</p>
					<div className="actions-row">
						<button
							type="button"
							className="btn"
							onClick={() => {
								navigator.clipboard?.writeText(code).then(
									() => setCopied(true),
									() => setCopied(false),
								);
							}}
						>
							{copied ? t("copied") : t("copy_pairing_code")}
						</button>
					</div>
					<details className="small">
						<summary>{t("pair_manual")}</summary>
						<p className="muted">{t("pair_server")}</p>
						<code dir="ltr">{pairingServerUrl()}</code>
						<p className="muted">{t("pair_token")}</p>
						<code dir="ltr">{token}</code>
					</details>
				</div>
			</div>
		</div>
	);
}
