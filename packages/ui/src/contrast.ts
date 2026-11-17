import { brand } from "./tokens";

/** "#RRGGBB" or "#RGB" → [r, g, b] 0–255. Null if it isn't a hex colour. */
export function parseHex(hex: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m?.[1]) return null;
	const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
	return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [
		number,
		number,
		number,
	];
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
	const rgb = parseHex(hex);
	if (!rgb) throw new RangeError(`Not a hex colour: ${hex}`);
	const [r, g, b] = rgb.map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const AA_TEXT = 4.5;

export type TenantAccent = {
	/** CSS custom properties to set on the menu's root element. */
	vars: Record<string, string>;
	/** False when the shop's colour couldn't be used and Bite lime stands in. */
	usable: boolean;
};

/**
 * A shop's brand colour for the guest menu. The button text colour is picked
 * automatically (forest-dark or white, whichever reads better). If neither
 * reaches AA, the colour is rejected and Bite's own lime is used, so a shop
 * can't ship an unreadable "Add" button. Links fall back to the theme's link
 * colour when the accent is too light to read as text on white.
 */
export function tenantAccent(hex: string | null | undefined): TenantAccent {
	const fallback: TenantAccent = { vars: {}, usable: false };
	if (!hex || !parseHex(hex)) return fallback;
	const color = `#${(parseHex(hex) as number[]).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
	const dark = brand.charcoal;
	const onDark = contrast(color, dark);
	const onWhite = contrast(color, brand.white);
	const on = onDark >= onWhite ? dark : brand.white;
	if (Math.max(onDark, onWhite) < AA_TEXT) return fallback;
	const vars: Record<string, string> = {
		"--action": color,
		// Hover moves away from the text colour, so contrast only improves.
		"--action-hover": `color-mix(in srgb, ${color} 88%, ${on === dark ? "#fff" : "#000"})`,
		"--on-action": on,
	};
	if (onWhite >= AA_TEXT) vars["--link"] = color;
	return { vars, usable: true };
}
