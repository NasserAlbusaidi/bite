import {
	Form,
	Link,
	redirect,
	useNavigation,
	useSearchParams,
} from "react-router";
import { saveOrg } from "../lib/account";
import { account } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import { AuthFrame, useAuthLang } from "../lib/auth-page";
import type { MessageKey } from "../lib/i18n";
import type { Route } from "./+types/accept-invite";

/**
 * Landing page for a staff invite link. New people create their login here;
 * existing logins sign in. Then the invite is claimed and they land in the
 * back office of that org.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const acc = account();
	const token = new URL(request.url).searchParams.get("token") ?? "";
	if (!acc) return { demo: true as const, token, email: null };
	const s = await acc.session().catch(() => null);
	return { demo: false as const, token, email: s?.user.email ?? null };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const acc = account();
	if (!acc) return redirect("/");
	const f = await request.formData();
	const token = new URL(request.url).searchParams.get("token") ?? "";
	const intent = String(f.get("intent") ?? "accept");
	const fail = (error: MessageKey) => ({ error });
	if (intent === "signout") {
		await acc.signOut().catch(() => undefined);
		return null;
	}
	try {
		if (intent === "signup")
			await acc.signUp(
				String(f.get("name") ?? "").trim(),
				String(f.get("email") ?? "").trim(),
				String(f.get("password") ?? ""),
			);
		else if (intent === "signin")
			await acc.signIn(
				String(f.get("email") ?? "").trim(),
				String(f.get("password") ?? ""),
			);
	} catch (e) {
		if (!(e instanceof AdminApiError) || e.status >= 500) throw e;
		return fail(intent === "signup" ? "email_taken_sign_in" : "wrong_login");
	}
	try {
		const r = await acc.acceptInvite(token);
		saveOrg(r.orgId);
	} catch (e) {
		if (!(e instanceof AdminApiError) || e.status >= 500) throw e;
		if (e.status === 403) return fail("invite_other_email");
		return fail("invite_expired");
	}
	return redirect("/");
}

export default function AcceptInvite({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useAuthLang();
	const [params] = useSearchParams();
	const busy = useNavigation().state !== "idle";
	const haveAccount = params.get("mode") === "signin";
	const error = actionData?.error;
	const other = new URLSearchParams(params);
	if (haveAccount) other.delete("mode");
	else other.set("mode", "signin");

	if (loaderData.demo)
		return (
			<AuthFrame title={t("join_team")}>
				<p className="muted">{t("demo_no_invites")}</p>
				<Link className="btn" to="/">
					{t("done")}
				</Link>
			</AuthFrame>
		);
	if (!loaderData.token)
		return (
			<AuthFrame title={t("join_team")}>
				<p className="error">{t("invite_expired")}</p>
			</AuthFrame>
		);

	const errorLine = error && (
		<span className="error small" role="alert">
			{t(error)}
		</span>
	);

	if (loaderData.email)
		return (
			<AuthFrame title={t("join_team")}>
				<p>{t("join_as", { email: loaderData.email })}</p>
				{errorLine}
				<Form method="post" className="form-actions">
					<button
						type="submit"
						name="intent"
						value="accept"
						className="btn btn--primary"
						disabled={busy}
					>
						{t("accept_invite")}
					</button>
					<button
						type="submit"
						name="intent"
						value="signout"
						className="btn"
						disabled={busy}
					>
						{t("not_you")}
					</button>
				</Form>
			</AuthFrame>
		);

	return (
		<AuthFrame title={t("join_team")}>
			<p className="muted small">
				{haveAccount ? t("invite_sign_in_hint") : t("invite_sign_up_hint")}
			</p>
			<Form method="post" className="form">
				<input
					type="hidden"
					name="intent"
					value={haveAccount ? "signin" : "signup"}
				/>
				{!haveAccount && (
					<label>
						{t("your_name")}
						<input
							name="name"
							className="input"
							autoComplete="name"
							required
							maxLength={80}
						/>
					</label>
				)}
				<label>
					{t("email")}
					<input
						name="email"
						type="email"
						className="input"
						dir="ltr"
						autoComplete="email"
						required
					/>
				</label>
				<label>
					{t("password")}
					<input
						name="password"
						type="password"
						className="input"
						dir="ltr"
						autoComplete={haveAccount ? "current-password" : "new-password"}
						minLength={haveAccount ? undefined : 10}
						required
					/>
					{!haveAccount && (
						<span className="muted small">{t("password_hint")}</span>
					)}
				</label>
				{errorLine}
				<button type="submit" className="btn btn--primary" disabled={busy}>
					{haveAccount ? t("sign_in_and_join") : t("create_and_join")}
				</button>
			</Form>
			<Link to={`?${other.toString()}`} className="small">
				{haveAccount ? t("need_account") : t("have_account")}
			</Link>
		</AuthFrame>
	);
}
