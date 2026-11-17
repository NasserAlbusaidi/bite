import {
	Form,
	Link,
	redirect,
	useNavigation,
	useSearchParams,
} from "react-router";
import { safeNext } from "../lib/account";
import { account } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import { AuthFrame, useAuthLang } from "../lib/auth-page";
import type { MessageKey } from "../lib/i18n";
import type { Route } from "./+types/sign-in";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const acc = account();
	const next = safeNext(new URL(request.url).searchParams.get("next"));
	// Demo mode has no logins.
	if (!acc) throw redirect("/");
	const s = await acc.session().catch(() => null);
	if (s) throw redirect(next);
	return null;
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const acc = account();
	if (!acc) return redirect("/");
	const f = await request.formData();
	const next = safeNext(new URL(request.url).searchParams.get("next"));
	const email = String(f.get("email") ?? "").trim();
	const password = String(f.get("password") ?? "");
	const name = String(f.get("name") ?? "").trim();
	const signUp = f.get("mode") === "signup";
	try {
		if (signUp) await acc.signUp(name, email, password);
		else await acc.signIn(email, password);
	} catch (e) {
		if (!(e instanceof AdminApiError) || e.status >= 500) throw e;
		const key: MessageKey = signUp
			? e.status === 422 || e.code === "USER_ALREADY_EXISTS"
				? "email_taken"
				: "sign_up_failed"
			: "wrong_login";
		return { error: key };
	}
	return redirect(next);
}

export default function SignIn({ actionData }: Route.ComponentProps) {
	const { t } = useAuthLang();
	const [params] = useSearchParams();
	const signUp = params.get("mode") === "signup";
	const busy = useNavigation().state !== "idle";
	const other = new URLSearchParams(params);
	if (signUp) other.delete("mode");
	else other.set("mode", "signup");
	return (
		<AuthFrame title={signUp ? t("create_account") : t("sign_in_action")}>
			<Form method="post" className="form">
				<input type="hidden" name="mode" value={signUp ? "signup" : "signin"} />
				{signUp && (
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
						autoComplete={signUp ? "new-password" : "current-password"}
						minLength={signUp ? 10 : undefined}
						required
					/>
					{signUp && <span className="muted small">{t("password_hint")}</span>}
				</label>
				{actionData?.error && (
					<span className="error small" role="alert">
						{t(actionData.error)}
					</span>
				)}
				<button type="submit" className="btn btn--primary" disabled={busy}>
					{signUp ? t("create_account") : t("sign_in_action")}
				</button>
			</Form>
			<Link to={`?${other.toString()}`} className="small">
				{signUp ? t("have_account") : t("need_account")}
			</Link>
		</AuthFrame>
	);
}
