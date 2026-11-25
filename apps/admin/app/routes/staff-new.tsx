import { Icon } from "@bite/ui";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import type { MessageKey } from "../lib/i18n";
import { staffPowers } from "../lib/permissions";
import { loadPlaces } from "../lib/places";
import { selectedLocationId } from "../lib/selected-location";
import { inviteLink, JOBS, type Job, parseAddPerson } from "../lib/staff-form";
import { randomPin, weakPin } from "../lib/staff-list";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/staff-new";

type Errors = Record<
	string,
	{ key: MessageKey; params?: Record<string, string | number> }
>;

/**
 * "Add a person", for owners who have never set up staff software: say what
 * they do and the right access follows. No "org roles", no separate invite
 * and PIN forms. Ends on a hand-over screen with the PIN or the link to send.
 */
export async function clientLoader() {
	const api = adminApi();
	const places = await loadPlaces(api);
	const here = selectedLocationId(places);
	const devices = here ? await api.devices(here).catch(() => []) : [];
	return {
		tabletHere: devices.some(
			(d) => !d.revokedAt && d.kind !== "kds" && !!d.lastSeenAt,
		),
	};
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const api = adminApi();
	const form = await request.formData();
	const visible = (await loadPlaces(api)).map((p) => p.id);
	const parsed = parseAddPerson(form, visible, weakPin);
	if (!parsed.ok) return { errors: parsed.errors as Errors };
	const p = parsed.value;
	try {
		if (p.kind === "pin") {
			await api.createPinStaff({
				displayName: p.displayName,
				pin: p.pin,
				locations: p.locations,
			});
			return {
				ready: {
					name: p.displayName,
					pin: p.pin,
					locations: p.locations.map((l) => l.locationId),
				},
			};
		}
		const r = await api.inviteStaff({
			email: p.email,
			displayName: p.displayName,
			orgRole: p.orgRole,
			locations: p.locations,
		});
		if (p.pin) await api.resetPin(r.staff.id, p.pin);
		return {
			ready: {
				name: p.displayName,
				pin: p.pin,
				locations: p.locations.map((l) => l.locationId),
				invite: {
					link: inviteLink(r.inviteToken, window.location.origin),
					expiresAt: r.expiresAt,
				},
			},
		};
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 409)
			return { errors: { email: { key: "email_taken" } } as Errors };
		if (e instanceof AdminApiError && e.status === 402)
			return { errors: { form: { key: "dv_plan_limit" } } as Errors };
		if (e instanceof AdminApiError && e.status < 500)
			return { errors: { form: { key: "save_failed" } } as Errors };
		throw e;
	}
}

const JOB_ICON = {
	cashier: "cash",
	server: "receipt",
	kitchen: "monitor",
	manager: "store",
	admin: "key",
} as const;

export default function AddPerson({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t, me, places, locationId } = useShell();
	const powers = staffPowers(me);
	const busy = useNavigation().state !== "idle";
	const [name, setName] = useState("");
	const [job, setJob] = useState<Job | "">("");
	const [pin, setPin] = useState(() => randomPin());
	// "Add another" puts the last result aside without leaving the page.
	const [dismissed, setDismissed] = useState<unknown>(undefined);
	const [round, setRound] = useState(0);
	const errors: Errors =
		actionData && "errors" in actionData ? (actionData.errors ?? {}) : {};
	const err = (k: string) => {
		const e = errors[k];
		return e ? (
			<span className="error small" role="alert">
				{t(e.key, e.params)}
			</span>
		) : null;
	};

	const ready =
		actionData && "ready" in actionData ? actionData.ready : undefined;
	if (ready && actionData !== dismissed)
		return (
			<Ready
				ready={ready}
				tabletHere={loaderData.tabletHere}
				onAnother={() => {
					setDismissed(actionData);
					setRound((r) => r + 1);
					setName("");
					setJob("");
					setPin(randomPin());
				}}
			/>
		);

	const jobs = JOBS.filter((j) =>
		j === "admin" ? powers.canGrantAdmin : powers.grantable.includes(j),
	);
	const needsWhere = job !== "admin" && places.length > 1;
	const needsPin = job !== "" && job !== "admin";
	const needsEmail = job === "manager" ? powers.canInvite : job === "admin";
	let step = 1;

	return (
		<>
			<Link to="/staff" className="back-link">
				<Icon name="chevron-back" />
				{t("staff")}
			</Link>
			<div className="page-head">
				<div>
					<h1>{t("ap_title")}</h1>
					<p className="muted page-sub">{t("ap_sub")}</p>
				</div>
			</div>
			<Form method="post" className="ap-form" key={round}>
				{err("form")}
				<section className="card ap-q">
					<label className="ap-q__label" htmlFor="ap-name">
						<span className="ap-num">{step++}</span>
						{t("ap_q_name")}
					</label>
					<input
						id="ap-name"
						name="displayName"
						className="input ap-big-input"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("ap_name_ph")}
						autoComplete="off"
						maxLength={80}
						required
					/>
					{err("displayName")}
				</section>

				<fieldset className="card ap-q">
					<legend className="ap-q__label">
						<span className="ap-num">{step++}</span>
						{t("ap_q_job")}
					</legend>
					<div className="ap-jobs">
						{jobs.map((j) => (
							<label
								key={j}
								className={`ap-job${job === j ? " ap-job--on" : ""}`}
							>
								<input
									type="radio"
									name="job"
									value={j}
									checked={job === j}
									onChange={() => setJob(j)}
								/>
								<Icon name={JOB_ICON[j]} size={22} />
								<span className="ap-job__title">
									{j === "admin" ? t("ap_job_admin") : t(`role_${j}`)}
								</span>
								<span className="muted small">{t(`role_desc_${j}`)}</span>
							</label>
						))}
					</div>
					{err("job")}
				</fieldset>

				{job && needsWhere && (
					<fieldset className="card ap-q">
						<legend className="ap-q__label">
							<span className="ap-num">{step++}</span>
							{t("ap_q_where")}
						</legend>
						<div className="ap-places">
							{places.map((p) => (
								<label key={p.id} className="ap-place">
									<input
										type="checkbox"
										name="loc"
										value={p.id}
										defaultChecked={p.id === locationId}
									/>
									<span>{p.name}</span>
								</label>
							))}
						</div>
						{err("locations")}
					</fieldset>
				)}

				{needsPin && (
					<section className="card ap-q">
						<label className="ap-q__label" htmlFor="ap-pin">
							<span className="ap-num">{step++}</span>
							{t("ap_q_pin")}
						</label>
						<div className="ap-pin">
							<input
								id="ap-pin"
								name="pin"
								className="input ap-pin__input"
								inputMode="numeric"
								autoComplete="off"
								dir="ltr"
								pattern="\d{4,8}"
								maxLength={8}
								required
								value={pin}
								onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
							/>
							<button
								type="button"
								className="btn"
								onClick={() => setPin(randomPin())}
							>
								<Icon name="refresh" />
								{t("ap_pin_new")}
							</button>
						</div>
						<span className="muted small">{t("ap_pin_hint")}</span>
						{pin.length >= 4 && weakPin(pin) && (
							<span className="warn-text small">{t("pin_weak")}</span>
						)}
						{err("pin")}
					</section>
				)}

				{needsEmail && (
					<section className="card ap-q">
						<label className="ap-q__label" htmlFor="ap-email">
							<span className="ap-num">{step++}</span>
							{job === "admin"
								? t("ap_q_email_admin")
								: t("ap_q_email_manager")}
						</label>
						<input
							id="ap-email"
							name="email"
							type="email"
							className="input"
							dir="ltr"
							autoComplete="off"
							required={job === "admin"}
						/>
						<span className="muted small">
							{job === "admin"
								? t("ap_email_admin_hint")
								: t("ap_email_manager_hint")}
						</span>
						{err("email")}
					</section>
				)}

				<div className="form-actions ap-actions">
					<button
						type="submit"
						className="btn btn--primary dv-big"
						disabled={busy || !job}
					>
						{busy
							? t("saving")
							: name.trim()
								? t("ap_submit", { name: name.trim() })
								: t("ap_submit_empty")}
					</button>
				</div>
			</Form>
		</>
	);
}

