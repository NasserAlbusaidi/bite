import type { LocalizedText as Localized } from "./contracts";

export const LANGS = ["en", "ar"] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(v: unknown): v is Lang {
	return v === "en" || v === "ar";
}

export function dir(lang: Lang): "ltr" | "rtl" {
	return lang === "ar" ? "rtl" : "ltr";
}

/** Pick a language from an Accept-Language header. Defaults to English. */
export function negotiateLang(header: string | null): Lang {
	if (!header) return "en";
	const ranked = header
		.split(",")
		.map((part) => {
			const [tag = "", ...params] = part.trim().split(";");
			const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
			const weight = q ? Number(q.slice(2)) : 1;
			return {
				tag: tag.toLowerCase(),
				weight: Number.isNaN(weight) ? 0 : weight,
			};
		})
		.filter((x) => x.weight > 0)
		.sort((a, b) => b.weight - a.weight);
	for (const { tag } of ranked) {
		const base = tag.split("-")[0];
		if (isLang(base)) return base;
	}
	return "en";
}

/** Localized menu text, falling back to English. */
export function loc(text: Localized, lang: Lang): string {
	return (lang === "ar" && text.ar) || text.en;
}

// Copy carried over from the legacy guest menu (lang/{en,ar}/guest.php).
const en = {
	choose_language: "Choose your language",
	status_open: "Open now",
	status_closed: "Closed for online orders",
	search_menu: "Search the menu…",
	category_all: "All",
	no_items_available: "No items available",
	no_items_hint: "Check back soon, the menu is being updated.",
	no_search_results: "No items match your search.",
	sold_out: "Sold out",
	on_sale: "On sale",
	add_to_order: "Add to order",
	add_item_aria: "Add {name} to order",
	view_cart: "View cart",
	your_order: "Your order",
	cart_empty_title: "Your order is empty",
	cart_empty_body: "Browse the menu and tap + to start your order.",
	browse_menu: "Browse the menu",
	decrease_qty: "Decrease quantity",
	increase_qty: "Increase quantity",
	remove_item: "Remove item",
	required: "Required",
	optional: "Optional",
	up_to: "up to {count}",
	select_at_least: "Select at least {count} for {group}.",
	select_at_most: "Select at most {count} for {group}.",
	item_note_label: "Special request",
	item_note_placeholder: "Less salt, no nuts, allergy note…",
	order_note_label: "Note for the kitchen",
	order_note_placeholder: "Anything for the whole order? Allergy, timing…",
	your_name: "Your name",
	name_placeholder: "e.g. Layla",
	phone_label: "Phone (optional)",
	phone_hint: "for order updates and points",
	invalid_phone: "Enter a valid phone number.",
	name_required: "Please enter your name.",
	subtotal: "Subtotal",
	discount: "Discount",
	tax: "Tax",
	tax_included: "incl. tax",
	total: "Total",
	estimated: "Estimated",
	place_order: "Place order",
	pay_at_counter_hint:
		"Pay at the counter when you collect, cash or card. The kitchen starts once payment is confirmed.",
	shop_closed:
		"This restaurant is currently closed for online orders. Please check back during opening hours.",
	items_unavailable:
		"Sorry, some items are no longer available. We marked them below, remove them to continue.",
	invalid_modifiers:
		"Some options are no longer valid. Please re-add the item.",
	rate_limited:
		"You're ordering too quickly. Please wait a moment and try again.",
	idempotency_conflict:
		"This checkout was already used for a different order. Please refresh and try again.",
	total_too_high:
		"Your order total is too high to place online. Please order at the counter.",
	generic_error: "Something went wrong. Please try again.",
	order_placed: "Order placed",
	ticket: "Ticket",
	track_show_counter: "Show this at the counter",
	back_to_menu: "Back to menu",
	status_unpaid: "Waiting for payment. Please pay at the counter.",
	status_paid: "Payment confirmed. Your order is in the kitchen queue.",
	status_preparing: "The kitchen is preparing your order.",
	status_ready: "Your order is ready, collect it from the counter.",
	status_completed: "Order collected. Enjoy!",
	status_cancelled: "This order was cancelled.",
	not_found_title: "Menu not found",
	not_found_body: "Scan the QR code at the restaurant to open its menu.",
	powered_by: "Powered by Bite",
	order_type: "Order type",
	dine_in: "Dine in",
	takeaway: "Take away",
	remove_unavailable: "Remove unavailable items",
	unavailable_tag: "Unavailable",
	placing: "Placing order…",
	you_save: "You save",
	order_together: "Order together",
	order_together_hint:
		"Everyone at the table adds their own items, one order goes to the kitchen.",
	group_order: "Group order",
	people_count: "{count} ordering together",
	share_link: "Share link",
	link_copied: "Link copied",
	share_group_desc:
		"Send this link to the people at your table so you can order together.",
	group_expires_hint: "The link expires in two hours.",
	join_group_title: "Join the group order",
	join: "Join",
	start: "Start",
	you: "You",
	host: "Host",
	group_cart: "Group cart",
	no_items_yet: "No items yet",
	lock_checkout: "Checkout for the group",
	back_to_editing: "Back to editing",
	group_locked: "{host} is checking out. Changes are paused.",
	group_locked_host: "Changes are paused while you check out.",
	group_submitted: "The group order was sent.",
	view_order: "View order",
	group_expired: "This group order has expired or doesn't exist.",
	group_not_open: "This group order is no longer open for changes.",
	group_empty: "Add at least one item before checking out.",
	place_group_order: "Place group order",
} as const;

