import { useSyncExternalStore } from "react";
import {
	type Cart,
	type CartLine,
	type MenuIndex,
	parseStoredCart,
	validateSelection,
} from "./cart";

/**
 * What this phone remembers about its own orders at one shop: the order still
 * in progress (so the menu can point back to it) and what was ordered last
 * (so it can be ordered again in one tap). localStorage only: nothing here
 * identifies the guest to the server.
 */
export type ActiveOrder = { token: string; ticket: string; at: number };

/** An order nobody collected stops being "in progress" after this long. */
export const ACTIVE_TTL_MS = 6 * 3_600_000;
/** "Order again" is offered for this long after the last order. */
export const LAST_TTL_MS = 60 * 86_400_000;

export const activeKey = (slug: string) => `bite.order.${slug}`;
export const lastKey = (slug: string) => `bite.last.${slug}`;

/** Parse the stored order in progress; null when malformed or stale. */
export function parseActive(
	raw: string | null,
	now: number,
): ActiveOrder | null {
	if (!raw) return null;
	try {
		const d = JSON.parse(raw) as Partial<ActiveOrder> | null;
		if (
			!d ||
			typeof d.token !== "string" ||
			!/^[A-Za-z0-9_-]{8,200}$/.test(d.token) ||
			typeof d.ticket !== "string" ||
			d.ticket.length > 20 ||
			typeof d.at !== "number" ||
			now - d.at > ACTIVE_TTL_MS
		)
			return null;
		return { token: d.token, ticket: d.ticket, at: d.at };
	} catch {
		return null;
	}
}

/** Parse the stored last order; null when malformed, empty or too old. */
export function parseLast(raw: string | null, now: number): Cart | null {
	if (!raw) return null;
	try {
		const d = JSON.parse(raw) as { at?: unknown; lines?: unknown } | null;
		if (!d || typeof d.at !== "number" || now - d.at > LAST_TTL_MS) return null;
		const cart = parseStoredCart(JSON.stringify({ lines: d.lines }));
		return cart.lines.length > 0 ? cart : null;
	} catch {
		return null;
	}
}

/**
 * The lines of a past order that can still be ordered exactly as they were:
 * the product is on the menu and available, and its options still pass the
 * menu's rules. Anything else is left out rather than silently changed.
 */
export function reorderable(last: Cart, idx: MenuIndex): CartLine[] {
	return last.lines.filter((l) => {
		const p = idx.products.get(l.productId);
		return (
			!!p?.isAvailable &&
			validateSelection(p, idx, l.modifierOptionIds) === null
		);
	});
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
	listeners.add(cb);
	window.addEventListener("storage", cb);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", cb);
	};
}

function read(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Write (or with null, remove) a remembered value. Blocked storage is ignored. */
export function remember(key: string, value: unknown | null): void {
	try {
		if (value === null) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		return;
	}
	for (const l of listeners) l();
}

/** The raw stored string, null on the server and until hydrated. */
export function useRemembered(key: string): string | null {
	return useSyncExternalStore(
		subscribe,
		() => read(key),
		() => null,
	);
}

export type Step = "sent" | "paid" | "preparing" | "ready";
export type StepState = "done" | "now" | "todo";

/**
 * Where an order is, as four steps a guest can follow. Paying usually comes
 * before the kitchen starts, but a shop may cook first, so "paid" is judged
 * on its own and never blocks the later steps from showing as reached.
 */
export function orderSteps(o: {
	paymentStatus: string;
	fulfillmentStatus: string;
}): { step: Step; state: StepState }[] {
	const f = o.fulfillmentStatus;
	const paid = o.paymentStatus !== "unpaid";
	return [
		{ step: "sent", state: "done" },
		{
			step: "paid",
			state: paid ? "done" : f === "pending" ? "now" : "todo",
		},
		{
			step: "preparing",
			state:
				f === "preparing"
					? "now"
					: f === "ready" || f === "completed"
						? "done"
						: paid && f === "pending"
							? "now"
							: "todo",
		},
		{
			step: "ready",
			state: f === "ready" ? "now" : f === "completed" ? "done" : "todo",
		},
	];
}
