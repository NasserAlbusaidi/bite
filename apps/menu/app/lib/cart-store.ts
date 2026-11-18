import { useCallback, useSyncExternalStore } from "react";
import {
	type Cart,
	type CartAction,
	cartReducer,
	EMPTY_CART,
	parseStoredCart,
} from "./cart";

/**
 * Per-location cart persisted in localStorage, so a refresh or a trip to
 * checkout and back keeps it. Server render always sees an empty cart.
 */
const storageKey = (slug: string) => `bite.cart.${slug}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; cart: Cart }>();

/** The stored cart right now, outside React (effects, event handlers). */
export function readCart(slug: string): Cart {
	return read(slug);
}

function read(slug: string): Cart {
	let raw: string | null = null;
	try {
		raw = window.localStorage.getItem(storageKey(slug));
	} catch {
		// Private mode / blocked storage: cart lives in memory only.
		return cache.get(slug)?.cart ?? EMPTY_CART;
	}
	const hit = cache.get(slug);
	if (hit && hit.raw === raw) return hit.cart;
	const cart = parseStoredCart(raw);
	cache.set(slug, { raw, cart });
	return cart;
}

function write(slug: string, cart: Cart): void {
	const raw = JSON.stringify(cart);
	cache.set(slug, { raw, cart });
	try {
		window.localStorage.setItem(storageKey(slug), raw);
	} catch {
		// Ignore: in-memory cache still holds it.
	}
	for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
	listeners.add(cb);
	const onStorage = (e: StorageEvent) => {
		if (e.key?.startsWith("bite.cart.")) cb();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", onStorage);
	};
}

export function useCart(slug: string): [Cart, (a: CartAction) => void] {
	const cart = useSyncExternalStore(
		subscribe,
		() => read(slug),
		() => EMPTY_CART,
	);
	const dispatch = useCallback(
		(a: CartAction) => write(slug, cartReducer(read(slug), a)),
		[slug],
	);
	return [cart, dispatch];
}
