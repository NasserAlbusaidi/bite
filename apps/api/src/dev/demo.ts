/**
 * Showcase seed: "Luban Café", a two-branch Muscat café with a full
 * English/Arabic menu, options, promotions, staff, tablets and three weeks of
 * sales, so every screen (overview, reports, KDS, till) has something to show.
 *
 *   pnpm --filter @bite/api demo:seed
 *
 * Needs the database set up (`pnpm dev:setup`) and the API running, because
 * the sales history goes through the real tablet sync endpoint (core pricing,
 * server-side checks, cash sessions), not straight into tables.
 *
 * Env: DATABASE_OWNER_URL (superuser, default local), DEMO_API_URL (default
 * http://localhost:3000), DEMO_DAYS (history length, default 21).
 *
 * Safe to run again: the org is created once and history once; every run gives
 * the four tablets fresh tokens and prints them with the logins.
 *
 * Dev and demo only. Never run this against a production database.
 */

// biome-ignore-all lint/suspicious/noExplicitAny: dev script over the untyped sync JSON
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCatalog, businessDate, localClock, priceCart } from "@bite/core";
import { createDb, schema as s } from "@bite/db";
import { and, eq, inArray, isNotNull, sql } from "@bite/db/orm";
import { hash } from "@node-rs/argon2";
import { v7 as uuidv7 } from "uuid";
import { createAuth } from "../auth/better-auth.js";
import { newSecret, sha256 } from "../lib/tokens.js";

const root = (p: string) =>
	fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

const OWNER_URL =
	process.env.DATABASE_OWNER_URL ??
	"postgres://postgres:postgres@localhost:5432/bite";
const API = (process.env.DEMO_API_URL ?? "http://localhost:3000").replace(
	/\/$/,
	"",
);
const DAYS = Number(process.env.DEMO_DAYS ?? 21);
const TZ = "Asia/Muscat";
const CUTOFF = 240;

const ORG_SLUG = "luban";
const OWNER_EMAIL = "owner@luban.demo";
const OWNER_PASSWORD = "luban-demo-2026";
const MANAGER_EMAIL = "manager@luban.demo";
const MANAGER_PASSWORD = "luban-manager-2026";

function dbUrl(user: string, password: string): string {
	const u = new URL(OWNER_URL);
	u.username = user;
	u.password = password;
	return u.toString();
}

// ------------------------------------------------------------------ menu
type L = { en: string; ar: string };
type Item = {
	key: string;
	name: L;
	desc: L;
	price: number;
	groups?: string[];
	/** Relative popularity in the generated history. */
	w: number;
};

const GROUPS: Record<
	string,
	{ name: L; min: number; max: number; opts: [L, number][] }
> = {
	size: {
		name: { en: "Size", ar: "الحجم" },
		min: 1,
		max: 1,
		opts: [
			[{ en: "Regular", ar: "عادي" }, 0],
			[{ en: "Large", ar: "كبير" }, 500],
		],
	},
	milk: {
		name: { en: "Milk", ar: "الحليب" },
		min: 0,
		max: 1,
		opts: [
			[{ en: "Oat milk", ar: "حليب الشوفان" }, 300],
			[{ en: "Almond milk", ar: "حليب اللوز" }, 300],
			[{ en: "Lactose free", ar: "خالي من اللاكتوز" }, 200],
		],
	},
	shot: {
		name: { en: "Extras", ar: "إضافات" },
		min: 0,
		max: 2,
		opts: [
			[{ en: "Extra shot", ar: "جرعة إضافية" }, 300],
			[{ en: "Saffron", ar: "زعفران" }, 400],
		],
	},
	sugar: {
		name: { en: "Sweetness", ar: "السكر" },
		min: 1,
		max: 1,
		opts: [
			[{ en: "No sugar", ar: "بدون سكر" }, 0],
			[{ en: "Less sweet", ar: "سكر خفيف" }, 0],
			[{ en: "Normal", ar: "عادي" }, 0],
		],
	},
	spice: {
		name: { en: "Spice level", ar: "درجة الحرارة" },
		min: 1,
		max: 1,
		opts: [
			[{ en: "Mild", ar: "خفيف" }, 0],
			[{ en: "Medium", ar: "متوسط" }, 0],
			[{ en: "Hot", ar: "حار" }, 0],
		],
	},
	addons: {
		name: { en: "Add to it", ar: "أضف" },
		min: 0,
		max: 3,
		opts: [
			[{ en: "Extra egg", ar: "بيضة إضافية" }, 300],
			[{ en: "Avocado", ar: "أفوكادو" }, 600],
			[{ en: "Grilled halloumi", ar: "حلوم مشوي" }, 700],
		],
	},
	side: {
		name: { en: "Side", ar: "الطبق الجانبي" },
		min: 1,
		max: 1,
		opts: [
			[{ en: "Saffron rice", ar: "أرز بالزعفران" }, 0],
			[{ en: "Fries", ar: "بطاطس مقلية" }, 0],
			[{ en: "Garden salad", ar: "سلطة خضراء" }, 300],
		],
	},
};

/**
 * Product photos (Unsplash License, hotlinked as Unsplash asks). Keyed by
 * menu item key; balaleet and kunafa have no honest free match yet. Re-running the seed re-applies these to an existing org.
 */
const PHOTO_IDS: Record<string, string> = {
	karak: "1559275117-d096eb5d85b2",
	kahwa: "1774791500971-ddaafd214520",
	spanish: "1559496417-e7f25cb247f3",
	saffron: "1684084373817-e51c7f7ab041",
	flatwhite: "1620052087057-bfd8235f5874",
	v60: "1587955245893-389f2215c6eb",
	iced: "1764298490445-6add12301888",
	omani: "1786799445505-77b51a75ee1f",
	shakshuka: "1582492710145-d723e0a219f8",
	avotoast: "1783307525039-b92506474dc8",
	croissant: "1639667852145-466e29aa49fd",
	machboos: "1708184528306-f75a0a5118ee",
	shuwa: "1696950169170-a433c9eefac4",
	mishkak: "1708597521669-f7312f312b29",
	shawarma: "1676300187013-7540d4e9440d",
	salad: "1786502870203-6fa112102b43",
	fries: "1684815495679-f6e6bc0634ec",
	datecake: "1724116380693-52da975b9bf6",
	halwa: "1635327173758-85badf17f995",
	orange: "1689066117649-0ca9762fc92c",
	lemonmint: "1722663160036-b584469b3577",
	mango: "1623065422902-30a2d299bbe4",
	water: "1781510350868-b81dfa490295",
};
const PHOTOS: Record<string, string> = Object.fromEntries(
	Object.entries(PHOTO_IDS).map(([k, id]) => [
		k,
		`https://images.unsplash.com/photo-${id}?w=800&h=600&fit=crop&q=70&auto=format`,
	]),
);

