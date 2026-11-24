import { Dialog, Icon } from "@bite/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	data,
	Form,
	Link,
	redirect,
	useFetcher,
	useNavigation,
	useSearchParams,
	useSubmit,
} from "react-router";
import { Roles, SignIn } from "../components/StaffBadges";
import { adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import type { AdminStaff, InviteStaffResponse } from "../lib/contracts";
import { flash } from "../lib/flash";
import { type MessageKey, savedLang, translator } from "../lib/i18n";
import { staffPowers } from "../lib/permissions";
import { loadPlaces } from "../lib/places";
import {
	inviteLink,
	LOCATION_ROLES,
	mergeRoles,
	PIN,
	parseNewStaff,
	parseRoles,
} from "../lib/staff-form";
import { initials, randomPin, weakPin } from "../lib/staff-list";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/staff-member";

type Errors = Record<
	string,
	{ key: MessageKey; params?: Record<string, string | number> }
>;

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
	if (params.staffId === "new") return { member: undefined };
	const member = (await adminApi().staff()).find(
		(s) => s.id === params.staffId,
	);
	if (!member) throw data(null, { status: 404 });
	return { member };
}

const invited = (r: InviteStaffResponse) => ({
	invite: {
		name: r.staff.displayName,
		link: inviteLink(r.inviteToken, window.location.origin),
		expiresAt: r.expiresAt,
	},
});

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs) {
	const form = await request.formData();
	const api = adminApi();
	const visible = (await loadPlaces(api)).map((p) => p.id);
	const intent = String(form.get("intent") ?? "save");
	const t = translator(savedLang());
	const name = String(form.get("displayName") ?? "").trim();
	try {
		if (params.staffId === "new") {
			const parsed = parseNewStaff(form, visible);
			if (!parsed.ok) return { errors: parsed.errors as Errors };
			const { kind, ...body } = parsed.value;
			if (kind === "invite" && "email" in body)
				return invited(await api.inviteStaff(body));
			if ("pin" in body) {
				if (weakPin(body.pin))
					return { errors: { pin: { key: "pin_weak" } } as Errors };
				await api.createPinStaff(body);
				return {
					created: {
						name: body.displayName,
						pin: body.pin,
						locations: body.locations,
					},
				};
			}
			return redirect("/staff");
		}
		const id = params.staffId;
		if (intent === "deactivate") {
			await api.deactivateStaff(id);
			flash(t("staff_deactivated", { name }), "neutral");
			return redirect("/staff");
		}
		if (intent === "reactivate") {
			await api.reactivateStaff(id);
			flash(t("staff_reactivated", { name }));
			return redirect(`/staff/${id}`);
		}
		if (intent === "reissue") {
			try {
				return invited(await api.reissueInvite(id));
			} catch (e) {
				if (e instanceof AdminApiError && e.status === 409)
					return { errors: { invite: { key: "invite_accepted" } } as Errors };
				throw e;
			}
		}
		if (intent === "resetPin") {
			const pin = String(form.get("pin") ?? "").trim();
			if (!PIN.test(pin))
				return { errors: { pin: { key: "invalid_pin" } } as Errors };
			if (weakPin(pin))
				return { errors: { pin: { key: "pin_weak" } } as Errors };
			await api.resetPin(id, pin);
			return { pinReset: true };
		}
		const current = (await api.staff()).find((s) => s.id === id);
		if (!current) throw data(null, { status: 404 });
		const displayName = String(form.get("displayName") ?? "").trim();
		if (!displayName || displayName.length > 80)
			return { errors: { displayName: { key: "required_field" } } as Errors };
		const orgRole = form.get("orgRole");
		await api.updateStaff(id, {
			displayName,
			...(current.orgRole !== "owner" &&
			(orgRole === "admin" || orgRole === "staff")
				? { orgRole }
				: {}),
			locations: mergeRoles(
				current.locations,
				parseRoles(form, visible),
				visible,
			),
		});
		flash(t("staff_saved", { name: displayName }));
		return redirect("/staff");
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 409)
			return { errors: { email: { key: "email_taken" } } as Errors };
		if (e instanceof AdminApiError && e.status < 500)
			return { errors: { form: { key: "save_failed" } } as Errors };
		throw e;
	}
}

