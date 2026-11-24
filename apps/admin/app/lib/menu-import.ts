import { fromDecimal } from "./money";

/**
 * Menu creator: turn pasted text (or a spreadsheet's CSV) into categories and
 * products. One format everywhere, so templates are just text too:
 *
 *   # Coffee | قهوة
 *   Flat white | 1.600 | فلات وايت
 *   Karak, 0.400, Strong tea with cardamom
 *
 * A line starting with # (or ending with :) starts a category. Product lines
 * split on | , ; or tab: the Arabic-script field is the Arabic name, the
 * number is the price, the first other field is the English name and the
 * next one its description. A CSV with a header row (category, name, name_ar,
 * price, description…) is read by column instead.
 */

export type ImportProduct = {
	line: number;
	nameEn: string;
	nameAr: string | null;
	/** True when nameAr came from the suggestion list, not the text. */
	arSuggested: boolean;
	descriptionEn: string | null;
	/** Minor units; null when missing or unreadable. */
	price: number | null;
};
export type ImportCategory = {
	nameEn: string;
	nameAr: string | null;
	products: ImportProduct[];
};
export type ImportIssue = { line: number; kind: "no_price" | "no_name" };
export type ImportResult = {
	categories: ImportCategory[];
	issues: ImportIssue[];
	productCount: number;
};

const ARABIC = /[؀-ۿ]/;
const isArabic = (s: string) => ARABIC.test(s);

/** Arabic-Indic and Persian digits → ASCII; Arabic decimal mark → ".". */
export function asciiDigits(s: string): string {
	return s
		.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
		.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
		.replace(/٫/g, ".");
}