const MENU: { cat: L; items: Item[] }[] = [
	{
		cat: { en: "Coffee & tea", ar: "قهوة وشاي" },
		items: [
			{
				key: "karak",
				name: { en: "Karak", ar: "كرك" },
				desc: {
					en: "Strong black tea, cardamom and evaporated milk.",
					ar: "شاي أسود قوي بالهيل والحليب المبخر.",
				},
				price: 400,
				groups: ["sugar"],
				w: 14,
			},
			{
				key: "kahwa",
				name: { en: "Omani kahwa & dates", ar: "قهوة عمانية مع التمر" },
				desc: {
					en: "A dallah of cardamom and rose water coffee with Khalas dates.",
					ar: "دلة قهوة بالهيل وماء الورد مع تمر الخلاص.",
				},
				price: 1500,
				w: 5,
			},
			{
				key: "spanish",
				name: { en: "Spanish latte", ar: "سبانش لاتيه" },
				desc: {
					en: "Double espresso, condensed milk, steamed milk.",
					ar: "إسبريسو مزدوج مع الحليب المكثف والحليب المبخر.",
				},
				price: 2100,
				groups: ["size", "milk", "shot"],
				w: 10,
			},
			{
				key: "saffron",
				name: { en: "Saffron latte", ar: "لاتيه الزعفران" },
				desc: {
					en: "Our signature: espresso, saffron syrup and a pinch of cardamom.",
					ar: "طبقنا المميز: إسبريسو مع شراب الزعفران ورشة هيل.",
				},
				price: 2300,
				groups: ["size", "milk"],
				w: 7,
			},
			{
				key: "flatwhite",
				name: { en: "Flat white", ar: "فلات وايت" },
				desc: {
					en: "Double ristretto with silky milk.",
					ar: "ريستريتو مزدوج مع حليب ناعم.",
				},
				price: 1900,
				groups: ["milk", "shot"],
				w: 6,
			},
			{
				key: "v60",
				name: { en: "V60 pour over", ar: "قهوة مقطرة V60" },
				desc: {
					en: "Single origin, brewed to order. Ask what's on today.",
					ar: "محصول واحد يحضر عند الطلب. اسألنا عن محصول اليوم.",
				},
				price: 2500,
				w: 3,
			},
			{
				key: "iced",
				name: { en: "Iced Spanish latte", ar: "سبانش لاتيه بارد" },
				desc: {
					en: "The Spanish latte over ice.",
					ar: "السبانش لاتيه مع الثلج.",
				},
				price: 2300,
				groups: ["size", "milk", "shot"],
				w: 9,
			},
		],
	},
	{
		cat: { en: "Breakfast", ar: "الفطور" },
		items: [
			{
				key: "omani",
				name: { en: "Omani breakfast", ar: "فطور عماني" },
				desc: {
					en: "Chabab pancakes, Omani honey, eggs, cheese and a karak.",
					ar: "خبز الچباب مع العسل العماني والبيض والجبن وكوب كرك.",
				},
				price: 3500,
				groups: ["addons"],
				w: 6,
			},
			{
				key: "shakshuka",
				name: { en: "Shakshuka", ar: "شكشوكة" },
				desc: {
					en: "Eggs baked in spiced tomato, feta, warm bread.",
					ar: "بيض مطهو في صلصة الطماطم المتبلة مع جبن الفيتا والخبز.",
				},
				price: 2900,
				groups: ["spice", "addons"],
				w: 5,
			},
			{
				key: "balaleet",
				name: { en: "Balaleet", ar: "بلاليط" },
				desc: {
					en: "Sweet saffron vermicelli topped with an omelette.",
					ar: "شعيرية حلوة بالزعفران مع عجة البيض.",
				},
				price: 2400,
				w: 3,
			},
			{
				key: "avotoast",
				name: { en: "Avocado toast", ar: "توست الأفوكادو" },
				desc: {
					en: "Sourdough, smashed avocado, dukkah, poached egg.",
					ar: "خبز العجين المخمر مع الأفوكادو والدقة وبيضة مسلوقة.",
				},
				price: 3200,
				groups: ["addons"],
				w: 4,
			},
			{
				key: "croissant",
				name: { en: "Halloumi zaatar croissant", ar: "كرواسون حلوم وزعتر" },
				desc: {
					en: "Butter croissant, grilled halloumi, zaatar, tomato.",
					ar: "كرواسون بالزبدة مع الحلوم المشوي والزعتر والطماطم.",
				},
				price: 2200,
				w: 6,
			},
		],
	},
	{
		cat: { en: "Mains", ar: "الأطباق الرئيسية" },
		items: [
			{
				key: "machboos",
				name: { en: "Chicken machboos", ar: "مكبوس دجاج" },
				desc: {
					en: "Spiced rice with slow-cooked chicken, daqqus and nuts.",
					ar: "أرز متبل مع دجاج مطهو ببطء والدقوس والمكسرات.",
				},
				price: 4200,
				groups: ["spice"],
				w: 7,
			},
			{
				key: "shuwa",
				name: { en: "Lamb shuwa", ar: "شواء لحم" },
				desc: {
					en: "Omani pit-roasted lamb, saffron rice, tomato salsa.",
					ar: "لحم عماني مشوي في التنور مع أرز الزعفران وصلصة الطماطم.",
				},
				price: 5800,
				groups: ["side"],
				w: 4,
			},
			{
				key: "mishkak",
				name: { en: "Beef mishkak", ar: "مشاكيك لحم" },
				desc: {
					en: "Four skewers off the grill with tamarind sauce.",
					ar: "أربعة أسياخ مشوية مع صلصة التمر الهندي.",
				},
				price: 3800,
				groups: ["side", "spice"],
				w: 5,
			},
			{
				key: "shawarma",
				name: { en: "Chicken shawarma wrap", ar: "شاورما دجاج" },
				desc: {
					en: "Garlic toum, pickles, fries inside.",
					ar: "مع الثوم والمخلل والبطاطس.",
				},
				price: 1900,
				groups: ["spice"],
				w: 9,
			},
			{
				key: "salad",
				name: { en: "Grilled halloumi salad", ar: "سلطة الحلوم المشوي" },
				desc: {
					en: "Greens, pomegranate, toasted seeds, date dressing.",
					ar: "خضار ورقية ورمان وبذور محمصة وصلصة التمر.",
				},
				price: 3200,
				w: 4,
			},
			{
				key: "fries",
				name: { en: "Truffle fries", ar: "بطاطس بالكمأة" },
				desc: {
					en: "Parmesan, truffle oil, parsley.",
					ar: "مع البارميزان وزيت الكمأة والبقدونس.",
				},
				price: 1800,
				w: 6,
			},
		],
	},
	{
		cat: { en: "Sweets", ar: "الحلويات" },
		items: [
			{
				key: "datecake",
				name: { en: "Sticky date cake", ar: "كيكة التمر" },
				desc: {
					en: "Warm, with toffee sauce and vanilla ice cream.",
					ar: "تقدم دافئة مع صلصة التوفي وآيس كريم الفانيلا.",
				},
				price: 2100,
				w: 6,
			},
			{
				key: "kunafa",
				name: { en: "Kunafa", ar: "كنافة" },
				desc: {
					en: "Crisp kataifi, melted cheese, rose syrup, pistachio.",
					ar: "كنافة مقرمشة بالجبن الذائب وشراب الورد والفستق.",
				},
				price: 2400,
				w: 4,
			},
			{
				key: "halwa",
				name: { en: "Omani halwa cheesecake", ar: "تشيز كيك الحلوى العمانية" },
				desc: {
					en: "Baked cheesecake swirled with Omani halwa.",
					ar: "تشيز كيك مخبوز بالحلوى العمانية.",
				},
				price: 2600,
				w: 4,
			},
		],
	},
	{
		cat: { en: "Cold drinks", ar: "مشروبات باردة" },
		items: [
			{
				key: "orange",
				name: { en: "Fresh orange juice", ar: "عصير برتقال طازج" },
				desc: { en: "Squeezed to order.", ar: "يعصر عند الطلب." },
				price: 1700,
				w: 5,
			},
			{
				key: "lemonmint",
				name: { en: "Lemon mint", ar: "ليمون بالنعناع" },
				desc: {
					en: "Frozen, fresh mint, not too sweet.",
					ar: "مثلج بالنعناع الطازج وقليل السكر.",
				},
				price: 1600,
				groups: ["sugar"],
				w: 7,
			},
			{
				key: "mango",
				name: { en: "Mango smoothie", ar: "سموذي المانجو" },
				desc: {
					en: "Alphonso mango, yoghurt, honey.",
					ar: "مانجو ألفونسو مع اللبن والعسل.",
				},
				price: 2200,
				w: 4,
			},
			{
				key: "water",
				name: { en: "Water", ar: "ماء" },
				desc: {
					en: "Local mineral water, 500 ml.",
					ar: "مياه معدنية محلية ٥٠٠ مل.",
				},
				price: 300,
				w: 6,
			},
		],
	},
];

