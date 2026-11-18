import { isRouteErrorResponse, Link } from "react-router";
import { AdminApiError } from "../lib/api-types";
import type { MessageKey, T } from "../lib/i18n";

export type ErrorKind = "not_found" | "forbidden" | "offline" | "broken";

/** Sort whatever was thrown into the four things a person can act on. */
export function errorKind(error: unknown): ErrorKind {
	const status = isRouteErrorResponse(error)
		? error.status
		: error instanceof AdminApiError
			? error.status
			: undefined;
	if (status === 404) return "not_found";
	if (status === 403) return "forbidden";
	// fetch() rejects with a TypeError when the network is gone or the API is down.
	if (error instanceof TypeError) return "offline";
	if (typeof navigator !== "undefined" && navigator.onLine === false)
		return "offline";
	return "broken";
}

const COPY: Record<ErrorKind, { title: MessageKey; body: MessageKey }> = {
	not_found: { title: "error_404_title", body: "error_404_body" },
	forbidden: { title: "error_403_title", body: "forbidden_page" },
	offline: { title: "error_offline_title", body: "error_offline_body" },
	broken: { title: "error_500_title", body: "error_500_body" },
};

/**
 * What went wrong, in words, with a way out. Used inside the shell (the
 * navigation stays) and on its own when the shell itself could not load.
 */
export function ErrorPanel({
	error,
	t,
	bare = false,
}: {
	error: unknown;
	t: T;
	/** Already inside a card: don't draw a second one. */
	bare?: boolean;
}) {
	const kind = errorKind(error);
	const copy = COPY[kind];
	const retry = kind === "offline" || kind === "broken";
	return (
		<section className={bare ? "error-panel" : "card error-panel"}>
			<p className="error-panel__code" aria-hidden="true">
				{kind === "not_found" ? "404" : kind === "forbidden" ? "403" : "!"}
			</p>
			<h1 className="error-panel__title">{t(copy.title)}</h1>
			<p className="error-panel__text muted">{t(copy.body)}</p>
			<div className="actions-row">
				{retry && (
					<button
						type="button"
						className="btn btn--primary"
						onClick={() => window.location.reload()}
					>
						{t("try_again")}
					</button>
				)}
				<Link className={retry ? "btn" : "btn btn--primary"} to="/">
					{t("error_go_home")}
				</Link>
			</div>
			{/* The raw message helps a developer and nobody else. */}
			{import.meta.env.DEV && error instanceof Error && (
				<pre className="error-panel__raw" dir="ltr">
					{error.message}
				</pre>
			)}
		</section>
	);
}
