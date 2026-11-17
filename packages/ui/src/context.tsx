import { createContext, type ReactNode, useContext, useMemo } from "react";
import { dirOf, type Lang, messages, type UiKey } from "./i18n";

type Ui = { lang: Lang; dir: "rtl" | "ltr"; t: (key: UiKey) => string };

const UiContext = createContext<Ui>({
	lang: "en",
	dir: "ltr",
	t: (key) => messages.en[key],
});

/**
 * Tells components which language they render in. Apps wrap their tree once.
 * Theme and density are plain attributes (data-theme, data-density) on any
 * element, so a KDS panel can be dark inside a light app.
 */
export function UiProvider({
	lang,
	children,
}: {
	lang: Lang;
	children: ReactNode;
}) {
	const value = useMemo<Ui>(
		() => ({ lang, dir: dirOf(lang), t: (key) => messages[lang][key] }),
		[lang],
	);
	return <UiContext value={value}>{children}</UiContext>;
}

export const useUi = () => useContext(UiContext);