const BRANCHES = [
	{
		key: "qurum",
		slug: "luban-qurum",
		name: "Luban Café Qurum",
		address: "Shatti Al Qurum, Way 2601, Muscat",
		phone: "+968 2400 1122",
		posPrefix: "A",
		kdsPrefix: "KQ",
		// Guest QR orders use Q- and group orders G- (orders/guest.ts), so tills avoid those.
		/** Orders on a normal weekday. */
		volume: 70,
		staff: [
			{ name: "Maryam", role: "cashier", pin: "1111" },
			{ name: "Hamed", role: "server", pin: "3333" },
			{ name: "Ravi", role: "kitchen", pin: "2222" },
		],
	},
	{
		key: "mouj",
		slug: "luban-almouj",
		name: "Luban Café Al Mouj",
		address: "The Walk, Al Mouj, Muscat",
		phone: "+968 2400 3344",
		posPrefix: "M",
		kdsPrefix: "KM",
		volume: 48,
		staff: [
			{ name: "Aisha", role: "cashier", pin: "4444" },
			{ name: "Joseph", role: "kitchen", pin: "5555" },
		],
	},
] as const;

const HOURS = Object.fromEntries(
	["sat", "sun", "mon", "tue", "wed", "thu", "fri"].map((d) => [
		d,
		[{ open: "07:00", close: d === "thu" || d === "fri" ? "01:00" : "23:30" }],
	]),
) as never;

// ------------------------------------------------------------------ setup
type Tablet = {
	branch: (typeof BRANCHES)[number]["key"];
	kind: "pos" | "kds";
	deviceId: string;
	token: string;
};
type Built = {
	orgId: string;
	locations: Record<string, string>;
	cashier: Record<string, string>;
	manager: string;
	created: boolean;
};

/** Sets image_url on an existing Luban menu from PHOTOS (matched by English name). */
async function applyPhotos(o: any, orgId: string) {
	let n = 0;
	for (const { items } of MENU) {
		for (const it of items) {
			const url = PHOTOS[it.key];
			if (!url) continue;
			const done = await o
				.update(s.products)
				.set({ imageUrl: url })
				.where(
					and(
						eq(s.products.orgId, orgId),
						sql`${s.products.name}->>'en' = ${it.name.en}`,
					),
				)
				.returning({ id: s.products.id });
			n += done.length;
		}
	}
	if (n) console.log(`seed   ${n} product photos set`);
}

