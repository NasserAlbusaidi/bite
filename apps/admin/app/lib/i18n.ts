/**
 * Back office copy. English and Arabic are both first class (CI checks every
 * key exists in both). Imports types only: CI loads this file with Node.
 */
import type { LocalizedText } from "@bite/contracts";

export type Lang = "en" | "ar";

const en = {
	menu: "Menu",
	prices_availability: "Prices & availability",
	location: "Location",
	demo_banner: "Demo data: changes stay in this browser.",
	language: "عربي",
	loading: "Loading…",
	something_wrong: "Something went wrong",
	search: "Search products…",
	new_product: "New product",
	edit: "Edit",
	save: "Save",
	saving: "Saving…",
	saved: "Saved",
	cancel: "Cancel",
	archive: "Archive",
	archive_confirm:
		"Archive {name}? It disappears from every menu. Past orders keep it.",
	hidden: "Hidden",
	no_products: "No products in this category yet.",
	categories: "Categories",
	new_category: "New category",
	category_name_en: "Name (English)",
	category_name_ar: "Name (Arabic)",
	add_category: "Add category",
	inactive: "Inactive",
	product: "Product",
	name_en: "Name (English)",
	name_ar: "Name (Arabic)",
	description_en: "Description (English)",
	description_ar: "Description (Arabic)",
	category: "Category",
	base_price: "Base price ({currency})",
	base_price_hint:
		"Used at every location unless a location sets its own price.",
	tax_override: "VAT rate override (%)",
	tax_override_hint:
		"Leave empty to use the location's rate. 0 means zero-rated.",
	image_url: "Image URL",
	visible: "Show on menus",
	modifier_groups: "Modifier groups",
	sort_order: "Sort order",
	required_field: "Required.",
	invalid_price: "Enter an amount like 1.250 (at most {decimals} decimals).",
	invalid_rate: "Enter a rate between 0 and 100 with at most 2 decimals.",
	overrides_title: "Prices & availability at {location}",
	overrides_hint:
		"Set a price for this location only, or mark an item sold out (86). Empty price = base price.",
	org_price: "Base",
	location_price: "Price here",
	available: "Available",
	sold_out: "Sold out",
	reset: "Reset",
	modifiers_count: "{count} modifier groups",
	min_max: "choose {min}–{max}",
} as const;

export type MessageKey = keyof typeof en;

const ar: Record<MessageKey, string> = {
	menu: "القائمة",
	prices_availability: "الأسعار والتوفر",
	location: "الفرع",
	demo_banner: "بيانات تجريبية: التغييرات تبقى في هذا المتصفح فقط.",
	language: "English",
	loading: "جارٍ التحميل…",
	something_wrong: "حدث خطأ ما",
	search: "ابحث عن منتج…",
	new_product: "منتج جديد",
	edit: "تعديل",
	save: "حفظ",
	saving: "جارٍ الحفظ…",
	saved: "تم الحفظ",
	cancel: "إلغاء",
	archive: "أرشفة",
	archive_confirm:
		"أرشفة {name}؟ سيختفي من جميع القوائم، وتبقى الطلبات السابقة كما هي.",
	hidden: "مخفي",
	no_products: "لا توجد منتجات في هذا القسم بعد.",
	categories: "الأقسام",
	new_category: "قسم جديد",
	category_name_en: "الاسم (إنجليزي)",
	category_name_ar: "الاسم (عربي)",
	add_category: "إضافة قسم",
	inactive: "غير مفعّل",
	product: "المنتج",
	name_en: "الاسم (إنجليزي)",
	name_ar: "الاسم (عربي)",
	description_en: "الوصف (إنجليزي)",
	description_ar: "الوصف (عربي)",
	category: "القسم",
	base_price: "السعر الأساسي ({currency})",
	base_price_hint: "يُستخدم في كل الفروع ما لم يحدد الفرع سعراً خاصاً.",
	tax_override: "نسبة ضريبة خاصة (%)",
	tax_override_hint: "اتركه فارغاً لاستخدام نسبة الفرع. صفر يعني معفى.",
	image_url: "رابط الصورة",
	visible: "إظهار في القوائم",
	modifier_groups: "مجموعات الإضافات",
	sort_order: "الترتيب",
	required_field: "مطلوب.",
	invalid_price: "أدخل مبلغاً مثل 1.250 (بحد أقصى {decimals} منازل عشرية).",
	invalid_rate: "أدخل نسبة بين 0 و100 بحد أقصى منزلتين عشريتين.",
	overrides_title: "الأسعار والتوفر في {location}",
	overrides_hint:
		"حدد سعراً لهذا الفرع فقط، أو اجعل المنتج نافداً. السعر الفارغ = السعر الأساسي.",
	org_price: "الأساسي",
	location_price: "السعر هنا",
	available: "متوفر",
	sold_out: "نفذ",
	reset: "إعادة تعيين",
	modifiers_count: "{count} مجموعات إضافات",
	min_max: "اختر {min}–{max}",
};

export const messages: Record<Lang, Record<MessageKey, string>> = { en, ar };

export type T = (
	key: MessageKey,
	params?: Record<string, string | number>,
) => string;

export function translator(lang: Lang): T {
	const dict = messages[lang];
	return (key, params) =>
		params
			? dict[key].replace(/\{(\w+)\}/g, (m, n: string) =>
					n in params ? String(params[n]) : m,
				)
			: dict[key];
}

export const loc = (text: LocalizedText, lang: Lang) =>
	(lang === "ar" && text.ar) || text.en;

const KEY = "bite.admin.lang";

export function savedLang(): Lang {
	try {
		const v = window.localStorage.getItem(KEY);
		if (v === "en" || v === "ar") return v;
	} catch {
		// ignore
	}
	return typeof navigator !== "undefined" && navigator.language.startsWith("ar")
		? "ar"
		: "en";
}

export function saveLang(lang: Lang): void {
	try {
		window.localStorage.setItem(KEY, lang);
	} catch {
		// ignore
	}
	document.documentElement.lang = lang;
	document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
