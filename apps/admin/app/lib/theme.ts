/** Light, dark or follow the device. Remembered per browser. */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];
const KEY = "bite.admin.theme";

export function savedTheme(): Theme {
	try {
		const v = window.localStorage.getItem(KEY);
		if (v === "light" || v === "dark" || v === "system") return v;
	} catch {
		// ignore
	}
	return "system";
}

export function applyTheme(theme: Theme): void {
	try {
		window.localStorage.setItem(KEY, theme);
	} catch {
		// ignore
	}
	document.documentElement.dataset.theme = theme;
}

export const nextTheme = (t: Theme): Theme =>
	THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] ?? "system";

/**
 * Runs in <head> before the app loads, so a dark or Arabic page doesn't flash
 * light and left-to-right first. Must stay self-contained (it's inlined).
 */
export const BOOT_SCRIPT = `try{var d=document.documentElement,s=localStorage,t=s.getItem("${KEY}");if(t==="light"||t==="dark")d.dataset.theme=t;var l=s.getItem("bite.admin.lang");if(l==="ar"){d.lang="ar";d.dir="rtl"}}catch(e){}`;
