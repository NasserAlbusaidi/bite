import { useCallback, useSyncExternalStore } from "react";

/**
 * Who this browser is in a group cart. The secret is shown once by the API
 * and only lives here; losing it means joining again under a new name.
 */
export type GroupIdentity = { participantId: string; secret: string };

const key = (token: string) => `bite.group.${token}`;
const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();

function readRaw(token: string): string | null {
	try {
		return window.localStorage.getItem(key(token));
	} catch {
		return memory.get(token) ?? null;
	}
}

const cache = new Map<
	string,
	{ raw: string | null; value: GroupIdentity | null }
>();

function read(token: string): GroupIdentity | null {
	const raw = readRaw(token);
	const hit = cache.get(token);
	if (hit && hit.raw === raw) return hit.value;
	let value: GroupIdentity | null = null;
	try {
		const v = raw ? (JSON.parse(raw) as Partial<GroupIdentity>) : null;
		if (
			v &&
			typeof v.participantId === "string" &&
			typeof v.secret === "string"
		) {
			value = { participantId: v.participantId, secret: v.secret };
		}
	} catch {
		value = null;
	}
	cache.set(token, { raw, value });
	return value;
}

export function saveGroupIdentity(
	token: string,
	id: GroupIdentity | null,
): void {
	const raw = id ? JSON.stringify(id) : null;
	memory.set(token, raw);
	try {
		if (raw) window.localStorage.setItem(key(token), raw);
		else window.localStorage.removeItem(key(token));
	} catch {
		// memory fallback above
	}
	for (const l of listeners) l();
}

function subscribe(cb: () => void) {
	listeners.add(cb);
	return () => {
		listeners.delete(cb);
	};
}

export function useGroupIdentity(
	token: string,
): [GroupIdentity | null, (id: GroupIdentity | null) => void] {
	const id = useSyncExternalStore(
		subscribe,
		() => read(token),
		() => null,
	);
	const save = useCallback(
		(v: GroupIdentity | null) => saveGroupIdentity(token, v),
		[token],
	);
	return [id, save];
}