type ReadyData = {
	name: string;
	pin?: string | undefined;
	locations: string[];
	invite?: { link: string; expiresAt: string };
};

/** The hand-over: exactly what to tell or send the new person. */
function Ready({
	ready,
	tabletHere,
	onAnother,
}: {
	ready: ReadyData;
	tabletHere: boolean;
	onAnother: () => void;
}) {
	const { t, lang, places, place, me } = useShell();
	const [copied, setCopied] = useState(false);
	const names = places
		.filter((p) => ready.locations.includes(p.id))
		.map((p) => p.name)
		.join(lang === "ar" ? "، " : ", ");
	const invite = ready.invite;
	const wa =
		invite &&
		`https://wa.me/?text=${encodeURIComponent(
			t("ap_wa_invite", {
				name: ready.name,
				org: me.org.name,
				link: invite.link,
			}),
		)}`;
	const expires = invite
		? new Date(invite.expiresAt).toLocaleDateString(
				lang === "ar" ? "ar-OM" : "en-GB",
				{ dateStyle: "medium", numberingSystem: "latn" },
			)
		: "";
	return (
		<section className="card ap-ready" role="status">
			<span className="dv-connected__check" aria-hidden="true">
				<Icon name="check" size={40} />
			</span>
			<h1>{t("ap_ready_title", { name: ready.name })}</h1>
			{names && (
				<p className="muted">{t("ap_ready_where", { places: names })}</p>
			)}

			{ready.pin && (
				<div className="ap-ready__block">
					<p>{t("ap_ready_pin")}</p>
					<p className="ap-ready__pin" dir="ltr">
						{ready.pin.split("").map((d, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: digits repeat; position is the identity
							<span key={i}>{d}</span>
						))}
					</p>
					<p className="muted small">{t("ap_ready_pin_note")}</p>
				</div>
			)}

			{invite && (
				<div className="ap-ready__block">
					<p>{t("ap_ready_link")}</p>
					<code className="ap-ready__link" dir="ltr">
						{invite.link}
					</code>
					<div className="actions-row ap-ready__share">
						{wa && (
							<a
								className="btn btn--primary"
								href={wa}
								target="_blank"
								rel="noreferrer"
							>
								{t("ap_whatsapp")}
							</a>
						)}
						<button
							type="button"
							className="btn"
							onClick={() =>
								navigator.clipboard?.writeText(invite.link).then(
									() => setCopied(true),
									() => setCopied(false),
								)
							}
						>
							<Icon name="copy" />
							{copied ? t("copied") : t("copy")}
						</button>
					</div>
					<p className="muted small">
						{t("ap_ready_link_expires", { date: expires })}
					</p>
				</div>
			)}

			{ready.pin && !tabletHere && place && (
				<p className="dv-nudge">
					{t("ap_no_tablet", { branch: place.name })}{" "}
					<Link to="/devices">{t("ap_connect_tablet")}</Link>
				</p>
			)}

			<div className="actions-row ap-ready__next">
				<button type="button" className="btn btn--primary" onClick={onAnother}>
					<Icon name="plus" />
					{t("ap_add_another")}
				</button>
				<Link className="btn" to="/staff">
					{t("ap_see_all")}
				</Link>
			</div>
		</section>
	);
}
