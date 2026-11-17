/**
 * Strings that ui components render themselves (close buttons, keypad keys).
 * Registered in tools/ci/check-i18n.mts. Type-only imports: Node loads this
 * file directly in CI.
 */
export type Lang = "en" | "ar";

const en = {
	close: "Close",
	dismiss: "Dismiss",
	loading: "Loading",
	notifications: "Notifications",
	keypad: "Number pad",
	keypad_backspace: "Delete last digit",
	keypad_clear: "Clear",
	decrease: "Decrease",
	increase: "Increase",
	quantity: "Quantity",
};

export type UiKey = keyof typeof en;

export const messages: Record<Lang, Record<UiKey, string>> = {
	en,
	ar: {
		close: "إغلاق",
		dismiss: "تجاهل",
		loading: "جارٍ التحميل",
		notifications: "الإشعارات",
		keypad: "لوحة الأرقام",
		keypad_backspace: "حذف آخر رقم",
		keypad_clear: "مسح",
		decrease: "إنقاص",
		increase: "زيادة",
		quantity: "الكمية",
	},
};

export const dirOf = (lang: Lang): "rtl" | "ltr" =>
	lang === "ar" ? "rtl" : "ltr";
