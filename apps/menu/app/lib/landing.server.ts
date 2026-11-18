/**
 * Copy for the public page on the bare domain. It lives on the server and
 * reaches the browser as loader data, so a guest opening a menu never
 * downloads it. Say only what the product does today: no prices, no promises.
 */
import type { Lang } from "./i18n";

type Pair = readonly [title: string, body: string];

export type LandingCopy = {
	metaTitle: string;
	metaDescription: string;
	nav: { product: string; how: string; login: string; start: string };
	/** The link to the other language, written in that language. */
	otherLang: string;
	hero: { kicker: string; title: string; lede: string };
	facts: readonly [Pair, Pair, Pair];
	/** The decorative till in the hero. */
	till: {
		order: string;
		lines: readonly [Pair, Pair, Pair];
		total: string;
		amount: string;
		charge: string;
		sent: string;
	};
	guests: {
		kicker: string;
		title: string;
		body: string;
		points: readonly Pair[];
	};
	features: {
		kicker: string;
		title: string;
		lede: string;
		items: readonly Pair[];
	};
	how: { kicker: string; title: string; steps: readonly Pair[] };
	closing: { title: string; body: string };
};

const en: LandingCopy = {
	metaTitle: "Bite: restaurant POS, kitchen display and QR menu for Oman",
	metaDescription:
		"Bite runs your till, kitchen display and QR-code menu from one place. It works offline, in Arabic and English, with OMR prices exact to the baisa.",
	nav: {
		product: "Product",
		how: "How it works",
		login: "Log in",
		start: "Create account",
	},
	otherLang: "عربي",
	hero: {
		kicker: "Restaurant POS · QR ordering · Kitchen",
		title: "Your floor, your kitchen, your menu, on one Bite.",
		lede: "Bite runs your till, your kitchen display and your QR-code menu from one place. It keeps selling when the internet drops, and every screen works in Arabic and English.",
	},
	facts: [
		["Offline", "The till keeps selling without internet."],
		["Two languages", "Arabic and English, for staff and guests."],
		["To the baisa", "OMR prices and VAT, worked out exactly."],
	],
	till: {
		order: "Takeaway · 3 items",
		lines: [
			["Halloumi wrap", "2.400"],
			["Garden bowl", "3.400"],
			["Mint lemonade", "1.800"],
		],
		total: "Total, VAT included",
		amount: "OMR 7.600",
		charge: "Charge OMR 7.600",
		sent: "Sent to kitchen",
	},
	guests: {
		kicker: "What your guests see",
		title: "A menu that takes the order for you",
		body: "Guests scan the QR code, browse in their own language and order from their phone. No app to download, nobody to flag down.",
		points: [
			["Arabic and English", "Guests switch language with one tap."],
			["Group ordering", "The whole table adds to one shared order."],
			[
				"Order tracking",
				"A private link shows each guest where their order is.",
			],
		],
	},
	features: {
		kicker: "One system, end to end",
		title: "Everything your café runs on",
		lede: "From the first tap on the menu to the cash count at close, the floor, the kitchen and the back office see the same thing.",
		items: [
			[
				"Point of sale",
				"A fast till built for the rush. Split a bill, take cash or card, count the drawer at close.",
			],
			[
				"Works offline",
				"Orders are saved on the tablet and sent when the connection is back. A bad router doesn't stop service.",
			],
			[
				"Kitchen display",
				"Paid orders show up on the kitchen screen on their own. No paper tickets, no missed extras.",
			],
			[
				"Menu and options",
				"Sizes, milks and extras, required or optional. One menu for every branch, with each branch's own prices and sold-out items.",
			],
			[
				"Offers",
				"Percent or fixed discounts on a product or a category. Happy-hour prices switch themselves on and off.",
			],
			[
				"Reports",
				"Today against yesterday, every branch side by side, best sellers, and a CSV when the accountant asks.",
			],
		],
	},
	how: {
		kicker: "Getting started",
		title: "From sign-up to first order",
		steps: [
			["Create your account", "Name your business and your first branch."],
			["Put your menu in", "Add what you sell, with prices and options."],
			[
				"Pair a tablet",
				"Scan one code from the back office and the till is ready. Staff sign in with a PIN.",
			],
			["Take orders", "At the till, or from the QR code on the table."],
		],
	},
	closing: {
		title: "Have a look around",
		body: "Create an account, put a few items in and ring up a test order. It takes a few minutes.",
	},
};

