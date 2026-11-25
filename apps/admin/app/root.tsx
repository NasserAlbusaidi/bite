import { type ReactNode, useSyncExternalStore } from "react";
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
import { BiteLoader } from "./components/BiteLoader";
import { ErrorPanel } from "./components/ErrorPanel";
import { RootLoading } from "./components/RouteLoading";
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

const noSubscribe = () => () => {};
/** The saved language, but "en" while hydrating the prerendered page. */
function useLang() {
	return useSyncExternalStore(
		noSubscribe,
		() => savedLang(),
		() => "en" as const,
	);
}

export default function App() {
	const lang = useLang();
	return (
		<>
			<RootLoading lang={lang} t={translator(lang)} />
			<Outlet />
		</>
	);
}

const BOOT_CSS =
	'.boot__lang[lang="ar"],:root[lang="ar"] .boot__lang[lang="en"]{display:none}:root[lang="ar"] .boot__lang[lang="ar"]{display:block}';

/**
 * First open: prerendered into index.html, so it plays before the app's code
 * loads. Both scripts are in the page; the boot script sets <html lang> before
 * first paint and CSS shows the matching one, so Arabic never flashes English.
 */
export function HydrateFallback() {
	return (
		<main className="boot">
			{/* Inline so it works before the stylesheet arrives. */}
			<style>{BOOT_CSS}</style>
			<div className="boot__lang" lang="en" dir="ltr">
				<BiteLoader script="latin" label={translator("en")("loading")} />
			</div>
			<div className="boot__lang" lang="ar" dir="rtl">
				<BiteLoader script="arabic" label={translator("ar")("loading")} />
			</div>
		</main>
	);
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
