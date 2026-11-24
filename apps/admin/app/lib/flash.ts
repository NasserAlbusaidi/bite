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
