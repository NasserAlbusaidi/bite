import type { ToastTone } from "@bite/ui";

type Flash = { message: string; tone: ToastTone };
let pending: Flash | undefined;

/**
 * A toast that survives a redirect: an action sets it, the shell shows it
 * once the next page has rendered.
 */
export function flash(message: string, tone: ToastTone = "success"): void {
	pending = { message, tone };
}

export function takeFlash(): Flash | undefined {
	const f = pending;
	pending = undefined;
	return f;
}

const EVENT = "bite:toast";

/** A toast right now, from code outside the toast provider (the shell). */
export function toastNow(message: string, tone: ToastTone = "success"): void {
	window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

export function onToastNow(fn: (f: Flash) => void): () => void {
	const h = (e: Event) => fn((e as CustomEvent<Flash>).detail);
	window.addEventListener(EVENT, h);
	return () => window.removeEventListener(EVENT, h);
}