async function build(): Promise<Built> {
	const ownerConn = createDb(OWNER_URL, { max: 1, onnotice: () => {} });
	const o = ownerConn.db;
	try {
		const [existing] = await o
			.select({ id: s.orgs.id })
			.from(s.orgs)
			.where(eq(s.orgs.slug, ORG_SLUG));
		if (existing) {
			const locs = await o
				.select({ id: s.locations.id, slug: s.locations.slug })
				.from(s.locations)
				.where(eq(s.locations.orgId, existing.id));
			const ml = await o
				.select({
					memberId: s.memberLocations.memberId,
					locationId: s.memberLocations.locationId,
					role: s.memberLocations.role,
				})
				.from(s.memberLocations)
				.where(eq(s.memberLocations.orgId, existing.id));
			const locations: Record<string, string> = {};
			const cashier: Record<string, string> = {};
			let manager = "";
			for (const b of BRANCHES) {
				const id = locs.find((l) => l.slug === b.slug)?.id as string;
				locations[b.key] = id;
				cashier[b.key] = ml.find(
					(m) => m.locationId === id && m.role === "cashier",
				)?.memberId as string;
				manager ||=
					ml.find((m) => m.locationId === id && m.role === "manager")
						?.memberId ?? "";
			}
			await applyPhotos(o, existing.id);
			console.log("seed   Luban org already there");
			return {
				orgId: existing.id,
				locations,
				cashier,
				manager,
				created: false,
			};
		}

		const api = createDb(dbUrl("bite_api", "bite_api"), { max: 1 });
		const users: Record<string, string> = {};
		try {
			const auth = createAuth(api.db, {
				secret: newSecret(),
				baseURL: API,
				trustedOrigins: [],
			});
			for (const [email, password, name] of [
				[OWNER_EMAIL, OWNER_PASSWORD, "Khalid (owner)"],
				[MANAGER_EMAIL, MANAGER_PASSWORD, "Salim (Qurum manager)"],
			] as const) {
				const [u] = await o
					.select({ id: s.authUsers.id })
					.from(s.authUsers)
					.where(eq(s.authUsers.email, email));
				users[email] =
					u?.id ??
					(await auth.api.signUpEmail({ body: { email, password, name } })).user
						.id;
			}
		} finally {
			await api.client.end();
		}

		const orgId = uuidv7();
		const locations: Record<string, string> = {};
		const cashier: Record<string, string> = {};
		const ownerMember = uuidv7();
		const managerMember = uuidv7();

		await o.transaction(async (tx) => {
			await tx.insert(s.orgs).values({
				id: orgId,
				name: "Luban Café",
				slug: ORG_SLUG,
				status: "active",
			});
			for (const b of BRANCHES) {
				const id = uuidv7();
				locations[b.key] = id;
				await tx.insert(s.locations).values({
					id,
					orgId,
					name: b.name,
					slug: b.slug,
					timezone: TZ,
					taxBps: 500,
					pricesIncludeTax: true,
					vatNumber: "OM1100123456",
					dayCutoffMinutes: CUTOFF,
					address: b.address,
					phone: b.phone,
					whatsappNumber: b.phone,
					businessHours: HOURS,
					theme: { accent: "#1f5c45" },
					receiptHeader: `${b.name}\nThank you, come again`,
				});
			}

			// People. The owner works every branch as manager on the tablets too.
			await tx.insert(s.members).values([
				{
					id: ownerMember,
					orgId,
					userId: users[OWNER_EMAIL] as string,
					displayName: "Khalid",
					orgRole: "owner",
					pinHash: await hash("1234"),
				},
				{
					id: managerMember,
					orgId,
					userId: users[MANAGER_EMAIL] as string,
					displayName: "Salim",
					orgRole: "staff",
					pinHash: await hash("9999"),
				},
			]);
			for (const b of BRANCHES) {
				const loc = locations[b.key] as string;
				await tx.insert(s.memberLocations).values({
					orgId,
					memberId: ownerMember,
					locationId: loc,
					role: "manager",
				});
				for (const st of b.staff) {
					const id = uuidv7();
					if (st.role === "cashier") cashier[b.key] = id;
					await tx.insert(s.members).values({
						id,
						orgId,
						displayName: st.name,
						orgRole: "staff",
						pinHash: await hash(st.pin),
					});
					await tx.insert(s.memberLocations).values({
						orgId,
						memberId: id,
						locationId: loc,
						role: st.role,
					});
				}
			}
			await tx.insert(s.memberLocations).values({
				orgId,
				memberId: managerMember,
				locationId: locations.qurum as string,
				role: "manager",
			});

			// Menu.
			const groupIds: Record<string, string> = {};
			for (const [k, g] of Object.entries(GROUPS)) {
				const id = uuidv7();
				groupIds[k] = id;
				await tx.insert(s.modifierGroups).values({
					id,
					orgId,
					name: g.name,
					minSelect: g.min,
					maxSelect: g.max,
				});
				await tx.insert(s.modifierOptions).values(
					g.opts.map(([name, priceDelta], i) => ({
						orgId,
						groupId: id,
						name,
						priceDelta,
						sortOrder: i,
					})),
				);
			}
			const productIds: Record<string, string> = {};
			const catIds: Record<string, string> = {};
			for (const [ci, { cat, items }] of MENU.entries()) {
				const catId = uuidv7();
				catIds[cat.en] = catId;
				await tx
					.insert(s.categories)
					.values({ id: catId, orgId, name: cat, sortOrder: ci });
				for (const [pi, it] of items.entries()) {
					const id = uuidv7();
					productIds[it.key] = id;
					await tx.insert(s.products).values({
						id,
						orgId,
						categoryId: catId,
						name: it.name,
						description: it.desc,
						price: it.price,
						imageUrl: PHOTOS[it.key] ?? null,
						sortOrder: pi,
					});
					for (const [gi, g] of (it.groups ?? []).entries()) {
						await tx.insert(s.productModifierGroups).values({
							orgId,
							productId: id,
							groupId: groupIds[g] as string,
							sortOrder: gi,
						});
					}
				}
			}

			// Promotions: breakfast deal every morning, karak hour every afternoon,
			// and a weekend dessert deal at Al Mouj only.
			await tx.insert(s.promotions).values([
				{
					orgId,
					name: "Early bird breakfast",
					kind: "percent",
					value: 1500,
					categoryId: catIds.Breakfast,
					dailyStart: "07:00",
					dailyEnd: "10:00",
					priority: 1,
				},
				{
					orgId,
					name: "Karak hour",
					kind: "fixed",
					value: 100,
					productId: productIds.karak,
					dailyStart: "15:00",
					dailyEnd: "18:00",
					priority: 2,
				},
				{
					orgId,
					locationId: locations.mouj,
					name: "Weekend sweets at The Walk",
					kind: "percent",
					value: 2000,
					categoryId: catIds.Sweets,
					daysOfWeek: [4, 5],
					priority: 1,
				},
			]);
		});
		console.log("seed   Luban org, 2 branches, menu, staff, promotions");
		return {
			orgId,
			locations,
			cashier,
			manager: ownerMember,
			created: true,
		};
	} finally {
		await ownerConn.client.end();
	}
}

