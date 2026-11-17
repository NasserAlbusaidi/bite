import type { Place } from "./places";

const KEY = "bite.admin.location";

/** The location the manager is working on. Remembered per browser. */
export function selectedLocationId(
	places: readonly Place[],
): string | undefined {
	let saved: string | null = null;
	try {
		saved = window.localStorage.getItem(KEY);
	} catch {
		saved = null;
	}
	return places.find((l) => l.id === saved)?.id ?? places[0]?.id;
}

export function rememberLocation(id: string): void {
	try {
		window.localStorage.setItem(KEY, id);
	} catch {
		// ignore
	}
}
