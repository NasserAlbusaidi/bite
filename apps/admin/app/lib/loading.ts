/**
 * When each loading treatment shows. Pure, so it is unit tested without a DOM.
 *
 * - Nothing for the first 300 ms: most loads finish sooner, and a flash of
 *   animation feels slower than nothing.
 * - "thread": the thin lime line on top (and the old page dims).
 * - "bite": after 1.5 s a page load also shows the Bite logo being eaten.
 *   Saves never get it: the form stays on screen with its busy button.
 * - "slow": after 8 s a page load says so and offers Retry. Saves don't,
 *   because retrying a save could send it twice.
 * - "fast" pages (where speed matters during service: live orders, cash
 *   drawers) never get the Bite logo over them, only the thread, and a small
 *   Retry bar after 8 s.
 */
export const THREAD_AFTER_MS = 300;
export const BITE_AFTER_MS = 1500;
export const SLOW_AFTER_MS = 8000;
/** Once something shows, keep it at least this long so it never just blinks. */
export const MIN_VISIBLE_MS = 400;

export type LoadKind = "page" | "fast" | "save";

/** Pages people use mid-service, where the lime line is all they get. */
const FAST_PAGES = ["/orders", "/drawers"];

export function isSpeedCritical(pathname: string): boolean {
	return FAST_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
export type LoadPhase = "idle" | "thread" | "bite" | "slow";

export function loadingPhase(elapsedMs: number, kind: LoadKind): LoadPhase {
	if (elapsedMs < THREAD_AFTER_MS) return "idle";
	if (kind === "save") return "thread";
	if (elapsedMs >= SLOW_AFTER_MS) return "slow";
	return kind === "page" && elapsedMs >= BITE_AFTER_MS ? "bite" : "thread";
}

/** The next moment the phase can change, or null when it can't any more. */
export function nextPhaseAt(elapsedMs: number, kind: LoadKind): number | null {
	const steps =
		kind === "save"
			? [THREAD_AFTER_MS]
			: kind === "fast"
				? [THREAD_AFTER_MS, SLOW_AFTER_MS]
				: [THREAD_AFTER_MS, BITE_AFTER_MS, SLOW_AFTER_MS];
	return steps.find((s) => s > elapsedMs) ?? null;
}

/** How much longer a treatment that appeared at `shownAt` must stay up. */
export function holdFor(shownAt: number | null, now: number): number {
	if (shownAt === null) return 0;
	return Math.max(0, MIN_VISIBLE_MS - (now - shownAt));
}

/**
 * What kind of load React Router is doing. A GET form (filters, search, date
 * range) loads a page; any other method is a save. A save that then sends you
 * to another page (signing in, picking a business, creating something) counts
 * as a page load once it is on its way there. Background refreshes
 * (useRevalidator) are not navigations, so they stay silent.
 */
export function navigationKind(
	nav: {
		state: "idle" | "loading" | "submitting";
		formMethod?: string | undefined;
		location?: { pathname: string } | undefined;
	},
	currentPath?: string,
): LoadKind | null {
	if (nav.state === "idle") return null;
	const method = nav.formMethod?.toUpperCase();
	if (!method || method === "GET") return "page";
	const leaving =
		nav.state === "loading" &&
		currentPath !== undefined &&
		nav.location !== undefined &&
		nav.location.pathname !== currentPath;
	return leaving ? "page" : "save";
}
