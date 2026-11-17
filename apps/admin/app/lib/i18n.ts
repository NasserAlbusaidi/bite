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
	promotions: "Promotions",
	promotions_hint:
		"Discounts the POS and guest menu apply automatically. The highest priority match wins.",
	new_promotion: "New promotion",
	no_promotions: "No promotions yet.",
	promotion: "Promotion",
	promotion_name: "Name (staff only)",
	active: "Active",
	paused: "Paused",
	applies_at: "Applies at",
	all_locations: "All locations",
	discount_kind: "Discount",
	kind_percent: "Percent off",
	kind_fixed: "Amount off ({currency})",
	discount_value: "Value",
	invalid_percent: "Enter a percent between 0.01 and 100.",
	applies_to: "Applies to",
	everything: "Everything",
	products: "Products",
	priority: "Priority",
	priority_hint: "Higher wins when two promotions match the same item.",
	starts_on: "Starts on",
	ends_on: "Ends on",
	end_before_start: "Ends before it starts.",
	daily_from: "Daily from",
	daily_to: "Daily until",
	daily_hint: "Optional happy hour. Can run past midnight.",
	hours_pair: "Set both times, or neither.",
	days: "Days",
	days_hint: "None ticked = every day.",
	day_0: "Sun",
	day_1: "Mon",
	day_2: "Tue",
	day_3: "Wed",
	day_4: "Thu",
	day_5: "Fri",
	day_6: "Sat",
	percent_off: "{value}% off",
	amount_off: "{value} off",
	save_failed: "The server rejected this. Check the fields and try again.",
	staff: "Staff",
	staff_hint:
		"Managers and admins sign in to this back office. Floor staff use a PIN on the tablet.",
	invite_manager: "Invite a manager",
	add_pin_staff: "Add floor staff",
	name: "Name",
	access: "Access",
	sign_in: "Sign-in",
	login: "Login",
	pin: "PIN",
	invite_pending: "Invite pending",
	deactivated: "Deactivated",
	org_owner: "Owner (everything)",
	org_admin: "Admin (everything)",
	org_staff: "Per location",
	role_manager: "Manager",
	role_cashier: "Cashier",
	role_server: "Server",
	role_kitchen: "Kitchen",
	role_at: "{role} at {place}",
	invite_hint:
		"They get an email link to set a password. Give location roles below, or make them an admin.",
	pin_staff_hint:
		"No email or password. They sign in on the tablet with this PIN.",
	email: "Email",
	invalid_email: "Enter a valid email.",
	email_taken: "Someone with this email is already on the team.",
	pin_hint: "4 to 8 digits. Tell them in person.",
	invalid_pin: "Use 4 to 8 digits.",
	org_access: "Access level",
	admin_all_locations: "Admins manage every location and all settings.",
	location_access: "Location roles",
	no_access: "No access",
	pick_a_location: "Give at least one location role.",
	send_invite: "Send invite",
	deactivate: "Deactivate",
	deactivate_confirm:
		"Deactivate {name}? They can't sign in or use their PIN any more. Their past orders stay.",
	new_pin: "New PIN",
	reset_pin: "Reset PIN",
	pin_updated: "PIN updated.",
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
	promotions: "العروض",
	promotions_hint:
		"خصومات يطبّقها نظام نقاط البيع وقائمة الضيوف تلقائياً. العرض ذو الأولوية الأعلى هو الذي يُطبَّق.",
	new_promotion: "عرض جديد",
	no_promotions: "لا توجد عروض بعد.",
	promotion: "العرض",
	promotion_name: "الاسم (للموظفين فقط)",
	active: "مفعّل",
	paused: "متوقف",
	applies_at: "يُطبَّق في",
	all_locations: "كل الفروع",
	discount_kind: "الخصم",
	kind_percent: "نسبة مئوية",
	kind_fixed: "مبلغ ثابت ({currency})",
	discount_value: "القيمة",
	invalid_percent: "أدخل نسبة بين 0.01 و100.",
	applies_to: "يشمل",
	everything: "كل المنتجات",
	products: "المنتجات",
	priority: "الأولوية",
	priority_hint: "الأعلى يُطبَّق عندما يتطابق عرضان على نفس المنتج.",
	starts_on: "يبدأ في",
	ends_on: "ينتهي في",
	end_before_start: "تاريخ الانتهاء قبل البداية.",
	daily_from: "يومياً من",
	daily_to: "يومياً حتى",
	daily_hint: "ساعة سعيدة اختيارية. يمكن أن تمتد بعد منتصف الليل.",
	hours_pair: "حدّد الوقتين معاً أو اتركهما فارغين.",
	days: "الأيام",
	days_hint: "بدون تحديد = كل الأيام.",
	day_0: "الأحد",
	day_1: "الاثنين",
	day_2: "الثلاثاء",
	day_3: "الأربعاء",
	day_4: "الخميس",
	day_5: "الجمعة",
	day_6: "السبت",
	percent_off: "خصم {value}٪",
	amount_off: "خصم {value}",
	save_failed: "رفض الخادم هذا الطلب. راجع الحقول وحاول مرة أخرى.",
	staff: "الموظفون",
	staff_hint:
		"المديرون والمسؤولون يسجّلون الدخول إلى لوحة الإدارة هذه. موظفو الصالة يستخدمون رمزاً سرياً على الجهاز اللوحي.",
	invite_manager: "دعوة مدير",
	add_pin_staff: "إضافة موظف صالة",
	name: "الاسم",
	access: "الصلاحيات",
	sign_in: "تسجيل الدخول",
	login: "حساب",
	pin: "الرمز السري",
	invite_pending: "الدعوة معلّقة",
	deactivated: "معطّل",
	org_owner: "المالك (كل شيء)",
	org_admin: "مسؤول (كل شيء)",
	org_staff: "حسب الفرع",
	role_manager: "مدير",
	role_cashier: "كاشير",
	role_server: "نادل",
	role_kitchen: "مطبخ",
	role_at: "{role} في {place}",
	invite_hint:
		"سيصله رابط بالبريد لتعيين كلمة المرور. حدّد أدواره في الفروع أدناه، أو اجعله مسؤولاً.",
	pin_staff_hint:
		"بدون بريد أو كلمة مرور. يسجّل الدخول على الجهاز اللوحي بهذا الرمز.",
	email: "البريد الإلكتروني",
	invalid_email: "أدخل بريداً إلكترونياً صحيحاً.",
	email_taken: "يوجد شخص بهذا البريد في الفريق بالفعل.",
	pin_hint: "من 4 إلى 8 أرقام. أخبره بها شخصياً.",
	invalid_pin: "استخدم من 4 إلى 8 أرقام.",
	org_access: "مستوى الصلاحية",
	admin_all_locations: "المسؤولون يديرون كل الفروع وكل الإعدادات.",
	location_access: "الأدوار في الفروع",
	no_access: "بدون صلاحية",
	pick_a_location: "حدّد دوراً واحداً على الأقل في أحد الفروع.",
	send_invite: "إرسال الدعوة",
	deactivate: "تعطيل",
	deactivate_confirm:
		"تعطيل {name}؟ لن يتمكن من تسجيل الدخول أو استخدام رمزه بعد الآن. طلباته السابقة تبقى.",
	new_pin: "رمز سري جديد",
	reset_pin: "تغيير الرمز",
	pin_updated: "تم تحديث الرمز.",
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