export default function StaffMember({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { member } = loaderData;
	const [search] = useSearchParams();
	const kind = member
		? "edit"
		: search.get("kind") === "invite"
			? "invite"
			: "pin";
	const { t, me, places, locationId } = useShell();
	const powers = staffPowers(me);
	const editable = !member || powers.canEdit(member);
	const nav = useNavigation();
	const busy = nav.state !== "idle";
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
	const [orgRole, setOrgRole] = useState(member?.orgRole ?? "staff");
	const title = member
		? member.displayName
		: kind === "invite"
			? t("invite_manager")
			: t("add_pin_staff");

	const formRef = useRef<HTMLFormElement>(null);
	const submit = useSubmit();
	const [askPin, setAskPin] = useState(false);
	// A non-PIN error came back: close the dialog so the form error shows.
	useEffect(() => {
		const e = actionData && "errors" in actionData ? actionData.errors : {};
		if (Object.keys(e ?? {}).some((k) => k !== "pin")) setAskPin(false);
	}, [actionData]);
	const created =
		actionData && "created" in actionData ? actionData.created : undefined;
	if (created && !member)
		return (
			<>
				<div className="page-head">
					<h1>{t("staff_added", { name: created.name })}</h1>
				</div>
				<PinSlip
					name={created.name}
					pin={created.pin}
					locations={created.locations}
					done={
						<Link className="btn btn--primary" to="/staff">
							<Icon name="check" />
							{t("pin_told_them")}
						</Link>
					}
				/>
			</>
		);

	const invite =
		actionData && "invite" in actionData ? actionData.invite : undefined;
	if (invite && !member)
		return (
			<>
				<div className="page-head">
					<h1>{t("invite_ready_title", { name: invite.name })}</h1>
				</div>
				<InviteCard invite={invite} />
				<div className="form-actions">
					<Link className="btn btn--primary" to="/staff">
						{t("done")}
					</Link>
				</div>
			</>
		);

	return (
		<>
			<Link to="/staff" className="back-link">
				<Icon name="chevron-back" />
				{t("staff")}
			</Link>
			<div className="page-head">
				<div className="person-head">
					{member && (
						<span className="avatar avatar--lg" aria-hidden="true">
							{initials(member.displayName)}
						</span>
					)}
					<div>
						<h1>{title}</h1>
						{member?.email && (
							<p className="muted small page-sub" dir="ltr">
								{member.email}
							</p>
						)}
						{member && (
							<div className="person-head__badges">
								<Roles
									s={member}
									names={new Map(places.map((p) => [p.id, p.name]))}
									current={locationId}
									t={t}
								/>
								<SignIn s={member} t={t} />
							</div>
						)}
					</div>
				</div>
			</div>
			{kind !== "edit" && (
				<p className="muted">
					{kind === "invite" ? t("invite_hint") : t("pin_staff_hint")}
				</p>
			)}
			{!editable && <p className="card muted">{t("cant_edit_member")}</p>}
			{editable && member && !member.isActive && (
				<Form method="post" className="card notice-row">
					<input type="hidden" name="intent" value="reactivate" />
					<input type="hidden" name="displayName" value={member.displayName} />
					<span>
						<strong>{t("staff_off_title")}</strong>
						<span className="muted small">{t("staff_off_hint")}</span>
					</span>
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{t("reactivate")}
					</button>
				</Form>
			)}
			{editable && (
				<Form
					method="post"
					className="card form"
					key={member?.id ?? kind}
					ref={formRef}
					onSubmit={(e) => {
						// Floor staff: name and roles first, then the PIN dialog.
						if (kind !== "pin") return;
						e.preventDefault();
						setAskPin(true);
					}}
				>
					<input type="hidden" name="kind" value={kind} />
					{err("form")}
					<div className="grid2">
						<label>
							{t("name")}
							<input
								name="displayName"
								className="input"
								defaultValue={member?.displayName ?? ""}
								required
								maxLength={80}
							/>
							{err("displayName")}
						</label>
						{kind === "invite" && (
							<label>
								{t("email")}
								<input
									name="email"
									type="email"
									className="input"
									dir="ltr"
									required
								/>
								{err("email")}
							</label>
						)}
						{member?.email && (
							<label>
								{t("email")}
								<input
									className="input"
									dir="ltr"
									value={member.email}
									readOnly
									disabled
								/>
							</label>
						)}
						{((kind === "invite" && powers.canSetOrgRole) ||
							(member && powers.canChangeOrgRoleOf(member))) && (
							<label>
								{t("org_access")}
								<select
									name="orgRole"
									className="input"
									value={orgRole}
									onChange={(e) =>
										setOrgRole(e.currentTarget.value as AdminStaff["orgRole"])
									}
								>
									<option value="staff">{t("org_staff")}</option>
									{(powers.canGrantAdmin || orgRole === "admin") && (
										<option value="admin">{t("org_admin")}</option>
									)}
								</select>
							</label>
						)}
					</div>
					{orgRole === "owner" || orgRole === "admin" ? (
						<p className="muted small">{t("admin_all_locations")}</p>
					) : (
						<RolePicker member={member} grantable={powers.grantable} />
					)}
					{err("locations")}
					<div className="form-actions">
						<button type="submit" className="btn btn--primary" disabled={busy}>
							{busy
								? t("saving")
								: kind === "invite"
									? t("send_invite")
									: kind === "pin"
										? t("next_create_pin")
										: t("save_details")}
						</button>
						{member && member.orgRole !== "owner" && member.isActive && (
							<Deactivate member={member} busy={busy} />
						)}
					</div>
				</Form>
			)}
			{kind === "pin" && (
				<PinDialog
					open={askPin}
					name={String(
						(askPin && formRef.current
							? new FormData(formRef.current).get("displayName")
							: "") ?? "",
					)}
					busy={busy}
					error={errors.pin?.key}
					onClose={() => setAskPin(false)}
					onSave={(pin) => {
						const form = formRef.current;
						if (!form) return;
						const fd = new FormData(form);
						fd.set("pin", pin);
						submit(fd, { method: "post" });
					}}
				/>
			)}
			{editable && member?.isActive && member.email && <Reissue />}
			{editable && member?.isActive && <TabletPin member={member} />}
		</>
	);
}

function RolePicker({
	member,
	grantable,
}: {
	member: AdminStaff | undefined;
	grantable: readonly string[];
}) {
	const { t, places } = useShell();
	const current = new Map(
		(member?.locations ?? []).map((l) => [l.locationId, l.role]),
	);
	const [picked, setPicked] = useState<Map<string, string>>(
		() => new Map(current),
	);
	return (
		<fieldset className="fieldset role-matrix">
			<legend>{t("location_access")}</legend>
			{places.map((p) => {
				const roles = LOCATION_ROLES.filter(
					(r) => grantable.includes(r) || current.get(p.id) === r,
				);
				return (
					<div key={p.id} className="role-matrix__row">
						<span className="role-matrix__place">{p.name}</span>
						<fieldset className="seg seg--set">
							<legend className="sr-only">{p.name}</legend>
							{(["", ...roles] as const).map((r) => (
								<label
									key={r || "none"}
									className="seg__btn seg__radio"
									title={r ? t(`role_desc_${r}`) : undefined}
								>
									<input
										type="radio"
										name={`role:${p.id}`}
										value={r}
										defaultChecked={(current.get(p.id) ?? "") === r}
										onChange={() => setPicked((m) => new Map(m).set(p.id, r))}
									/>
									{r ? t(`role_${r}`) : t("no_access")}
								</label>
							))}
						</fieldset>
						<span className="role-matrix__desc muted small">
							{picked.get(p.id)
								? t(
										`role_desc_${picked.get(p.id) as (typeof LOCATION_ROLES)[number]}`,
									)
								: t("no_access_desc", { place: p.name })}
						</span>
					</div>
				);
			})}
		</fieldset>
	);
}

/**
 * Pick a PIN in its own dialog, with its own Cancel and Save, so the page's
 * Save button never looks like it saves the PIN. Starts with a generated PIN.
 */
function PinDialog({
	open,
	name,
	busy,
	error,
	onClose,
	onSave,
}: {
	open: boolean;
	name: string;
	busy: boolean;
	error: MessageKey | undefined;
	onClose: () => void;
	onSave: (pin: string) => void;
}) {
	const { t } = useShell();
	const [pin, setPin] = useState("");
	useEffect(() => {
		if (open) setPin(randomPin());
	}, [open]);
	const valid = PIN.test(pin) && !weakPin(pin);
	return (
		<Dialog
			open={open}
			onClose={onClose}
			title={t("pin_dialog_title", { name })}
			footer={
				<div className="actions-row">
					<button type="button" className="btn" onClick={onClose}>
						{t("cancel")}
					</button>
					<button
						type="button"
						className="btn btn--primary"
						disabled={!valid || busy}
						onClick={() => onSave(pin)}
					>
						{busy ? t("saving") : t("save_pin")}
					</button>
				</div>
			}
		>
			<form
				className="pin-pick"
				onSubmit={(e) => {
					e.preventDefault();
					if (valid && !busy) onSave(pin);
				}}
			>
				<p className="muted small">{t("pin_dialog_hint")}</p>
				<input
					aria-label={t("pin")}
					className="pin-pick__input"
					inputMode="numeric"
					autoComplete="off"
					dir="ltr"
					maxLength={8}
					value={pin}
					onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
				/>
				<button
					type="button"
					className="btn"
					onClick={() => setPin(randomPin())}
				>
					<Icon name="refresh" />
					{t("pin_generate_another")}
				</button>
				{pin.length >= 4 && weakPin(pin) ? (
					<span className="warn-text small">{t("pin_weak")}</span>
				) : (
					error && (
						<span className="error small" role="alert">
							{t(error)}
						</span>
					)
				)}
			</form>
		</Dialog>
	);
}

/**
 * Shown once, right after a PIN is saved: a till-slip with the PIN to read
 * out. Hide covers the digits if someone is looking over your shoulder.
 */
function PinSlip({
	name,
	pin,
	locations,
	done,
}: {
	name: string;
	pin: string;
	locations: readonly { locationId: string; role: string }[];
	done: ReactNode;
}) {
	const { t, places } = useShell();
	const [hidden, setHidden] = useState(false);
	const names = new Map(places.map((p) => [p.id, p.name]));
	return (
		<div className="pin-done" role="status">
			<strong className="pin-done__ok">
				<Icon name="check" />
				{t("pin_saved")}
			</strong>
			<div className="pin-slip">
				<div className="pin-slip__title">{t("pin_slip_title")}</div>
				<div className="pin-slip__row">
					<span>{t("name")}</span>
					<span>{name}</span>
				</div>
				{locations.map((l) => (
					<div className="pin-slip__row" key={l.locationId}>
						<span>{names.get(l.locationId) ?? ""}</span>
						<span>{t(`role_${l.role}` as MessageKey)}</span>
					</div>
				))}
				<div
					className={`pin-slip__pin${hidden ? " pin-slip__pin--hidden" : ""}`}
					dir="ltr"
					aria-hidden={hidden}
				>
					{pin}
				</div>
				<p className="pin-slip__note">{t("pin_slip_tell")}</p>
			</div>
			<div className="actions-row">
				<button
					type="button"
					className="btn"
					onClick={() => setHidden((h) => !h)}
				>
					<Icon name="eye" />
					{hidden ? t("pin_show") : t("pin_hide")}
				</button>
				{done}
			</div>
		</div>
	);
}

/** Asks first, in a dialog, then submits the deactivate intent. */
function Deactivate({ member, busy }: { member: AdminStaff; busy: boolean }) {
	const { t } = useShell();
	const [open, setOpen] = useState(false);
	const submit = useSubmit();
	return (
		<>
			<button
				type="button"
				className="btn btn--danger"
				disabled={busy}
				onClick={() => setOpen(true)}
			>
				{t("deactivate")}
			</button>
			<Dialog
				open={open}
				onClose={() => setOpen(false)}
				title={t("deactivate_title", { name: member.displayName })}
				footer={
					<div className="actions-row">
						<button
							type="button"
							className="btn"
							onClick={() => setOpen(false)}
						>
							{t("cancel")}
						</button>
						<button
							type="button"
							className="btn btn--danger"
							onClick={() => {
								setOpen(false);
								submit(
									{ intent: "deactivate", displayName: member.displayName },
									{ method: "post" },
								);
							}}
						>
							{t("deactivate")}
						</button>
					</div>
				}
			>
				<p>{t("deactivate_confirm", { name: member.displayName })}</p>
			</Dialog>
		</>
	);
}

type Invite = { name: string; link: string; expiresAt: string };

/** The link is shown once: copy it, or hand it to the phone's share sheet. */
function InviteCard({ invite }: { invite: Invite }) {
	const { t, lang } = useShell();
	const [copied, setCopied] = useState(false);
	const expires = new Date(invite.expiresAt).toLocaleDateString(
		lang === "ar" ? "ar-OM" : "en-GB",
		{ dateStyle: "medium", numberingSystem: "latn" },
	);
	const share = typeof navigator !== "undefined" && "share" in navigator;
	return (
		<div className="token" role="status">
			<strong>{t("invite_link_title")}</strong>
			<p className="small">{t("invite_link_hint", { date: expires })}</p>
			<code dir="ltr">{invite.link}</code>
			<div className="actions-row">
				<button
					type="button"
					className="btn"
					onClick={() => {
						navigator.clipboard?.writeText(invite.link).then(
							() => setCopied(true),
							() => setCopied(false),
						);
					}}
				>
					{copied ? t("copied") : t("copy")}
				</button>
				{share && (
					<button
						type="button"
						className="btn"
						onClick={() => {
							navigator
								.share({ title: t("invite_share_title"), url: invite.link })
								.catch(() => undefined);
						}}
					>
						{t("share")}
					</button>
				)}
			</div>
		</div>
	);
}

/** Lost or expired link: issue a new one. The old link stops working. */
function Reissue() {
	const { t } = useShell();
	const fetcher = useFetcher<typeof clientAction>();
	const d = fetcher.state === "idle" ? fetcher.data : undefined;
	const invite =
		d && typeof d === "object" && "invite" in d ? d.invite : undefined;
	const error =
		d && typeof d === "object" && "errors" in d ? d.errors?.invite : undefined;
	if (invite) return <InviteCard invite={invite} />;
	return (
		<fetcher.Form method="post" className="card form inline-form">
			<input type="hidden" name="intent" value="reissue" />
			<div className="inline-form__head">
				<h2>{t("reissue_title")}</h2>
				<span className="muted small">{t("reissue_hint")}</span>
			</div>
			<button type="submit" className="btn" disabled={fetcher.state !== "idle"}>
				{t("reissue_invite")}
			</button>
			{error && (
				<span className="error small" role="alert">
					{t(error.key)}
				</span>
			)}
		</fetcher.Form>
	);
}

/** Shows whether they have a PIN; changing it happens in PinDialog. */
function TabletPin({ member }: { member: AdminStaff }) {
	const { t } = useShell();
	const fetcher = useFetcher<typeof clientAction>();
	const [step, setStep] = useState<"idle" | "pick" | "done">("idle");
	const [pin, setPin] = useState("");
	const waiting = useRef(false);
	const d = fetcher.state === "idle" ? fetcher.data : undefined;
	const saved = d && typeof d === "object" && "pinReset" in d;
	const error =
		d && typeof d === "object" && "errors" in d
			? d.errors?.pin?.key
			: undefined;
	useEffect(() => {
		if (saved && waiting.current) {
			waiting.current = false;
			setStep("done");
		}
	}, [saved]);
	return (
		<section className="card pin-row">
			<span className="pin-row__icon" aria-hidden="true">
				<Icon name="key" />
			</span>
			<div className="pin-row__text">
				<h2>{t("tablet_pin_title")}</h2>
				<span className="muted small">{t("tablet_pin_hint")}</span>
			</div>
			<span
				className={`pin-row__state${member.hasPin ? "" : " pin-row__state--none"}`}
			>
				{member.hasPin ? t("pin_is_set") : t("no_pin_yet")}
			</span>
			<button type="button" className="btn" onClick={() => setStep("pick")}>
				{member.hasPin ? t("change_pin") : t("create_pin")}
			</button>
			<PinDialog
				open={step === "pick"}
				name={member.displayName}
				busy={fetcher.state !== "idle"}
				error={error}
				onClose={() => setStep("idle")}
				onSave={(p) => {
					setPin(p);
					waiting.current = true;
					fetcher.submit({ intent: "resetPin", pin: p }, { method: "post" });
				}}
			/>
			<Dialog
				open={step === "done"}
				onClose={() => setStep("idle")}
				title={member.displayName}
			>
				{step === "done" && (
					<PinSlip
						name={member.displayName}
						pin={pin}
						locations={member.locations}
						done={
							<button
								type="button"
								className="btn btn--primary"
								onClick={() => setStep("idle")}
							>
								<Icon name="check" />
								{t("pin_told_them")}
							</button>
						}
					/>
				)}
			</Dialog>
		</section>
	);
}
