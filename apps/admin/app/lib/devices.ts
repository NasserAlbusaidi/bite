import type { AdminDevice } from "./contracts";

export type DeviceState =
	| { kind: "on" }
	| { kind: "off"; minutesAgo: number }
	/** A code is out and the tablet hasn't used it yet. */
	| { kind: "waiting"; until: string }
	/** Never connected and no live code: offer one. */
	| { kind: "new" }
	| { kind: "removed" };

/** A tablet counts as working when it called in within this many minutes. */
export const ONLINE_MINUTES = 5;

/** What the owner needs to know about a tablet, in one word. */
export function deviceState(d: AdminDevice, now = Date.now()): DeviceState {
	if (d.revokedAt) return { kind: "removed" };
	const waiting =
		d.pairingExpiresAt && Date.parse(d.pairingExpiresAt) > now
			? d.pairingExpiresAt
			: null;
	if (!d.lastSeenAt)
		return waiting ? { kind: "waiting", until: waiting } : { kind: "new" };
	const mins = Math.max(
		0,
		Math.floor((now - Date.parse(d.lastSeenAt)) / 60_000),
	);
	return mins < ONLINE_MINUTES
		? { kind: "on" }
		: { kind: "off", minutesAgo: mins };
}

/**
 * "Till 2": the first free number for that kind at the branch, so a new
 * tablet never needs a name typed before it can be connected.
 */
export function nextDeviceName(
	kind: AdminDevice["kind"],
	devices: readonly AdminDevice[],
	label: (n: number) => string,
): string {
	const taken = new Set(
		devices.filter((d) => !d.revokedAt).map((d) => d.name.trim().toLowerCase()),
	);
	const sameKind = devices.filter(
		(d) => d.kind === kind && !d.revokedAt,
	).length;
	for (let n = sameKind + 1; ; n++) {
		const name = label(n);
		if (!taken.has(name.toLowerCase())) return name;
	}
}

/**
 * True once a tablet has used the code: the server clears the code and marks
 * the device seen in the same step. (Watching lastSeenAt alone would fire
 * for a working tablet that is being moved to a new one.) A code that simply
 * ran out also clears, so it only counts before `expiresAt`.
 */
export function codeUsed(
	devices: readonly AdminDevice[],
	id: string,
	expiresAt: string,
	now = Date.now(),
): boolean {
	const d = devices.find((x) => x.id === id);
	return (
		!!d &&
		!d.revokedAt &&
		!!d.lastSeenAt &&
		d.pairingExpiresAt === null &&
		now < Date.parse(expiresAt)
	);
}
