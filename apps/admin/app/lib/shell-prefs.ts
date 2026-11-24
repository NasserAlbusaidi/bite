import { createContext, useContext } from "react";
import type { Theme } from "./theme";

/** Theme and language controls the shell owns, for pages that show them too. */
export type ShellPrefs = {
	theme: Theme;
	setTheme: (t: Theme) => void;
	toggleLang: () => void;
};

export const ShellPrefsContext = createContext<ShellPrefs | null>(null);

export function useShellPrefs(): ShellPrefs {
	const p = useContext(ShellPrefsContext);
	if (!p) throw new Error("useShellPrefs outside the shell");
	return p;
}
