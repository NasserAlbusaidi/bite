import { tenantAccent, UiProvider } from "@bite/ui";
import "@bite/ui/styles.css";
import type { ReactNode } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLocation,
	useMatches,
	useParams,
	useRouteError,
} from "react-router";
import { dir, isLang, type Lang, translator } from "./lib/i18n";
import { useOnline } from "./lib/offline";
import "./styles.css";

function useLang(): Lang {
	const { lang } = useParams();
	const { pathname } = useLocation();
	if (isLang(lang)) return lang;
	// Bite's own page in Arabic is the one address with no :lang in it.
	return pathname === "/ar" || pathname === "/ar/" ? "ar" : "en";
}

/** The shop's brand colour, from whichever route loaded the location. */
function useShopAccent(): React.CSSProperties | undefined {
	const matches = useMatches();
	for (const m of matches) {
		const data = m.loaderData as
			| { location?: { theme?: { accent?: string } } }
			| undefined;
		const accent = data?.location?.theme?.accent;
		if (accent) return tenantAccent(accent).vars as React.CSSProperties;
	}
	return undefined;
}

export function Layout({ children }: { children: ReactNode }) {
	const lang = useLang();
	const accent = useShopAccent();
	return (
		<html lang={lang} dir={dir(lang)} data-theme="system">
			<head>
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, viewport-fit=cover"
				/>
				<meta name="theme-color" content="#004225" />
				<Meta />
				<Links />
			</head>
			<body style={accent}>
				<UiProvider lang={lang}>{children}</UiProvider>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

function OfflineBanner() {
	const online = useOnline();
	const t = translator(useLang());
	if (online) return null;
	return (
		<p className="offline-banner" role="status">
			{t("offline_banner")}
		</p>
	);
}

export default function App() {
	return (
		<>
			<OfflineBanner />
			<Outlet />
		</>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	const t = translator(useLang());
	const notFound = isRouteErrorResponse(error) && error.status === 404;
	return (
		<main className="page page--center">
			<h1>{notFound ? t("not_found_title") : t("generic_error")}</h1>
			{notFound ? (
				<p className="muted">{t("not_found_body")}</p>
			) : (
				<button
					type="button"
					className="btn btn--primary"
					onClick={() => window.location.reload()}
				>
					{t("try_again")}
				</button>
			)}
		</main>
	);
}
