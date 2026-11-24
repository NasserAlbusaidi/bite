import { Icon, Logo, ToastProvider, UiProvider } from "@bite/ui";
import { useEffect, useState } from "react";
import {
	Link,
	NavLink,
	Outlet,
	redirect,
	useOutletContext,
} from "react-router";
import { account } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import { type Lang, savedLang, saveLang } from "../lib/i18n";
import { platform } from "../lib/platform";
import { type PT, platformT } from "../lib/platform-i18n";
import "../platform.css";
import type { Route } from "./+types/platform";

/**
 * Bite's own console: every business on the platform. Outside the back
 * office shell (it is not scoped to one org). The API hides it (404) from
 * anyone who is not in platform_admins.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const api = platform();
	const acc = account();
	if (!api || !acc) return { state: "no_api" as const };
	const url = new URL(request.url);
	const session = await acc.session().catch(() => null);
	if (!session)
		throw redirect(
			`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`,
		);
	try {
		const me = await api.me();
		return { state: "ok" as const, me };
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 404)
			return { state: "denied" as const, email: session.user.email };
		throw e;
	}
}

export type PlatformCtx = { t: PT; lang: Lang };
export const usePlatform = () => useOutletContext<PlatformCtx>();

export default function PlatformLayout({ loaderData }: Route.ComponentProps) {
	const [lang, setLang] = useState<Lang>(savedLang);
	const t = platformT(lang);
	useEffect(() => {
		saveLang(lang);
		document.documentElement.lang = lang;
		document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
	}, [lang]);

	if (loaderData.state !== "ok") {
		return (
			<main className="auth">
				<Logo height={36} className="brand" />
				<div className="card form auth-card">
					<h1>{t("not_admin_title")}</h1>
					<p className="muted">
						{loaderData.state === "no_api" ? t("needs_api") : t("not_admin")}
					</p>
					{loaderData.state === "denied" && (
						<p className="small muted" dir="ltr">
							{loaderData.email}
						</p>
					)}
					<div className="form-actions">
						<Link className="btn" to="/">
							Bite
						</Link>
						{loaderData.state === "denied" && (
							<button
								type="button"
								className="btn"
								onClick={async () => {
									await account()?.signOut();
									window.location.assign("/sign-in?next=/platform");
								}}
							>
								{t("sign_out")}
							</button>
						)}
					</div>
				</div>
			</main>
		);
	}
	const { me } = loaderData;
	return (
		<UiProvider lang={lang}>
			<ToastProvider>
				<div className="pf" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
					<header className="pf-bar" data-theme="light">
						<Link to="/platform" className="pf-bar__brand">
							<Logo height={22} />
							<span className="pf-bar__tag">{t("console_short")}</span>
						</Link>
						<nav className="pf-bar__nav">
							<NavLink to="/platform" end>
								<Icon name="store" />
								{t("businesses")}
							</NavLink>
							<NavLink to="/platform/new">
								<Icon name="plus" />
								{t("new_business")}
							</NavLink>
						</nav>
						<div className="pf-bar__me">
							<button
								type="button"
								className="pf-bar__btn"
								onClick={() => setLang(lang === "ar" ? "en" : "ar")}
							>
								<Icon name="globe" />
								{t("language")}
							</button>
							<span className="pf-bar__user">
								<span className="pf-bar__avatar" aria-hidden="true">
									{(me.name || me.email).slice(0, 1).toUpperCase()}
								</span>
								<span className="pf-bar__email" dir="ltr">
									{me.email}
								</span>
							</span>
							<button
								type="button"
								className="pf-bar__btn"
								onClick={async () => {
									await account()?.signOut();
									window.location.assign("/sign-in?next=/platform");
								}}
							>
								<Icon name="logout" />
								<span className="pf-bar__hide">{t("sign_out")}</span>
							</button>
						</div>
					</header>
					<main className="pf-main">
						<Outlet context={{ t, lang } satisfies PlatformCtx} />
					</main>
				</div>
			</ToastProvider>
		</UiProvider>
	);
}
