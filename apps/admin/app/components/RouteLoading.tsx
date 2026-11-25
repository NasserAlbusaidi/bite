import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPath, useLocation, useNavigation } from "react-router";
import type { Script } from "../lib/bite-loader";
import type { Lang, translator } from "../lib/i18n";
import {
	holdFor,
	isSpeedCritical,
	type LoadKind,
	type LoadPhase,
	loadingPhase,
	navigationKind,
	nextPhaseAt,
} from "../lib/loading";
import { BiteLoader } from "./BiteLoader";

/* ---------- Who draws it: the shell when it is on screen, else the root ---------- */

let shells = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
	listeners.add(fn);
	return () => listeners.delete(fn);
};
const emit = () => {
	for (const fn of listeners) fn();
};

/** The shell calls this so the root-level loader stands down while it's up. */
export function useOwnLoading() {
	useEffect(() => {
		shells++;
		emit();
		return () => {
			shells--;
			emit();
		};
	}, []);
}

function useShellUp() {
	return useSyncExternalStore(
		subscribe,
		() => shells > 0,
		() => false,
	);
}

/* ---------- Timing ---------- */

export type LoadingState = {
	phase: LoadPhase;
	/** The load finished and the thread is running out to the end. */
	finishing: boolean;
	kind: LoadKind | null;
	/** Address to reload on Retry. */
	target: string;
};

/**
 * Follows React Router's navigation (plus any `extra` load the caller tracks,
 * like switching branch) and says which treatment to show right now.
 */
export function useRouteLoading(extra: LoadKind | null = null): LoadingState {
	const nav = useNavigation();
	const here = useLocation();
	const target = nav.location
		? createPath(nav.location)
		: here.pathname + here.search;
	const raw = navigationKind(nav, here.pathname) ?? extra;
	const kind: LoadKind | null =
		raw === "page" && isSpeedCritical(nav.location?.pathname ?? here.pathname)
			? "fast"
			: raw;
	const [phase, setPhase] = useState<LoadPhase>("idle");
	const [finishing, setFinishing] = useState(false);
	const shownAt = useRef<number | null>(null);
	const shownKind = useRef<LoadKind | null>(null);
	// When this load began. A save that turns into a page load (it redirects
	// elsewhere) keeps its clock, so the thread doesn't restart.
	const startedAt = useRef<number | null>(null);
	if (kind && startedAt.current === null) startedAt.current = performance.now();
	if (!kind) startedAt.current = null;

	useEffect(() => {
		if (!kind) return;
		const start = startedAt.current ?? performance.now();
		shownKind.current = kind;
		setFinishing(false);
		let timer: number | undefined;
		const tick = () => {
			const elapsed = performance.now() - start;
			const next = loadingPhase(elapsed, kind);
			if (next !== "idle" && shownAt.current === null)
				shownAt.current = performance.now();
			setPhase(next);
			const at = nextPhaseAt(elapsed, kind);
			if (at !== null) timer = window.setTimeout(tick, at - elapsed);
		};
		tick();
		return () => window.clearTimeout(timer);
	}, [kind]);

	useEffect(() => {
		if (kind || phase === "idle") return;
		// Done: let it be seen for the minimum, run the thread out, then hide.
		const wait = holdFor(shownAt.current, performance.now());
		const t1 = window.setTimeout(() => setFinishing(true), wait);
		const t2 = window.setTimeout(() => {
			setPhase("idle");
			setFinishing(false);
			shownAt.current = null;
			shownKind.current = null;
		}, wait + 320);
		return () => {
			window.clearTimeout(t1);
			window.clearTimeout(t2);
		};
	}, [kind, phase]);

	return { phase, finishing, kind: kind ?? shownKind.current, target };
}

/* ---------- What it looks like ---------- */

export function LoadingLayer({
	state,
	scope,
	lang,
	t,
}: {
	state: LoadingState;
	scope: "shell" | "root";
	lang: Lang;
	t: ReturnType<typeof translator>;
}) {
	const { phase, finishing, target, kind } = state;
	if (phase === "idle") return null;
	const script: Script = lang === "ar" ? "arabic" : "latin";
	const slow = phase === "slow";
	const retry = (
		<button
			type="button"
			className="btn"
			onClick={() => window.location.assign(target)}
		>
			{t("try_again")}
		</button>
	);
	// Speed-critical pages keep their content in view: just a small bar.
	if (kind === "fast")
		return (
			<>
				<div
					className="route-thread"
					data-scope={scope}
					data-done={finishing || undefined}
					aria-hidden="true"
				/>
				{slow && !finishing && (
					<div className="route-slow" role="status" data-scope={scope}>
						<span>{t("loading_slow")}</span>
						{retry}
					</div>
				)}
			</>
		);
	return (
		<>
			<div
				className="route-thread"
				data-scope={scope}
				data-done={finishing || undefined}
				aria-hidden="true"
			/>
			{(phase === "bite" || slow) && !finishing && (
				<div className="route-bite" data-scope={scope}>
					<BiteLoader
						script={script}
						label={slow ? t("loading_slow") : t("loading")}
						action={slow && retry}
					/>
				</div>
			)}
		</>
	);
}

/** Loading outside the shell: sign-in, choosing a business, invites, platform. */
export function RootLoading({
	lang,
	t,
}: {
	lang: Lang;
	t: ReturnType<typeof translator>;
}) {
	const state = useRouteLoading();
	const shellUp = useShellUp();
	if (shellUp) return null;
	return <LoadingLayer state={state} scope="root" lang={lang} t={t} />;
}
