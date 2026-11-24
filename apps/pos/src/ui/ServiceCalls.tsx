import type { ServiceRequest } from "@bite/contracts";
import { Icon } from "@bite/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.js";
import { useServices } from "./services.js";

/** Fired on window when the realtime stream says the calls changed. */
export const SERVICE_EVENT = "bite:service-changed";
/** Fallback when realtime is down. */
const POLL_MS = 10_000;

/**
 * Open guest calls at this location ("call a waiter", "bring the bill"),
 * oldest first. Shape: { id, kind: "waiter" | "bill", tableLabel, createdAt, calls }.
 * Refetches on the realtime hint and every 10s.
 */
export function useServiceRequests() {
	const { api } = useServices();
	const [requests, setRequests] = useState<ServiceRequest[]>([]);
	const refresh = useCallback(async () => {
		try {
			setRequests((await api.serviceRequests()).requests);
		} catch {
			// Offline or API down: keep what's on screen, try again next tick.
		}
	}, [api]);

	useEffect(() => {
		void refresh();
		const id = setInterval(() => {
			if (document.visibilityState === "visible") void refresh();
		}, POLL_MS);
		const on = () => void refresh();
		window.addEventListener(SERVICE_EVENT, on);
		return () => {
			clearInterval(id);
			window.removeEventListener(SERVICE_EVENT, on);
		};
	}, [refresh]);

	const close = useCallback(
		async (id: string) => {
			setRequests((cur) => cur.filter((r) => r.id !== id));
			try {
				await api.closeServiceRequest(id);
			} catch {
				// Already closed elsewhere, or offline: the next refresh settles it.
			}
			void refresh();
		},
		[api, refresh],
	);

	return { requests, close };
}

/** Two short tones, so a call is heard over the room. */
function chime() {
	try {
		const ctx = new AudioContext();
		const at = ctx.currentTime;
		for (const [i, f] of [880, 1320].entries()) {
			const o = ctx.createOscillator();
			const g = ctx.createGain();
			o.frequency.value = f;
			g.gain.setValueAtTime(0.0001, at + i * 0.18);
			g.gain.exponentialRampToValueAtTime(0.25, at + i * 0.18 + 0.02);
			g.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.18 + 0.3);
			o.connect(g).connect(ctx.destination);
			o.start(at + i * 0.18);
			o.stop(at + i * 0.18 + 0.32);
		}
		setTimeout(() => void ctx.close(), 800);
	} catch {
		// No audio (autoplay policy before the first tap): the card still shows.
	}
}

/** Cards for guest calls, stacked at the bottom of the till. */
export function ServiceCalls() {
	const { t } = useI18n();
	const { requests, close } = useServiceRequests();
	const seen = useRef<Map<string, number> | null>(null);
	const [now, setNow] = useState(() => Date.now());

	// Chime on a new call, or a repeat tap on an open one.
	useEffect(() => {
		const prev = seen.current;
		const next = new Map(requests.map((r) => [r.id, r.calls]));
		if (prev && requests.some((r) => (prev.get(r.id) ?? 0) < r.calls)) chime();
		seen.current = next;
	}, [requests]);

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	if (requests.length === 0) return null;
	return (
		<section className="svc" aria-label={t("service.title")} aria-live="polite">
			{requests.map((r) => {
				const min = Math.max(
					0,
					Math.floor((now - Date.parse(r.createdAt)) / 60_000),
				);
				return (
					<article
						key={`${r.id}:${r.calls}`}
						className={`svc__card svc__card--${r.kind}`}
					>
						<Icon name={r.kind === "bill" ? "receipt" : "users"} />
						<div className="svc__text">
							<strong>
								{t(r.kind === "bill" ? "service.bill" : "service.waiter", {
									table: r.tableLabel,
								})}
							</strong>
							<span className="muted">
								{min < 1 ? t("service.now") : t("service.ago", { min })}
								{r.calls > 1
									? ` · ${t("service.again", { count: r.calls })}`
									: ""}
							</span>
						</div>
						<button
							type="button"
							className="svc__done"
							onClick={() => void close(r.id)}
						>
							<Icon name="check" />
							{t("service.done")}
						</button>
					</article>
				);
			})}
		</section>
	);
}