const TABLET_LABEL = {
	"qurum:pos": "Qurum till",
	"qurum:kds": "Qurum kitchen",
	"mouj:pos": "Al Mouj till",
	"mouj:kds": "Al Mouj kitchen",
} as const;

/** Tokens printed by the last run, so a re-run keeps tablets paired. */
function savedTokens(): Map<string, string> {
	const out = new Map<string, string>();
	const file = root(".demo-credentials.txt");
	if (process.env.DEMO_NEW_TOKENS || !existsSync(file)) return out;
	const text = readFileSync(file, "utf8");
	for (const [key, label] of Object.entries(TABLET_LABEL)) {
		const m = text.match(
			new RegExp(`^\\s*${label}\\s+(demo_[\\w-]+)\\s*$`, "m"),
		);
		if (m?.[1]) out.set(key, m[1]);
	}
	return out;
}

/**
 * Creates the tablets the first time. Keeps the last run's tokens when they
 * still match (so paired tablets stay paired); otherwise issues new ones.
 * DEMO_NEW_TOKENS=1 forces new tokens.
 */
async function tablets(b: Built): Promise<Tablet[]> {
	const ownerConn = createDb(OWNER_URL, { max: 1, onnotice: () => {} });
	const o = ownerConn.db;
	const out: Tablet[] = [];
	const saved = savedTokens();
	try {
		for (const br of BRANCHES) {
			const loc = b.locations[br.key] as string;
			for (const kind of ["pos", "kds"] as const) {
				const name = kind === "pos" ? "Front till" : "Kitchen screen";
				const kept = saved.get(`${br.key}:${kind}`);
				const [d] = await o
					.select({ id: s.devices.id, tokenHash: s.devices.tokenHash })
					.from(s.devices)
					.where(
						and(
							eq(s.devices.locationId, loc),
							eq(s.devices.kind, kind),
							eq(s.devices.name, name),
						),
					);
				let deviceId = d?.id;
				if (d && kept && d.tokenHash === sha256(kept)) {
					out.push({ branch: br.key, kind, deviceId: d.id, token: kept });
					continue;
				}
				const token = newSecret("demo_");
				if (deviceId) {
					await o
						.update(s.devices)
						.set({ tokenHash: sha256(token), revokedAt: null })
						.where(eq(s.devices.id, deviceId));
				} else {
					deviceId = uuidv7();
					await o.insert(s.devices).values({
						id: deviceId,
						orgId: b.orgId,
						locationId: loc,
						name,
						kind,
						ticketPrefix: kind === "pos" ? br.posPrefix : br.kdsPrefix,
						tokenHash: sha256(token),
					});
				}
				out.push({ branch: br.key, kind, deviceId, token });
			}
		}
	} finally {
		await ownerConn.client.end();
	}
	return out;
}

// ------------------------------------------------------------------ history
let seed = 20261124;
/** Deterministic, so two runs on two machines tell the same story. */
function rand() {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
}
/** Whole number in [0, n). */
function rint(n: number): number {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed % n;
}
const pick = <T>(xs: readonly T[]): T =>
	xs[Math.floor(rand() * xs.length)] as T;
function weighted<T>(xs: readonly [T, number][]): T {
	const total = xs.reduce((a, [, w]) => a + w, 0);
	let r = rand() * total;
	for (const [x, w] of xs) {
		r -= w;
		if (r <= 0) return x;
	}
	return (xs[xs.length - 1] as [T, number])[0];
}

/** Share of the day's orders by local hour. Morning, lunch and evening peaks. */
const HOUR_SHAPE: [number, number][] = [
	[7, 5],
	[8, 9],
	[9, 9],
	[10, 6],
	[11, 4],
	[12, 6],
	[13, 8],
	[14, 6],
	[15, 4],
	[16, 5],
	[17, 6],
	[18, 7],
	[19, 8],
	[20, 8],
	[21, 6],
	[22, 3],
];

