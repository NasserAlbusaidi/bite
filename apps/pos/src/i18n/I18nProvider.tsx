import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { DIR, type Lang, translate } from "./i18n.js";
import type { MessageKey } from "./messages.js";

type I18n = {
	lang: Lang;
	dir: "ltr" | "rtl";
	setLang: (l: Lang) => void;
	t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

const Ctx = createContext<I18n | null>(null);

export function I18nProvider(props: {
	initial: Lang;
	onChange?: (l: Lang) => void;
	children: ReactNode;
}) {
	const [lang, setLangState] = useState<Lang>(props.initial);
	const { onChange } = props;

	useEffect(() => {
		// Flip the whole document; CSS uses logical properties so layout mirrors for free.
		document.documentElement.lang = lang;
		document.documentElement.dir = DIR[lang];
	}, [lang]);

	const value = useMemo<I18n>(
		() => ({
			lang,
			dir: DIR[lang],
			setLang: (l) => {
				setLangState(l);
				onChange?.(l);
			},
			t: (key, vars) => translate(lang, key, vars),
		}),
		[lang, onChange],
	);
	return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useI18n(): I18n {
	const v = useContext(Ctx);
	if (!v) throw new Error("useI18n outside I18nProvider");
	return v;
}
