import type { ReactNode } from "react";
import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useRouteError,
} from "react-router";
import "@bite/ui/styles.css";
import { Logo } from "@bite/ui";
import { ErrorPanel } from "./components/ErrorPanel";
import { savedLang, translator } from "./lib/i18n";
import { BOOT_SCRIPT } from "./lib/theme";
import "./styles.css";
import "./kit.css";
import "./guests.css";

export function Layout({ children }: { children: ReactNode }) {
	return (
		<html
			lang="en"
			dir="ltr"
			data-theme="system"
			data-density="compact"
			suppressHydrationWarning
		>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="robots" content="noindex" />
				<meta name="theme-color" content="#004225" />
				<title>Bite back office</title>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string from lib/theme, no user input */}
				<script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function HydrateFallback() {
	return <p className="loading">Loading…</p>;
}

/** Only reached when the shell itself can't load, or outside it. */
export function ErrorBoundary() {
	const error = useRouteError();
	const lang = typeof window === "undefined" ? "en" : savedLang();
	return (
		<main className="auth" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
			<Logo height={36} className="brand" />
			<div className="auth-card">
				<ErrorPanel error={error} t={translator(lang)} bare />
			</div>
		</main>
	);
}
