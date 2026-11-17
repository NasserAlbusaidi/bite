import { useState } from "react";
import {
	data,
	Form,
	Link,
	redirect,
	useFetcher,
	useNavigation,
	useSearchParams,
} from "react-router";
import { adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import type { AdminStaff } from "../lib/contracts";
import type { MessageKey } from "../lib/i18n";
import { staffPowers } from "../lib/permissions";
import { loadPlaces } from "../lib/places";
import {
	LOCATION_ROLES,
	mergeRoles,
	PIN,
	parseNewStaff,
	parseRoles,
} from "../lib/staff-form";
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

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs) {
	const form = await request.formData();
	const api = adminApi();
	const visible = (await loadPlaces(api)).map((p) => p.id);
	const intent = String(form.get("intent") ?? "save");
	try {
		if (params.staffId === "new") {
			const parsed = parseNewStaff(form, visible);
			if (!parsed.ok) return { errors: parsed.errors as Errors };
			const { kind, ...body } = parsed.value;
			if (kind === "invite" && "email" in body) await api.inviteStaff(body);
			else if ("pin" in body) await api.createPinStaff(body);
			return redirect("/staff");
		}
		const id = params.staffId;
		if (intent === "deactivate") {
			await api.deactivateStaff(id);
			return redirect("/staff");
		}
		if (intent === "resetPin") {
			const pin = String(form.get("pin") ?? "").trim();
			if (!PIN.test(pin))
				return { errors: { pin: { key: "invalid_pin" } } as Errors };
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

	return (
		<>
			<div className="page-head">
				<h1>{title}</h1>
				<Link to="/staff">{t("cancel")}</Link>
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
							<label>
								{t("pin")}
								<input
									name="pin"
									className="input"
									inputMode="numeric"
									autoComplete="off"
									dir="ltr"
									pattern="\d{4,8}"
									required
								/>
								<span className="muted small">{t("pin_hint")}</span>
								{err("pin")}
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
									: t("save")}
						</button>
						{member && member.orgRole !== "owner" && member.isActive && (
							<button
								type="submit"
								name="intent"
								value="deactivate"
								className="btn btn--danger"
								disabled={busy}
								formNoValidate
								onClick={(e) => {
									if (
										!window.confirm(
											t("deactivate_confirm", { name: member.displayName }),
										)
									)
										e.preventDefault();
								}}
							>
								{t("deactivate")}
							</button>
						)}
					</div>
				</Form>
			)}
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
		<fieldset className="fieldset">
			<legend>{t("location_access")}</legend>
			{places.map((p) => (
				<label key={p.id} className="role-row">
					<span>{p.name}</span>
					<select
						name={`role:${p.id}`}
						className="input input--sm"
						defaultValue={current.get(p.id) ?? ""}
					>
						<option value="">{t("no_access")}</option>
						{LOCATION_ROLES.filter(
							(r) => grantable.includes(r) || current.get(p.id) === r,
						).map((r) => (
							<option key={r} value={r}>
								{t(`role_${r}`)}
							</option>
						))}
					</select>
				</label>
			))}
		</fieldset>
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
			<label>
				{t("new_pin")}
				<input
					name="pin"
					className="input input--sm"
					inputMode="numeric"
					autoComplete="off"
					dir="ltr"
					required
				/>
			</label>
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