const ar: LandingCopy = {
	metaTitle: "Bite: نظام نقاط بيع وشاشة مطبخ ومنيو QR للمطاعم في عُمان",
	metaDescription:
		"Bite يدير الكاشير وشاشة المطبخ ومنيو رمز QR من مكان واحد. يعمل بلا إنترنت، بالعربية والإنجليزية، وبأسعار بالريال العُماني دقيقة إلى البيسة.",
	nav: {
		product: "المنتج",
		how: "كيف يعمل",
		login: "تسجيل الدخول",
		start: "إنشاء حساب",
	},
	otherLang: "English",
	hero: {
		kicker: "نقاط بيع للمطاعم · طلب عبر QR · المطبخ",
		title: "صالتك ومطبخك ومنيوك، كلها في Bite.",
		lede: "Bite يدير الكاشير وشاشة المطبخ ومنيو رمز QR من مكان واحد. يواصل البيع عند انقطاع الإنترنت، وكل شاشة فيه تعمل بالعربية والإنجليزية.",
	},
	facts: [
		["بلا إنترنت", "الكاشير يواصل البيع من دون اتصال."],
		["لغتان", "العربية والإنجليزية، للموظفين والضيوف."],
		["إلى البيسة", "أسعار بالريال العُماني وضريبة محسوبة بدقة."],
	],
	till: {
		order: "سفري · 3 أصناف",
		lines: [
			["راب حلّوم", "2.400"],
			["سلطة الحديقة", "3.400"],
			["ليمون بالنعناع", "1.800"],
		],
		total: "الإجمالي شامل الضريبة",
		amount: "7.600 ر.ع.",
		charge: "تحصيل 7.600 ر.ع.",
		sent: "أُرسل إلى المطبخ",
	},
	guests: {
		kicker: "ما يراه ضيوفك",
		title: "منيو يأخذ الطلب عنك",
		body: "يمسح الضيف رمز QR، يتصفح بلغته ويطلب من هاتفه. لا تطبيق للتنزيل ولا انتظار للنادل.",
		points: [
			["العربية والإنجليزية", "يبدّل الضيف اللغة بلمسة واحدة."],
			["الطلب الجماعي", "كل من على الطاولة يضيف إلى طلب واحد مشترك."],
			["تتبّع الطلب", "رابط خاص يُظهر لكل ضيف أين وصل طلبه."],
		],
	},
	features: {
		kicker: "نظام واحد من البداية إلى النهاية",
		title: "كل ما يحتاجه مقهاك",
		lede: "من أول لمسة على المنيو إلى عدّ النقد عند الإغلاق، الصالة والمطبخ والإدارة يرون الشيء نفسه.",
		items: [
			[
				"نقاط البيع",
				"كاشير سريع لساعات الذروة. قسّم الفاتورة، استلم نقدًا أو بالبطاقة، وعدّ الدرج عند الإغلاق.",
			],
			[
				"يعمل بلا إنترنت",
				"تُحفظ الطلبات على الجهاز اللوحي وتُرسل عند عودة الاتصال. انقطاع الشبكة لا يوقف الخدمة.",
			],
			[
				"شاشة المطبخ",
				"الطلبات المدفوعة تظهر على شاشة المطبخ تلقائيًا. لا تذاكر ورقية ولا إضافات منسية.",
			],
			[
				"المنيو والإضافات",
				"أحجام وأنواع حليب وإضافات، إلزامية أو اختيارية. منيو واحد لكل الفروع، ولكل فرع أسعاره وأصنافه المنتهية.",
			],
			[
				"العروض",
				"خصم بنسبة أو بمبلغ ثابت على صنف أو قسم. أسعار ساعات العروض تبدأ وتنتهي من تلقاء نفسها.",
			],
			[
				"التقارير",
				"اليوم مقابل الأمس، كل الفروع جنبًا إلى جنب، الأكثر مبيعًا، وملف CSV حين يطلبه المحاسب.",
			],
		],
	},
	how: {
		kicker: "البداية",
		title: "من التسجيل إلى أول طلب",
		steps: [
			["أنشئ حسابك", "سمِّ نشاطك التجاري وفرعك الأول."],
			["أضف المنيو", "أضف ما تبيعه مع الأسعار والإضافات."],
			[
				"اربط جهازًا لوحيًا",
				"امسح رمزًا واحدًا من لوحة الإدارة فيصبح الكاشير جاهزًا. الموظفون يدخلون برمز سري.",
			],
			["استقبل الطلبات", "على الكاشير، أو من رمز QR على الطاولة."],
		],
	},
	closing: {
		title: "جرّبه بنفسك",
		body: "أنشئ حسابًا، أضف بعض الأصناف وسجّل طلبًا تجريبيًا. يستغرق ذلك بضع دقائق.",
	},
};

export const landingCopy = (lang: Lang): LandingCopy =>
	lang === "ar" ? ar : en;

/**
 * Where the back office lives, from BITE_ADMIN_URL. Without it the page has
 * nowhere to send people, so it shows no sign-up or log-in buttons.
 */
export function adminLinks(
	base: string | undefined,
): { signUp: string; signIn: string } | null {
	if (!base || !/^https?:\/\/[^\s/]+/.test(base)) return null;
	let root = base;
	while (root.endsWith("/")) root = root.slice(0, -1);
	return {
		signUp: `${root}/sign-in?mode=signup`,
		signIn: `${root}/sign-in`,
	};
}

/**
 * The page's own public address. Behind a proxy the request arrives as plain
 * http, so trust x-forwarded-proto for the scheme.
 */
export function publicOrigin(request: Request): string {
	const url = new URL(request.url);
	const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
	if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
	return url.origin;
}

/** What search engines read. No offers: prices are not public yet. */
export function structuredData(copy: LandingCopy, url: string, lang: Lang) {
	return {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "Bite",
		applicationCategory: "BusinessApplication",
		operatingSystem: "Web, Android, iOS",
		description: copy.metaDescription,
		inLanguage: lang,
		url,
	};
}
