import type { ReactNode } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useRouteError,
} from "react-router";
import "@bite/ui/styles.css";
import { AdminApiError } from "./lib/api-types";
import { translator } from "./lib/i18n";
import "./styles.css";

export function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" dir="ltr" data-theme="system" data-density="compact">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="robots" content="noindex" />
				<meta name="theme-color" content="#004225" />
				<title>Bite back office</title>
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

export function ErrorBoundary() {
	const error = useRouteError();
	const forbidden =
		(isRouteErrorResponse(error) && error.status === 403) ||
		(error instanceof AdminApiError && error.status === 403);
	const t = translator(
		typeof document !== "undefined" && document.documentElement.lang === "ar"
			? "ar"
			: "en",
	);
	const message = forbidden
		? t("forbidden_page")
		: isRouteErrorResponse(error)
			? `${error.status} ${error.statusText}`
			: error instanceof Error
				? error.message
				: "";
	return (
		<main className="content">
			<h1>{forbidden ? t("forbidden_page") : "Something went wrong"}</h1>
			{!forbidden && message && <p className="muted">{message}</p>}
			<button
				type="button"
				className="btn"
				onClick={() => window.history.back()}
			>
				{t("back_home")}
			</button>
		</main>
	);
}
