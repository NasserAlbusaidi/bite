import { useEffect, useState } from "react";
import { isRouteErrorResponse } from "react-router";

/**
 * True when a request failed because the phone has no connection (a fetch
 * that never got a response), not for an HTTP error, a 404 or a redirect.
 * Guests are on café wifi: a blip must never replace the page with an error.
 */
export function isNetworkError(e: unknown): boolean {
	if (e instanceof Response || isRouteErrorResponse(e)) return false;
	if (e instanceof TypeError) return true;
	return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Live navigator.onLine (true during SSR). */
export function useOnline(): boolean {
	const [online, setOnline] = useState(true);
	useEffect(() => {
		const update = () => setOnline(navigator.onLine);
		update();
		window.addEventListener("online", update);
		window.addEventListener("offline", update);
		return () => {
			window.removeEventListener("online", update);
			window.removeEventListener("offline", update);
		};
	}, []);
	return online;
}

/** What a client action returns instead of throwing when the request never left the phone. */
export type OfflineResult = { offline: true; lineIds: string[] };
export const OFFLINE: OfflineResult = { offline: true, lineIds: [] };
export const isOffline = (v: unknown): v is OfflineResult =>
	typeof v === "object" && v !== null && "offline" in v;
