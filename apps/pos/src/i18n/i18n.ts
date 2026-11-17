import { ar } from "./ar.js";
import { en, type MessageKey } from "./en.js";

export type Lang = "en" | "ar";
export const DIR: Record<Lang, "ltr" | "rtl"> = { en: "ltr", ar: "rtl" };

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, ar };

/** Pure translate: no React, so ticket builders and tests can use it too. */
export function translate(
	lang: Lang,
	key: MessageKey,
	vars?: Record<string, string | number>,
): string {
	const template = DICTS[lang][key] ?? en[key];
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (m, name: string) =>
		name in vars ? String(vars[name]) : m,
	);
}
