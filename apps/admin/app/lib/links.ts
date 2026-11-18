/**
 * Addresses the back office hands to other devices: the API a tablet pairs
 * with, and the guest menu a QR sticker opens.
 */

const trim = (u: string) => u.replace(/\/+$/, "");

/**
 * The API address a tablet should use. Normally where this page's API lives.
 * VITE_PAIRING_API_URL overrides it for setups where tablets reach the API
 * somewhere else (local dev: the POS dev server's own https address).
 */
export function pairingServerUrl(): string {
	const forced = import.meta.env.VITE_PAIRING_API_URL as string | undefined;
	if (forced) return trim(forced);
	const api = import.meta.env.VITE_API_URL as string | undefined;
	return new URL(api || "/", window.location.origin).origin;
}

/**
 * Where guests open a location's menu, or null when the menu's address is
 * not configured (VITE_MENU_URL). The menu redirects /{slug} to the guest's
 * language, so stickers never need reprinting for that.
 */
export function guestMenuUrl(slug: string): string | null {
	const base = import.meta.env.VITE_MENU_URL as string | undefined;
	return base ? `${trim(base)}/${encodeURIComponent(slug)}` : null;
}