async function http(
	method: string,
	path: string,
	token: string,
	body?: unknown,
): Promise<any> {
	const res = await fetch(API + path, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			...(body ? { "content-type": "application/json" } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
	return text ? JSON.parse(text) : null;
}

/** Muscat is UTC+4 all year. */
const MUSCAT_MS = 4 * 3600_000;
function muscatInstant(day: string, hour: number, minute: number): number {
	return (
		Date.parse(`${day}T00:00:00Z`) - MUSCAT_MS + (hour * 60 + minute) * 60_000
	);
}
function addDays(day: string, n: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000)
		.toISOString()
		.slice(0, 10);
}

type BranchState = {
	/** Day to start from, counted back from today. */
	fromDaysAgo: number;
	/** Epoch ms of the newest order already there (0 when none). */
	lastPlaced: number;
	ticketDay: string;
	lastTicket: number;
	openSession?: { id: string; businessDate: string; cashSoFar: number };
};

async function branchState(
	locationId: string,
	pos: Tablet,
	today: string,
): Promise<BranchState> {
	const { client: sql } = createDb(OWNER_URL, { max: 1, onnotice: () => {} });
	try {
		const [last] = await sql<{ placed_at: Date; business_date: string }[]>`
			select placed_at, business_date::text from orders
			where location_id = ${locationId} order by placed_at desc limit 1`;
		if (!last)
			return { fromDaysAgo: DAYS, lastPlaced: 0, ticketDay: "", lastTicket: 0 };
		const ticketDay = last.business_date;
		const [t] = await sql<{ n: number | null }[]>`
			select max(cast(split_part(ticket_number, '-', 2) as integer)) as n
			from orders where location_id = ${locationId}
			and business_date = ${ticketDay} and device_id = ${pos.deviceId}`;
		const [open] = await sql<
			{ id: string; business_date: string; cash: string }[]
		>`
			select c.id, c.business_date::text,
				coalesce((select sum(p.amount) from payments p
					where p.cash_session_id = c.id), 0)::text as cash
			from cash_sessions c
			where c.device_id = ${pos.deviceId} and c.status = 'open'
			order by c.opened_at desc limit 1`;
		const days = Math.floor(
			(Date.parse(`${today}T00:00:00Z`) -
				Date.parse(`${ticketDay}T00:00:00Z`)) /
				86400_000,
		);
		return {
			fromDaysAgo: Math.max(0, days),
			lastPlaced: new Date(last.placed_at).getTime(),
			ticketDay,
			lastTicket: t?.n ?? 0,
			...(open
				? {
						openSession: {
							id: open.id,
							businessDate: open.business_date,
							cashSoFar: Number(open.cash),
						},
					}
				: {}),
		};
	} finally {
		await sql.end();
	}
}

/**
 * Sales history through the tablet sync endpoint. The first run writes DAYS
 * days; a later run tops up from the last seeded order to 20 minutes ago, so
 * re-running just before a demo makes "today" look like a real day so far.
 */
async function history(b: Built, tabs: Tablet[]) {
	const now = Date.now();
	const today = businessDate(now, TZ, CUTOFF);
	for (const br of BRANCHES) {
		const pos = tabs.find((t) => t.branch === br.key && t.kind === "pos");
		if (!pos) throw new Error("no till");
		const snap = await http("GET", "/v1/device/menu", pos.token);
		const catalog = buildCatalog(
			snap.products.map((p: any) => ({
				id: p.id,
				categoryId: p.categoryId,
				name: p.name,
				price: p.price,
				taxBps: p.taxBps,
				isAvailable: true,
				modifierGroupIds: p.modifierGroupIds,
			})),
			snap.modifierGroups.map((g: any) => ({
				id: g.id,
				name: g.name,
				minSelect: g.minSelect,
				maxSelect: g.maxSelect,
				options: [...g.options]
					.sort((a: any, c: any) => a.sortOrder - c.sortOrder)
					.map((o: any) => ({
						id: o.id,
						name: o.name,
						priceDelta: o.priceDelta,
						isAvailable: true,
					})),
			})),
		);
		const groups = new Map<string, any>(
			snap.modifierGroups.map((g: any) => [g.id, g]),
		);
		const byName = new Map<string, any>(
			snap.products.map((p: any) => [p.name.en, p]),
		);
		const items: [any, number][] = MENU.flatMap((c) => c.items).map((it) => [
			byName.get(it.name.en),
			it.w,
		]);
		const loc = snap.location;
		const memberId = b.cashier[br.key] as string;
		const st = await branchState(b.locations[br.key] as string, pos, today);

		const queue: any[] = [];
		const flush = async () => {
			while (queue.length) {
				const batch = queue.splice(0, 100);
				const r = await http("POST", "/v1/sync/push", pos.token, {
					deviceId: pos.deviceId,
					mutations: batch,
				});
				const bad = r.results.filter(
					(x: any) => x.status !== "applied" && x.status !== "duplicate",
				);
				if (bad.length) {
					throw new Error(`sync rejected: ${JSON.stringify(bad.slice(0, 3))}`);
				}
			}
		};
		const mut = (kind: string, entityId: string, payload: any, at: number) =>
			queue.push({
				id: uuidv7(),
				kind,
				entityId,
				memberId,
				createdAt: new Date(at).toISOString(),
				payload,
			});

		let orders = 0;
		let revenue = 0;
		const until = now - 20 * 60_000;
		for (let d = st.fromDaysAgo; d >= 0; d--) {
			const day = addDays(today, -d);
			const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
			// Thursday and Friday nights are the busy ones; trend up over three weeks.
			const factor =
				(dow === 4 || dow === 5 ? 135 : dow === 6 ? 110 : 100) *
				(88 + Math.floor((12 * Math.max(0, DAYS - d)) / DAYS)) *
				(90 + rint(21));
			let count = Math.floor((br.volume * factor) / 1_000_000);
			const opened = muscatInstant(day, 6, 45);
			if (opened > now) continue;
			let session =
				st.openSession?.businessDate === day ? st.openSession.id : "";
			if (!session) {
				session = uuidv7();
				mut(
					"cash.open",
					session,
					{ id: session, businessDate: day, openingFloat: 50_000 },
					opened,
				);
			}
			let cashIn = 0;
			const times: number[] = [];
			while (count-- > 0) {
				const hour = weighted(HOUR_SHAPE);
				const t = muscatInstant(day, hour, Math.floor(rand() * 60));
				// Up to 20 minutes ago (room for the live demo), after what is there.
				if (t > until || t <= st.lastPlaced) continue;
				times.push(t);
			}
			times.sort((a, c) => a - c);
			let ticket = day === st.ticketDay ? st.lastTicket : 0;
			for (const t of times) {
				const size = weighted([
					[1, 40],
					[2, 30],
					[3, 18],
					[4, 8],
					[6, 4],
				] as [number, number][]);
				const cart = [];
				for (let i = 0; i < size; i++) {
					const p = weighted(items);
					const opts: string[] = [];
					for (const gid of p.modifierGroupIds as string[]) {
						const g = groups.get(gid);
						const sorted = [...g.options].sort(
							(a: any, c: any) => a.sortOrder - c.sortOrder,
						);
						if (g.minSelect >= 1) opts.push(pick(sorted).id);
						else if (rint(100) < 25) opts.push(pick(sorted).id);
					}
					cart.push({
						productId: p.id,
						quantity: rint(100) < 15 ? 2 : 1,
						modifierOptionIds: opts,
					});
				}
				const priced = priceCart(cart, catalog, {
					settings: {
						pricesIncludeTax: loc.pricesIncludeTax,
						taxBps: loc.taxBps,
						locationId: loc.locationId,
					},
					promotions: snap.promotions.map((p: any) => ({
						id: p.id,
						kind: p.kind,
						value: p.value,
						productId: p.productId,
						categoryId: p.categoryId,
						locationId: p.locationId ?? null,
						startsAt: p.startsAt,
						endsAt: p.endsAt,
						dailyStart: p.dailyStart,
						dailyEnd: p.dailyEnd,
						daysOfWeek: p.daysOfWeek,
						priority: p.priority,
					})),
					at: localClock(t, loc.timezone),
				} as any);
				if (!priced.ok) throw new Error(JSON.stringify(priced.errors));
				const v = priced.value;
				const id = uuidv7();
				const bd = businessDate(t, loc.timezone, loc.dayCutoffMinutes);
				ticket += 1;
				mut(
					"order.create",
					id,
					{
						id,
						ticketNumber: `${br.posPrefix}-${String(ticket).padStart(3, "0")}`,
						businessDate: bd,
						source: "counter",
						type: rint(100) < 62 ? "dine_in" : "takeaway",
						placedAt: new Date(t).toISOString(),
						pricesIncludeTax: v.pricesIncludeTax,
						lines: v.lines.map((l: any) => ({
							id: uuidv7(),
							productId: l.productId,
							quantity: l.quantity,
							modifierOptionIds: l.modifiers.map((m: any) => m.optionId),
							name: l.name,
							listUnitPrice: l.listUnitPrice,
							promotionId: l.promotionId,
							modifiers: l.modifiers.map((m: any) => ({ ...m })),
							taxBps: l.taxBps,
						})),
						expectedTotals: {
							subtotal: v.subtotal,
							discountTotal: v.discountTotal,
							taxTotal: v.taxTotal,
							total: v.total,
						},
					},
					t,
				);
				const cash = rint(100) < 35;
				const tendered = cash
					? Math.ceil(v.total / 1000) * 1000 + (rint(100) < 40 ? 5000 : 0)
					: undefined;
				if (cash) cashIn += v.total;
				mut(
					"order.addPayment",
					id,
					{
						id: uuidv7(),
						orderId: id,
						amount: v.total,
						tip: 0,
						method: cash ? "cash" : "card",
						...(cash ? { cashSessionId: session, tendered } : {}),
						businessDate: bd,
					},
					t + 30_000,
				);
				// History is served and paid; live tickets come from the demo itself.
				mut(
					"order.setFulfillment",
					id,
					{ orderId: id, to: "completed" },
					t + 12 * 60_000,
				);
				orders += 1;
				revenue += v.total;
			}
			if (d > 0) {
				const drift = rint(100) < 20 ? -500 : 0;
				mut(
					"cash.close",
					session,
					{
						cashSessionId: session,
						countedCash:
							50_000 +
							cashIn +
							(session === st.openSession?.id ? st.openSession.cashSoFar : 0) +
							drift,
						...(drift ? { notes: "Short 0.500, coins" } : {}),
					},
					muscatInstant(day, 23, 50),
				);
			}
			await flush();
		}
		console.log(
			`orders ${br.name}: added ${orders} orders, OMR ${Math.floor(revenue / 1000)}.${String(revenue % 1000).padStart(3, "0")}`,
		);
	}
}

// ------------------------------------------------------------------ floor plan

/** [label, x, y, w, h, seats, shape] on the 40 x 28 grid. */
type T = [
	string,
	number,
	number,
	number,
	number,
	number,
	"square" | "round" | "rect",
];
const FLOORS: Record<string, { name: string; tables: T[] }[]> = {
	qurum: [
		{
			name: "Inside",
			tables: [
				["1", 2, 2, 3, 3, 2, "round"],
				["2", 7, 2, 3, 3, 2, "round"],
				["3", 12, 2, 3, 3, 2, "round"],
				["4", 2, 8, 4, 3, 4, "square"],
				["5", 8, 8, 4, 3, 4, "square"],
				["6", 14, 8, 4, 3, 4, "square"],
				["7", 2, 14, 7, 3, 6, "rect"],
				["8", 11, 14, 7, 3, 6, "rect"],
				["9", 22, 2, 3, 3, 2, "round"],
				["10", 22, 8, 4, 3, 4, "square"],
			],
		},
		{
			name: "Terrace",
			tables: [
				["11", 2, 2, 4, 4, 4, "round"],
				["12", 9, 2, 4, 4, 4, "round"],
				["13", 16, 2, 4, 4, 4, "round"],
				["14", 2, 9, 8, 3, 8, "rect"],
			],
		},
		{
			name: "Majlis",
			tables: [
				["15", 2, 2, 8, 4, 10, "rect"],
				["16", 13, 2, 6, 4, 6, "rect"],
			],
		},
	],
	mouj: [
		{
			name: "Inside",
			tables: [
				["1", 2, 2, 3, 3, 2, "round"],
				["2", 7, 2, 3, 3, 2, "round"],
				["3", 2, 8, 4, 3, 4, "square"],
				["4", 8, 8, 4, 3, 4, "square"],
				["5", 2, 14, 7, 3, 6, "rect"],
			],
		},
		{
			name: "Beach side",
			tables: [
				["6", 2, 2, 4, 4, 4, "round"],
				["7", 9, 2, 4, 4, 4, "round"],
				["8", 16, 2, 4, 4, 4, "round"],
			],
		},
	],
};

/** Lays out each branch's floor the first time; later runs leave edits alone. */
async function floorPlans(b: Built) {
	const ownerConn = createDb(OWNER_URL, { max: 1, onnotice: () => {} });
	const o = ownerConn.db;
	try {
		for (const br of BRANCHES) {
			const loc = b.locations[br.key] as string;
			const [has] = await o
				.select({ id: s.floorAreas.id })
				.from(s.floorAreas)
				.where(eq(s.floorAreas.locationId, loc))
				.limit(1);
			if (has) continue;
			const staff = await o
				.select({ id: s.members.id, name: s.members.displayName })
				.from(s.members)
				.where(eq(s.members.orgId, b.orgId));
			const who = (n: string) => staff.find((m) => m.name === n)?.id ?? null;
			let n = 0;
			for (const [i, area] of (FLOORS[br.key] ?? []).entries()) {
				const areaId = uuidv7();
				await o.insert(s.floorAreas).values({
					id: areaId,
					orgId: b.orgId,
					locationId: loc,
					name: area.name,
					sortOrder: i,
				});
				await o.insert(s.floorTables).values(
					area.tables.map(([label, x, y, w, h, seats, shape]) => ({
						id: uuidv7(),
						orgId: b.orgId,
						locationId: loc,
						areaId,
						label,
						x,
						y,
						w,
						h,
						seats,
						shape,
						// Hamed has the terrace at Qurum; Maryam the inside window tables.
						serverMemberId:
							br.key === "qurum" && area.name === "Terrace"
								? who("Hamed")
								: br.key === "qurum" && ["1", "2", "3"].includes(label)
									? who("Maryam")
									: null,
					})),
				);
				n += area.tables.length;
			}
			console.log(`floor  ${br.name}: ${n} tables`);
		}
	} finally {
		await ownerConn.client.end();
	}
}

/**
 * A few tables busy right now, so the floor view has something to show:
 * QR orders through the real guest endpoint (priced by the server), some of
 * them paid at the till and started in the kitchen. Skipped while the
 * branch already has open table orders, so re-runs don't pile up.
 */
async function liveTables(b: Built, tabs: Tablet[]) {
	const ownerConn = createDb(OWNER_URL, { max: 1, onnotice: () => {} });
	const o = ownerConn.db;
	try {
		for (const br of BRANCHES) {
			const loc = b.locations[br.key] as string;
			const [open] = await o
				.select({ id: s.orders.id })
				.from(s.orders)
				.where(
					and(
						eq(s.orders.locationId, loc),
						isNotNull(s.orders.tableLabel),
						inArray(s.orders.fulfillmentStatus, [
							"pending",
							"preparing",
							"ready",
						]),
					),
				)
				.limit(1);
			if (open) continue;
			const pos = tabs.find((t) => t.branch === br.key && t.kind === "pos");
			if (!pos) continue;
			const snap = await http("GET", "/v1/device/menu", pos.token);
			const simple = snap.products.filter(
				(p: any) => p.modifierGroupIds.length === 0,
			);
			if (simple.length < 3) continue;
			// [table, items, then: unpaid | paid (kitchen pending) | preparing | ready]
			const plan: [
				string,
				number,
				"unpaid" | "paid" | "preparing" | "ready",
			][] =
				br.key === "qurum"
					? [
							["2", 2, "ready"],
							["4", 3, "unpaid"],
							["5", 4, "preparing"],
							["8", 5, "paid"],
							["11", 3, "unpaid"],
							["12", 2, "preparing"],
							["15", 6, "preparing"],
						]
					: [
							["3", 3, "preparing"],
							["6", 2, "unpaid"],
						];
			let made = 0;
			for (const [table, size, then] of plan) {
				const lines = Array.from({ length: size }, (_, i) => ({
					id: uuidv7(),
					productId: simple[(i * 7 + Number(table)) % simple.length].id,
					quantity: 1,
					modifierOptionIds: [],
				}));
				let res: Response;
				try {
					res = await fetch(`${API}/v1/public/locations/${br.slug}/orders`, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"idempotency-key": uuidv7(),
						},
						body: JSON.stringify({
							locationSlug: br.slug,
							type: "dine_in",
							tableLabel: table,
							lines,
						}),
					});
				} catch {
					break;
				}
				if (!res.ok) {
					console.log(
						`floor  ${br.name}: guest orders refused (${res.status}), live tables skipped`,
					);
					break;
				}
				const { order } = (await res.json()) as any;
				const [row] = await o
					.select({ id: s.orders.id, bd: s.orders.businessDate })
					.from(s.orders)
					.where(eq(s.orders.trackingToken, order.trackingToken));
				if (!row) continue;
				made += 1;
				if (then === "unpaid") continue;
				const memberId = b.cashier[br.key] as string;
				const at = new Date().toISOString();
				const m = (kind: string, payload: any) => ({
					id: uuidv7(),
					kind,
					entityId: row.id,
					memberId,
					createdAt: at,
					payload,
				});
				const muts = [
					m("order.addPayment", {
						id: uuidv7(),
						orderId: row.id,
						amount: order.total,
						tip: 0,
						method: "card",
						businessDate: row.bd,
					}),
				];
				if (then === "preparing" || then === "ready")
					muts.push(
						m("order.setFulfillment", { orderId: row.id, to: "preparing" }),
					);
				if (then === "ready")
					muts.push(
						m("order.setFulfillment", { orderId: row.id, to: "ready" }),
					);
				await http("POST", "/v1/sync/push", pos.token, {
					deviceId: pos.deviceId,
					mutations: muts,
				});
			}
			if (made) console.log(`floor  ${br.name}: ${made} tables busy`);
		}
	} finally {
		await ownerConn.client.end();
	}
}