export type MessageKey = keyof typeof en;

const ar: Record<MessageKey, string> = {
	choose_language: "اختر لغتك",
	status_open: "مفتوح الآن",
	status_closed: "مغلق للطلبات عبر الإنترنت",
	search_menu: "ابحث في القائمة…",
	category_all: "الكل",
	no_items_available: "لا توجد عناصر متاحة",
	no_items_hint: "تحقق قريباً، يتم تحديث القائمة.",
	no_search_results: "لا توجد عناصر تطابق بحثك.",
	sold_out: "نفذ",
	on_sale: "عرض",
	add_to_order: "أضف إلى الطلب",
	add_item_aria: "أضف {name} إلى الطلب",
	view_cart: "عرض السلة",
	your_order: "طلبك",
	cart_empty_title: "سلتك فارغة",
	cart_empty_body: "تصفّح القائمة واضغط + لبدء طلبك.",
	browse_menu: "تصفّح القائمة",
	decrease_qty: "إنقاص الكمية",
	increase_qty: "زيادة الكمية",
	remove_item: "إزالة العنصر",
	required: "مطلوب",
	optional: "اختياري",
	up_to: "حتى {count}",
	select_at_least: "اختر على الأقل {count} لـ {group}.",
	select_at_most: "اختر كحد أقصى {count} لـ {group}.",
	item_note_label: "طلب خاص",
	item_note_placeholder: "ملح أقل، بدون مكسرات، ملاحظة تحسس…",
	order_note_label: "ملاحظة للمطبخ",
	order_note_placeholder: "أي ملاحظة لكامل الطلب؟ تحسس، توقيت…",
	your_name: "اسمك",
	name_placeholder: "مثال: ليلى",
	phone_label: "الهاتف (اختياري)",
	phone_hint: "لتحديثات الطلب والنقاط",
	invalid_phone: "أدخل رقم هاتف صحيح.",
	name_required: "يرجى إدخال اسمك.",
	subtotal: "المجموع الفرعي",
	discount: "الخصم",
	tax: "الضريبة",
	tax_included: "شامل الضريبة",
	total: "الإجمالي",
	estimated: "تقديري",
	place_order: "تأكيد الطلب",
	pay_at_counter_hint:
		"ادفع عند الكاونتر عند الاستلام، نقداً أو بالبطاقة. يبدأ المطبخ بعد تأكيد الدفع.",
	shop_closed:
		"المطعم مغلق حالياً للطلبات عبر الإنترنت. يرجى المحاولة خلال ساعات العمل.",
	items_unavailable:
		"عذراً، بعض العناصر لم تعد متاحة. حددناها أدناه، أزلها للمتابعة.",
	invalid_modifiers: "بعض الخيارات لم تعد صالحة. يرجى إعادة إضافة العنصر.",
	rate_limited:
		"أنت تطلب بسرعة كبيرة. يرجى الانتظار لحظة ثم المحاولة مرة أخرى.",
	idempotency_conflict:
		"تم استخدام طلب الدفع هذا لطلب مختلف. يرجى التحديث والمحاولة مرة أخرى.",
	total_too_high:
		"إجمالي طلبك مرتفع جداً ولا يمكن إرساله عبر الإنترنت. يرجى الطلب عند الكاونتر.",
	generic_error: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
	order_placed: "تم إرسال الطلب",
	ticket: "رقم الطلب",
	track_show_counter: "أظهر هذا عند الكاونتر",
	back_to_menu: "العودة إلى القائمة",
	status_unpaid: "بانتظار تأكيد الدفع. يرجى الدفع عند الكاونتر.",
	status_paid: "تم تأكيد الدفع. دخل الطلب إلى قائمة المطبخ.",
	status_preparing: "المطبخ يحضّر طلبك حالياً.",
	status_ready: "طلبك جاهز، استلمه من الكاونتر.",
	status_completed: "تم استلام الطلب. بالعافية!",
	status_cancelled: "تم إلغاء هذا الطلب.",
	not_found_title: "القائمة غير موجودة",
	not_found_body: "امسح رمز QR في المطعم لفتح القائمة.",
	powered_by: "مدعوم بواسطة Bite",
	order_type: "نوع الطلب",
	dine_in: "تناول في المطعم",
	takeaway: "سفري",
	remove_unavailable: "إزالة العناصر غير المتاحة",
	unavailable_tag: "غير متاح",
	placing: "جارٍ إرسال الطلب…",
	you_save: "وفّرت",
	order_together: "اطلبوا معاً",
	order_together_hint:
		"كل شخص على الطاولة يضيف طلبه، ويصل طلب واحد إلى المطبخ.",
	group_order: "طلب جماعي",
	people_count: "{count} يطلبون معاً",
	share_link: "مشاركة الرابط",
	link_copied: "تم النسخ!",
	share_group_desc: "أرسل هذا الرابط لمن معك على الطاولة للطلب معاً.",
	group_expires_hint: "ينتهي هذا الرابط خلال ساعتين.",
	join_group_title: "انضم إلى الطلب الجماعي",
	join: "انضمام",
	start: "ابدأ",
	you: "أنت",
	host: "المضيف",
	group_cart: "سلة المجموعة",
	no_items_yet: "لا توجد عناصر بعد",
	lock_checkout: "إتمام طلب المجموعة",
	back_to_editing: "العودة للتعديل",
	group_locked: "{host} يُتم الطلب الآن. التعديلات متوقفة مؤقتاً.",
	group_locked_host: "التعديلات متوقفة أثناء إتمامك للطلب.",
	group_submitted: "تم إرسال الطلب الجماعي.",
	view_order: "عرض الطلب",
	group_expired: "انتهت صلاحية هذا الطلب الجماعي أو أنه غير موجود.",
	group_not_open: "هذا الطلب الجماعي لم يعد مفتوحاً للتعديل.",
	group_empty: "أضف عنصراً واحداً على الأقل قبل الإتمام.",
	place_group_order: "إرسال الطلب الجماعي",
};

const messages: Record<Lang, Record<MessageKey, string>> = { en, ar };

export type T = (
	key: MessageKey,
	params?: Record<string, string | number>,
) => string;

export function translator(lang: Lang): T {
	const dict = messages[lang];
	return (key, params) => {
		const s = dict[key];
		if (!params) return s;
		return s.replace(/\{(\w+)\}/g, (m, name: string) =>
			name in params ? String(params[name]) : m,
		);
	};
}
