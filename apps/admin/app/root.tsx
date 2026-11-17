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
	const message = isRouteErrorResponse(error)
		? `${error.status} ${error.statusText}`
		: error instanceof Error
			? error.message
			: "Something went wrong";
	return (
		<main className="content">
			<h1>Something went wrong</h1>
			<p className="muted">{message}</p>
		</main>
	);
}
