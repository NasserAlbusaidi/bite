import { Badge } from "@bite/ui";
import { Form, useNavigation } from "react-router";
import { parsePasswordForm, passwordError } from "../lib/account-form";
import { account, adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import type { MessageKey } from "../lib/i18n";
import { useShellPrefs } from "../lib/shell-prefs";
import { initials } from "../lib/staff-list";
import { THEMES } from "../lib/theme";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/account";

type Result =
	| { form: "name"; saved: true }
	| { form: "name"; error: MessageKey }
	| { form: "password"; saved: true }
	| { form: "password"; errors: Record<string, MessageKey> };

export async function clientAction({
	request,
}: Route.ClientActionArgs): Promise<Result> {
	const f = await request.formData();
	const acc = account();
	const api = adminApi();

	if (f.get("intent") === "name") {
		const name = String(f.get("name") ?? "").trim();
		if (!name || name.length > 80)
			return { form: "name", error: "required_field" };
		// Two records carry a name: the member in this business (what staff
		// lists and receipts show) and the login itself. Keep them the same.
		const me = await api.me();
		await api.updateStaff(me.member.id, { displayName: name });
		await acc?.updateName(name);
		return { form: "name", saved: true };
	}

	const parsed = parsePasswordForm(f);
	if (!parsed.ok) return { form: "password", errors: parsed.errors };
	if (!acc) return { form: "password", errors: { current: "account_demo" } };
	try {
		await acc.changePassword(parsed.current, parsed.next, parsed.signOutOthers);
	} catch (e) {
		if (!(e instanceof AdminApiError) || e.status >= 500) throw e;
		return { form: "password", errors: passwordError(e.code) };
	}
	return { form: "password", saved: true };
}

export default function AccountPage({ actionData }: Route.ComponentProps) {
	const { t, me, demo } = useShell();
	const busy = useNavigation().state !== "idle";
	const name = actionData?.form === "name" ? actionData : undefined;
	const pw = actionData?.form === "password" ? actionData : undefined;
	const pwErr = (k: string) => {
		const key = pw && "errors" in pw ? pw.errors[k] : undefined;
		return key ? (
			<span className="error small" role="alert">
				{t(key)}
			</span>
		) : null;
	};
	const saved = (
		<span className="ok small" role="status">
			{t("saved")}
		</span>
	);

	return (
		<>
			<div className="page-head">
				<div className="person-head">
					<span className="avatar avatar--lg" aria-hidden="true">
						{initials(me.member.displayName)}
					</span>
					<div>
						<h1>{me.member.displayName}</h1>
						<p className="muted small page-sub">
							{t(`role_${me.member.orgRole}_short`)} · {me.org.name}
						</p>
					</div>
				</div>
			</div>

			<Form method="post" className="card form">
				<input type="hidden" name="intent" value="name" />
				<h2>{t("account_details")}</h2>
				<div className="grid2">
					<label>
						{t("your_name")}
						<input
							name="name"
							className="input"
							defaultValue={me.member.displayName}
							autoComplete="name"
							required
							maxLength={80}
						/>
						<span className="muted small">{t("account_name_hint")}</span>
						{name && "error" in name && (
							<span className="error small" role="alert">
								{t(name.error)}
							</span>
						)}
					</label>
					<label>
						{t("email")}
						<input
							className="input"
							value={me.member.email ?? ""}
							dir="ltr"
							readOnly
							disabled
						/>
						<span className="muted small">{t("account_email_hint")}</span>
					</label>
				</div>
				<div className="choice__actions">
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{t("save")}
					</button>
					{name && "saved" in name && !busy && saved}
				</div>
			</Form>

			<Preferences />
			<Access />

			{demo ? (
				<p className="card muted">{t("account_demo")}</p>
			) : (
				// A new key empties the three fields once the password is changed.
				<Form
					method="post"
					className="card form"
					key={pw && "saved" in pw ? "done" : "edit"}
				>
					<input type="hidden" name="intent" value="password" />
					<h2>{t("password_change")}</h2>
					<label className="account__current">
						{t("password_current")}
						<input
							name="current"
							type="password"
							className="input"
							dir="ltr"
							autoComplete="current-password"
							required
						/>
						{pwErr("current")}
					</label>
					<div className="grid2">
						<label>
							{t("password_new")}
							<input
								name="next"
								type="password"
								className="input"
								dir="ltr"
								autoComplete="new-password"
								minLength={10}
								maxLength={128}
								required
							/>
							<span className="muted small">{t("password_hint")}</span>
							{pwErr("next")}
						</label>
						<label>
							{t("password_confirm")}
							<input
								name="confirm"
								type="password"
								className="input"
								dir="ltr"
								autoComplete="new-password"
								required
							/>
							{pwErr("confirm")}
						</label>
					</div>
					<label className="check">
						<input type="checkbox" name="signOutOthers" defaultChecked />
						{t("password_sign_out_others")}
					</label>
					<div className="choice__actions">
						<button type="submit" className="btn btn--primary" disabled={busy}>
							{t("password_change")}
						</button>
						{pw && "saved" in pw && !busy && (
							<span className="ok small" role="status">
								{t("password_changed")}
							</span>
						)}
					</div>
				</Form>
			)}
		</>
	);
}

function Preferences() {
	const { t, lang } = useShell();
	const { theme, setTheme, toggleLang } = useShellPrefs();
	return (
		<section className="card form">
			<h2>{t("prefs_title")}</h2>
			<div className="pref-rows">
				<fieldset className="pref-row bare">
					<legend>{t("theme")}</legend>
					<div className="seg">
						{THEMES.map((th) => (
							<button
								key={th}
								type="button"
								className="seg__btn"
								aria-pressed={theme === th}
								onClick={() => setTheme(th)}
							>
								{t(`theme_${th}`)}
							</button>
						))}
					</div>
				</fieldset>
				<fieldset className="pref-row bare">
					<legend>{t("prefs_language")}</legend>
					<div className="seg">
						{(["en", "ar"] as const).map((l) => (
							<button
								key={l}
								type="button"
								className="seg__btn"
								lang={l}
								aria-pressed={lang === l}
								onClick={() => lang !== l && toggleLang()}
							>
								{l === "en" ? "English" : "العربية"}
							</button>
						))}
					</div>
				</fieldset>
			</div>
		</section>
	);
}

function Access() {
	const { t, me, places } = useShell();
	const role = me.member.orgRole;
	const names = new Map(places.map((p) => [p.id, p.name]));
	return (
		<section className="card">
			<h2>{t("access_title")}</h2>
			<div className="person__roles">
				{role !== "staff" ? (
					<Badge tone="brand">
						{t("access_everywhere", {
							role: t(`role_${role}_short`),
							org: me.org.name,
						})}
					</Badge>
				) : (
					me.locations.map((l) => (
						<Badge key={l.location.id}>
							{t("role_at", {
								role: t(`role_${l.role}`),
								place: names.get(l.location.id) ?? l.location.name,
							})}
						</Badge>
					))
				)}
			</div>
			<p className="muted small">
				{t(`role_desc_${role === "staff" ? "manager" : role}`)}
			</p>
			<h2 className="mt">{t("shortcuts_title")}</h2>
			<dl className="kv kv--keys">
				<dt>
					<kbd>Ctrl</kbd> <kbd>K</kbd>
				</dt>
				<dd>{t("shortcut_palette")}</dd>
				<dt>
					<kbd>Esc</kbd>
				</dt>
				<dd>{t("shortcut_close")}</dd>
			</dl>
		</section>
	);
}
