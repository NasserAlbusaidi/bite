import type { ReactNode } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useParams,
	useRouteError,
} from "react-router";
import { dir, isLang, type Lang, translator } from "./lib/i18n";
import "./styles.css";

function useLang(): Lang {
	const { lang } = useParams();
	return isLang(lang) ? lang : "en";
}

export function Layout({ children }: { children: ReactNode }) {
	const lang = useLang();
	return (
		<html lang={lang} dir={dir(lang)}>
			<head>
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, viewport-fit=cover"
				/>
				<meta name="theme-color" content="#fbf7f2" />
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

export function ErrorBoundary() {
	const error = useRouteError();
	const t = translator(useLang());
	const notFound = isRouteErrorResponse(error) && error.status === 404;
	return (
		<main className="page page--center">
			<h1>{notFound ? t("not_found_title") : t("generic_error")}</h1>
			{notFound && <p className="muted">{t("not_found_body")}</p>}
		</main>
	);
}