/** "1.600", "1.6 OMR", "ر.ع 0.400", "٠٫٤٠٠" → the number text, else null. */
function priceText(field: string): string | null {
	const s = asciiDigits(field)
		.replace(/\b(omr|ro|bd|bhd|aed|sar|qar|kwd|usd)\b/gi, "")
		.replace(/ر\.?ع\.?/g, "")
		.trim();
	return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

const splitFields = (line: string) =>
	line
		.split(/\t|\||;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
		.map((f) =>
			f
				.trim()
				.replace(/^"(.*)"$/, "$1")
				.trim(),
		)
		.filter((f) => f !== "");

const HEADER_KEYS: Record<string, keyof Row> = {
	category: "category",
	section: "category",
	name: "nameEn",
	name_en: "nameEn",
	"name (en)": "nameEn",
	english: "nameEn",
	item: "nameEn",
	product: "nameEn",
	name_ar: "nameAr",
	"name (ar)": "nameAr",
	arabic: "nameAr",
	price: "price",
	description: "descriptionEn",
	description_en: "descriptionEn",
	category_ar: "categoryAr",
};
type Row = {
	category: string;
	categoryAr: string;
	nameEn: string;
	nameAr: string;
	price: string;
	descriptionEn: string;
};

function headerMap(line: string): (keyof Row | null)[] | null {
	const cols = line.split(/\t|,|;/).map((c) => c.trim().toLowerCase());
	const map = cols.map((c) => HEADER_KEYS[c] ?? null);
	return map.includes("nameEn") && map.includes("price") ? map : null;
}

export function parseMenuText(
	text: string,
	decimals: number,
	opts: { suggestArabic?: boolean } = {},
): ImportResult {
	const lines = text.split(/\r?\n/);
	const categories: ImportCategory[] = [];
	const issues: ImportIssue[] = [];
	const byName = new Map<string, ImportCategory>();
	let current: ImportCategory | null = null;

	const category = (en: string, ar: string | null) => {
		const key = en.toLowerCase();
		let c = byName.get(key);
		if (!c) {
			c = { nameEn: en, nameAr: ar, products: [] };
			byName.set(key, c);
			categories.push(c);
		} else if (!c.nameAr && ar) c.nameAr = ar;
		return c;
	};
	const add = (
		c: ImportCategory | null,
		line: number,
		nameEn: string,
		nameAr: string | null,
		price: string | null,
		descriptionEn: string | null,
	) => {
		if (!nameEn) {
			issues.push({ line, kind: "no_name" });
			return;
		}
		const target = c ?? category("Menu", "القائمة");
		const p = price === null ? null : fromDecimal(price, decimals);
		if (p === null) issues.push({ line, kind: "no_price" });
		let ar = nameAr;
		let arSuggested = false;
		if (!ar && opts.suggestArabic) {
			ar = suggestArabic(nameEn);
			arSuggested = ar !== null;
		}
		target.products.push({
			line,
			nameEn,
			nameAr: ar,
			arSuggested,
			descriptionEn,
			price: p,
		});
	};

	const firstReal = lines.findIndex((l) => l.trim() !== "");
	const header = firstReal >= 0 ? headerMap(lines[firstReal] ?? "") : null;
	if (header) {
		for (let i = firstReal + 1; i < lines.length; i++) {
			const raw = lines[i]?.trim() ?? "";
			if (!raw) continue;
			const cells = raw.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((f) =>
				f
					.trim()
					.replace(/^"(.*)"$/, "$1")
					.trim(),
			);
			const row: Partial<Row> = {};
			header.forEach((k, n) => {
				if (k && cells[n]) row[k] = cells[n];
			});
			const c = row.category
				? category(row.category, row.categoryAr || null)
				: null;
			add(
				c,
				i + 1,
				row.nameEn ?? "",
				row.nameAr || null,
				row.price ? priceText(row.price) : null,
				row.descriptionEn || null,
			);
		}
		return { categories, issues, productCount: count(categories) };
	}

	lines.forEach((rawLine, i) => {
		const line = rawLine.trim();
		if (!line) return;
		const heading = line.startsWith("#")
			? line.replace(/^#+/, "").trim()
			: line.endsWith(":") && !/\d/.test(line)
				? line.slice(0, -1).trim()
				: null;
		if (heading !== null) {
			const parts = heading
				.split("|")
				.map((s) => s.trim())
				.filter(Boolean);
			const en = parts.find((p) => !isArabic(p)) ?? parts[0] ?? "";
			const ar = parts.find((p) => isArabic(p)) ?? null;
			if (en) current = category(en, ar);
			return;
		}
		const fields = splitFields(line.replace(/^[-*•]\s*/, ""));
		let price: string | null = null;
		let nameAr: string | null = null;
		const rest: string[] = [];
		for (const f of fields) {
			const pt = priceText(f);
			if (pt !== null && price === null) price = pt;
			else if (isArabic(f) && nameAr === null) nameAr = f;
			else rest.push(f);
		}
		add(current, i + 1, rest[0] ?? "", nameAr, price, rest[1] ?? null);
	});
	return { categories, issues, productCount: count(categories) };
}

const count = (cs: ImportCategory[]) =>
	cs.reduce((n, c) => n + c.products.length, 0);

/**
 * Arabic names for common Gulf café and restaurant items. Whole names only:
 * word-by-word translation gets Arabic word order wrong ("iced latte" is
 * "لاتيه مثلج"). Anything not listed stays for the owner to fill in.
 */
const AR: Record<string, string> = {
	coffee: "قهوة",
	tea: "شاي",
	karak: "كرك",
	"karak tea": "شاي كرك",
	espresso: "إسبريسو",
	"double espresso": "إسبريسو مزدوج",
	americano: "أمريكانو",
	cappuccino: "كابتشينو",
	latte: "لاتيه",
	"iced latte": "لاتيه مثلج",
	"spanish latte": "سبانش لاتيه",
	"iced spanish latte": "سبانش لاتيه مثلج",
	"flat white": "فلات وايت",
	cortado: "كورتادو",
	macchiato: "ماكياتو",
	mocha: "موكا",
	"hot chocolate": "شوكولاتة ساخنة",
	"turkish coffee": "قهوة تركية",
	"arabic coffee": "قهوة عربية",
	"omani kahwa": "قهوة عمانية",
	v60: "في 60",
	"cold brew": "كولد برو",
	"iced americano": "أمريكانو مثلج",
	"green tea": "شاي أخضر",
	"mint tea": "شاي بالنعناع",
	"saffron tea": "شاي بالزعفران",
	water: "ماء",
	"mineral water": "مياه معدنية",
	"sparkling water": "مياه فوارة",
	"orange juice": "عصير برتقال",
	"fresh orange juice": "عصير برتقال طازج",
	"lemon mint": "ليمون بالنعناع",
	"mango juice": "عصير مانجو",
	"apple juice": "عصير تفاح",
	"watermelon juice": "عصير بطيخ",
	"strawberry juice": "عصير فراولة",
	"avocado juice": "عصير أفوكادو",
	smoothie: "سموذي",
	milkshake: "ميلك شيك",
	"chocolate milkshake": "ميلك شيك شوكولاتة",
	croissant: "كرواسون",
	"butter croissant": "كرواسون بالزبدة",
	"cheese croissant": "كرواسون بالجبن",
	"zaatar croissant": "كرواسون بالزعتر",
	"chocolate croissant": "كرواسون بالشوكولاتة",
	"pain au chocolat": "خبز بالشوكولاتة",
	muffin: "مافن",
	"blueberry muffin": "مافن بالتوت الأزرق",
	cookie: "كوكيز",
	brownie: "براوني",
	cheesecake: "تشيز كيك",
	"date cake": "كيكة التمر",
	"chocolate cake": "كيكة الشوكولاتة",
	"carrot cake": "كيكة الجزر",
	"red velvet": "ريد فيلفت",
	kunafa: "كنافة",
	knafeh: "كنافة",
	luqaimat: "لقيمات",
	"omani halwa": "حلوى عمانية",
	halwa: "حلوى",
	baklava: "بقلاوة",
	"ice cream": "آيس كريم",
	sandwich: "ساندويتش",
	"club sandwich": "كلوب ساندويتش",
	"halloumi sandwich": "ساندويتش حلومي",
	"chicken sandwich": "ساندويتش دجاج",
	"egg sandwich": "ساندويتش بيض",
	shakshuka: "شكشوكة",
	"avocado toast": "توست الأفوكادو",
	omelette: "أومليت",
	"cheese omelette": "أومليت بالجبن",
	pancakes: "بان كيك",
	"french toast": "فرنش توست",
	"chicken shawarma": "شاورما دجاج",
	"meat shawarma": "شاورما لحم",
	shawarma: "شاورما",
	falafel: "فلافل",
	hummus: "حمص",
	"chicken machboos": "مكبوس دجاج",
	"meat machboos": "مكبوس لحم",
	machboos: "مكبوس",
	shuwa: "شوا",
	mishkak: "مشكاك",
	biryani: "برياني",
	"chicken biryani": "برياني دجاج",
	"grilled chicken": "دجاج مشوي",
	burger: "برجر",
	"beef burger": "برجر لحم",
	"chicken burger": "برجر دجاج",
	"cheese burger": "برجر بالجبن",
	cheeseburger: "تشيز برجر",
	fries: "بطاطس مقلية",
	"french fries": "بطاطس مقلية",
	salad: "سلطة",
	"greek salad": "سلطة يونانية",
	"caesar salad": "سلطة سيزر",
	fattoush: "فتوش",
	tabbouleh: "تبولة",
	soup: "شوربة",
	"lentil soup": "شوربة عدس",
	pizza: "بيتزا",
	"margherita pizza": "بيتزا مارغريتا",
	pasta: "باستا",
	"sourdough bread": "خبز العجين المخمر",
	sourdough: "خبز العجين المخمر",
	"country sourdough": "خبز العجين المخمر",
	baguette: "باغيت",
	bagel: "بيغل",
	breakfast: "الفطور",
	drinks: "المشروبات",
	"hot drinks": "مشروبات ساخنة",
	"cold drinks": "مشروبات باردة",
	juices: "العصائر",
	"fresh juices": "عصائر طازجة",
	desserts: "الحلويات",
	sweets: "الحلويات",
	pastries: "المعجنات",
	bakery: "المخبوزات",
	breads: "الخبز",
	cakes: "الكيك",
	sandwiches: "الساندويتشات",
	salads: "السلطات",
	mains: "الأطباق الرئيسية",
	"main dishes": "الأطباق الرئيسية",
	starters: "المقبلات",
	appetizers: "المقبلات",
	sides: "الأطباق الجانبية",
	burgers: "البرجر",
	grills: "المشاوي",
	kids: "الأطفال",
	"kids menu": "قائمة الأطفال",
	extras: "الإضافات",
	"coffee & tea": "قهوة وشاي",
	"coffee and tea": "قهوة وشاي",
};

export function suggestArabic(nameEn: string): string | null {
	const key = nameEn
		.toLowerCase()
		.replace(/[’']/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return AR[key] ?? null;
}

/** Fill missing Arabic category names from the same list. */
export function withCategoryArabic(r: ImportResult): ImportResult {
	return {
		...r,
		categories: r.categories.map((c) =>
			c.nameAr ? c : { ...c, nameAr: suggestArabic(c.nameEn) },
		),
	};
}

/** Starter menus, in the same text format the owner can edit before creating. */
export const TEMPLATES = {
	cafe: `# Coffee & tea | قهوة وشاي
Karak | 0.400 | كرك | Strong black tea, cardamom and evaporated milk
Espresso | 1.200 | إسبريسو
Cappuccino | 1.700 | كابتشينو
Spanish latte | 2.000 | سبانش لاتيه
Flat white | 1.800 | فلات وايت
Omani kahwa | 1.000 | قهوة عمانية | With Khalas dates

# Cold drinks | مشروبات باردة
Iced latte | 2.000 | لاتيه مثلج
Cold brew | 2.200 | كولد برو
Lemon mint | 1.500 | ليمون بالنعناع
Fresh orange juice | 1.600 | عصير برتقال طازج

# Bakery | المخبوزات
Butter croissant | 1.200 | كرواسون بالزبدة
Zaatar croissant | 1.300 | كرواسون بالزعتر
Date cake | 1.800 | كيكة التمر
Cheesecake | تشيز كيك | 2.200`,
	bakery: `# Breads | الخبز
Country sourdough | 2.500 | خبز العجين المخمر
Baguette | 0.900 | باغيت
Seeded rye | 2.800 | خبز الجاودار بالبذور

# Pastries | المعجنات
Butter croissant | 1.200 | كرواسون بالزبدة
Pain au chocolat | 1.400 | خبز بالشوكولاتة
Cardamom bun | 1.350 | كعكة الهيل

# Cakes | الكيك
Carrot cake | 1.900 | كيكة الجزر
Chocolate cake | 2.100 | كيكة الشوكولاتة
Date cake | 1.800 | كيكة التمر

# Hot drinks | مشروبات ساخنة
Flat white | 1.600 | فلات وايت
Cappuccino | 1.600 | كابتشينو
Karak | كرك | 0.400`,
	restaurant: `# Starters | المقبلات
Hummus | 1.200 | حمص
Fattoush | 1.500 | فتوش
Lentil soup | 1.200 | شوربة عدس

# Mains | الأطباق الرئيسية
Chicken machboos | 3.500 | مكبوس دجاج | Spiced rice with slow-cooked chicken
Meat machboos | 4.500 | مكبوس لحم
Shuwa | 5.500 | شوا | Slow-roasted lamb, a weekend special
Mishkak | 2.800 | مشكاك | Grilled skewers with tamarind sauce
Chicken shawarma | 1.200 | شاورما دجاج

# Sides | الأطباق الجانبية
French fries | 0.800 | بطاطس مقلية
Greek salad | 1.500 | سلطة يونانية

# Desserts | الحلويات
Luqaimat | 1.200 | لقيمات
Omani halwa | 1.500 | حلوى عمانية
Kunafa | 2.000 | كنافة

# Drinks | المشروبات
Lemon mint | 1.000 | ليمون بالنعناع
Mineral water | مياه معدنية | 0.200`,
	juice: `# Fresh juices | عصائر طازجة
Orange juice | 1.200 | عصير برتقال
Mango juice | 1.500 | عصير مانجو
Watermelon juice | 1.200 | عصير بطيخ
Avocado juice | 1.800 | عصير أفوكادو
Lemon mint | 1.000 | ليمون بالنعناع

# Smoothies & shakes | سموذي وميلك شيك
Berry smoothie | 2.000 | سموذي التوت
Chocolate milkshake | 2.000 | ميلك شيك شوكولاتة

# Snacks | وجبات خفيفة
Halloumi sandwich | 1.500 | ساندويتش حلومي
Chicken sandwich | ساندويتش دجاج | 1.600`,
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