// ------------------------------------------------------------------ report
function report(tabs: Tablet[]) {
	const t = (br: string, k: string) =>
		tabs.find((x) => x.branch === br && x.kind === k)?.token;
	const text = `Bite showcase: Luban Café (written by \`demo:seed\`)

Back office
  Owner     ${OWNER_EMAIL} / ${OWNER_PASSWORD}  (both branches)
  Manager   ${MANAGER_EMAIL} / ${MANAGER_PASSWORD}  (Qurum only)

Guest menu  /luban-qurum   /luban-almouj   (Arabic: /ar/luban-qurum)

Tablets (pair with server address = the POS site's own address)
  Qurum till     ${t("qurum", "pos")}
  Qurum kitchen  ${t("qurum", "kds")}
  Al Mouj till   ${t("mouj", "pos")}
  Al Mouj kitchen ${t("mouj", "kds")}

Staff PINs
  Qurum    Khalid (manager) 1234, Salim (manager) 9999, Maryam (cashier) 1111, Hamed (server) 3333, Ravi (kitchen) 2222
  Al Mouj  Khalid (manager) 1234, Aisha (cashier) 4444, Joseph (kitchen) 5555

Re-running demo:seed keeps these tokens and tops up today's sales.
DEMO_NEW_TOKENS=1 issues new ones (re-pair the tablets after that).
`;
	writeFileSync(root(".demo-credentials.txt"), text);
	console.log(`\n${text}\nSaved to .demo-credentials.txt`);
}

const built = await build();
await floorPlans(built);
const tabs = await tablets(built);
await history(built, tabs);
await liveTables(built, tabs);
report(tabs);
