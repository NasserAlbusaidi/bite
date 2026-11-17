import { type ReactNode, useEffect } from "react";
import { type Lang, savedLang, saveLang, translator } from "./i18n";

/** Pages outside the shell (sign-in, org picker, invites) share this frame. */
export function useAuthLang() {
	const lang: Lang = typeof window === "undefined" ? "en" : savedLang();
	useEffect(() => saveLang(lang), [lang]);
	return { lang, t: translator(lang) };
}

export function AuthFrame({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<main className="auth">
			<p className="brand">Bite</p>
			<div className="card form auth-card">
				<h1>{title}</h1>
				{children}
			</div>
		</main>
	);
}
