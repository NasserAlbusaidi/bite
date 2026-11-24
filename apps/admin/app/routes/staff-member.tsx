import { Dialog, Icon } from "@bite/ui";
import { useState } from "react";
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
				flash(t("staff_added", { name: body.displayName }));
			}
			return redirect("/staff");
		}
		const id = params.staffId;
		if (intent === "deactivate") {
			await api.deactivateStaff(id);
			flash(t("staff_deactivated", { name }), "neutral");
			return redirect("/staff");
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
	const { t, me } = useShell();
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
					</div>
				</div>
			</div>
			{kind !== "edit" && (
				<p className="muted">
					{kind === "invite" ? t("invite_hint") : t("pin_staff_hint")}
				</p>
			)}
			{!editable && <p className="card muted">{t("cant_edit_member")}</p>}
			{editable && (
				<Form method="post" className="card form" key={member?.id ?? kind}>
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
						{kind === "pin" && (
							<div className="field">
								<span>{t("pin")}</span>
								<PinInput label={t("pin")} />
								<span className="muted small">{t("pin_hint")}</span>
								{err("pin")}
							</div>
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
									: t("save")}
						</button>
						{member && member.orgRole !== "owner" && member.isActive && (
							<Deactivate member={member} busy={busy} />
						)}
					</div>
				</Form>
			)}
			{editable && member?.isActive && member.email && <Reissue />}
			{editable && member?.isActive && <ResetPin errors={errors} />}
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
									/>
									{r ? t(`role_${r}`) : t("no_access")}
								</label>
							))}
						</fieldset>
					</div>
				);
			})}
		</fieldset>
	);
}

/** PIN box with a Generate button that fills in a hard-to-guess PIN. */
function PinInput({ label }: { label: string }) {
	const { t } = useShell();
	const [pin, setPin] = useState("");
	return (
		<span className="pin-input">
			<input
				name="pin"
				aria-label={label}
				className="input"
				inputMode="numeric"
				autoComplete="off"
				dir="ltr"
				pattern="\d{4,8}"
				maxLength={8}
				required
				value={pin}
				onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
			/>
			<button type="button" className="btn" onClick={() => setPin(randomPin())}>
				<Icon name="refresh" />
				{t("pin_generate")}
			</button>
			{pin.length >= 4 && weakPin(pin) && (
				<span className="warn-text small">{t("pin_weak")}</span>
			)}
		</span>
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
			<span className="muted small">{t("reissue_hint")}</span>
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

function ResetPin({ errors }: { errors: Errors }) {
	const { t } = useShell();
	const fetcher = useFetcher<typeof clientAction>();
	const done =
		fetcher.state === "idle" &&
		fetcher.data &&
		typeof fetcher.data === "object" &&
		"pinReset" in fetcher.data;
	const pinErr =
		fetcher.data && typeof fetcher.data === "object" && "errors" in fetcher.data
			? fetcher.data.errors?.pin
			: errors.pin;
	return (
		<fetcher.Form method="post" className="card form inline-form">
			<input type="hidden" name="intent" value="resetPin" />
			<div className="field">
				<span>{t("new_pin")}</span>
				<PinInput key={done ? "done" : "edit"} label={t("new_pin")} />
			</div>
			<button type="submit" className="btn" disabled={fetcher.state !== "idle"}>
				{t("reset_pin")}
			</button>
			{done && <span className="muted small">{t("pin_updated")}</span>}
			{pinErr && (
				<span className="error small" role="alert">
					{t(pinErr.key)}
				</span>
			)}
		</fetcher.Form>
	);
}
