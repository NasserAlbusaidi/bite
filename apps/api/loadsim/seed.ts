/**
 * Load-sim seed: two fictional restaurants.
 *  A "Saffron Cafe (sim)": 1 branch, cafe + Omani breakfast/mains, prices incl. VAT.
 *  B "Dukkan Grill (sim)": 4 branches, grill/mandi, prices EXCLUDING VAT, one
 *    per-branch price override, promotions incl. one that wraps midnight.
 * Writes loadsim/out/seed.json with tokens, ids, PINs and owner logins.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createDb, schema as s } from "@bite/db";
import { hash } from "@node-rs/argon2";
import { v7 as uuidv7 } from "uuid";
import { createAuth } from "../src/auth/better-auth.js";
import { newSecret, sha256 } from "../src/lib/tokens.js";

const OWNER_URL = "postgres://postgres:postgres@localhost:5432/bite";
const API_URL = "postgres://bite_api:bite_api@localhost:5432/bite";

type Item = [en: string, ar: string, price: number, groups?: string[]];
type MenuDef = {
	cats: [{ en: string; ar: string }, Item[]][];
	groups: Record<
		string,
		{ en: string; min: number; max: number; opts: [string, number][] }
	>;
};

const MENU_A: MenuDef = {
	groups: {
		milk: {
			en: "Milk",
			min: 0,
			max: 1,
			opts: [
				["Oat", 300],
				["Almond", 300],
			],
		},
		shot: { en: "Extra shot", min: 0, max: 1, opts: [["Extra shot", 300]] },
		sugar: {
			en: "Sugar",
			min: 1,
			max: 1,
			opts: [
				["No sugar", 0],
				["Normal", 0],
				["Extra sweet", 0],
			],
		},
		size: {
			en: "Size",
			min: 1,
			max: 1,
			opts: [
				["Regular", 0],
				["Large", 400],
			],
		},
		bdrink: {
			en: "Breakfast drink",
			min: 1,
			max: 1,
			opts: [
				["Karak", 0],
				["Sulaimani", 0],
				["Latte", 600],
			],
		},
		eggs: {
			en: "Eggs",
			min: 0,
			max: 2,
			opts: [
				["Extra egg", 250],
				["Cheese", 200],
				["No onion", 0],
			],
		},
	},
	cats: [
		[
			{ en: "Hot drinks", ar: "مشروبات ساخنة" },
			[
				["Karak", "كرك", 300, ["sugar"]],
				["Sulaimani", "سليماني", 250, ["sugar"]],
				["Omani kahwa pot", "دلة قهوة عمانية", 1500],
				["Espresso", "إسبريسو", 900, ["shot"]],
				["Latte", "لاتيه", 1500, ["milk", "shot"]],
				["Cappuccino", "كابتشينو", 1400, ["milk", "shot"]],
				["Spanish latte", "سبانش لاتيه", 1700, ["milk"]],
			],
		],
		[
			{ en: "Breakfast", ar: "فطور" },
			[
				["Omani breakfast", "فطور عماني", 3500, ["bdrink", "eggs"]],
				["Shakshuka", "شكشوكة", 2200, ["eggs"]],
				["Chips oman paratha", "براتا شيبس عمان", 900, ["eggs"]],
				["Balaleet", "بلاليط", 1800, ["eggs"]],
			],
		],
		[
			{ en: "Mains", ar: "أطباق رئيسية" },
			[
				["Chicken machboos", "مكبوس دجاج", 3800],
				["Mishkak plate", "صحن مشكاك", 2800],
				["Halloumi sandwich", "ساندويتش حلوم", 1800],
				["Chicken shawarma", "شاورما دجاج", 1200],
				["Club sandwich", "كلوب ساندويتش", 2400],
			],
		],
		[
			{ en: "Cold drinks", ar: "مشروبات باردة" },
			[
				["Fresh orange", "برتقال طازج", 1600, ["size"]],
				["Lemon mint", "ليمون بالنعناع", 1300, ["size"]],
				["Iced latte", "آيس لاتيه", 1700, ["milk", "shot"]],
				["Water", "ماء", 200],
			],
		],
		[
			{ en: "Sweets", ar: "حلويات" },
			[
				["Luqaimat", "لقيمات", 1500],
				["Date cake", "كيكة التمر", 1350],
				["Omani halwa cup", "حلوى عمانية", 1000],
			],
		],
	],
};

const MENU_B: MenuDef = {
	groups: {
		spice: {
			en: "Spice",
			min: 1,
			max: 1,
			opts: [
				["Mild", 0],
				["Medium", 0],
				["Hot", 0],
			],
		},
		rice: {
			en: "Rice",
			min: 1,
			max: 1,
			opts: [
				["Mandi rice", 0],
				["White rice", 0],
				["Biryani rice", 500],
			],
		},
		addons: {
			en: "Add-ons",
			min: 0,
			max: 3,
			opts: [
				["Garlic sauce", 150],
				["Extra bread", 200],
				["Extra salad", 350],
			],
		},
		drinksz: {
			en: "Size",
			min: 1,
			max: 1,
			opts: [
				["Regular", 0],
				["Jug", 1700],
			],
		},
	},
	cats: [
		[
			{ en: "Grills", ar: "مشويات" },
			[
				["Shuwa plate", "صحن شواء", 4500, ["rice", "addons"]],
				["Mixed grill", "مشاوي مشكلة", 6500, ["spice", "addons"]],
				[
					"Family grill platter",
					"صينية مشاوي عائلية",
					14000,
					["spice", "addons"],
				],
				["Mishkak 8 skewers", "مشكاك ٨ أسياخ", 3200, ["spice", "addons"]],
				["Shish tawook", "شيش طاووق", 3000, ["spice", "addons"]],
			],
		],
		[
			{ en: "Mandi", ar: "مندي" },
			[
				["Chicken mandi", "مندي دجاج", 3800, ["rice", "addons"]],
				["Lamb mandi", "مندي لحم", 5500, ["rice", "addons"]],
				["Half chicken mandi", "نص دجاج مندي", 2400, ["rice"]],
			],
		],
		[
			{ en: "Starters", ar: "مقبلات" },
			[
				["Hummus", "حمص", 1200],
				["Mutabbal", "متبل", 1200],
				["Fattoush", "فتوش", 1500],
				["Arabic bread", "خبز عربي", 200],
				["Extra rice", "رز إضافي", 800],
			],
		],
		[
			{ en: "Drinks", ar: "مشروبات" },
			[
				["Soft drink", "مشروب غازي", 400],
				["Laban", "لبن", 500],
				["Fresh lime mint", "ليمون نعناع", 1300, ["drinksz"]],
				["Water", "ماء", 200],
			],
		],
		[
			{ en: "Desserts", ar: "حلويات" },
			[
				["Kunafa", "كنافة", 2000],
				["Umm Ali", "أم علي", 1800],
			],
		],
	],
};

type DevOut = {
	id: string;
	name: string;
	kind: "pos" | "kds";
	prefix: string;
	token: string;
};
type StaffOut = { id: string; name: string; role: string; pin: string };
type LocOut = {
	id: string;
	name: string;
	slug: string;
	weight: number;
	devices: DevOut[];
	staff: StaffOut[];
};
type OrgOut = {
	key: "A" | "B";
	id: string;
	name: string;
	owner: { email: string; password: string; memberId: string };
	locations: LocOut[];
	products: Record<string, string>;
};

const owner = createDb(OWNER_URL, { max: 2, onnotice: () => {} });
const api = createDb(API_URL, { max: 2 });
const auth = createAuth(api.db, {
	secret: randomBytes(32).toString("base64url"),
	baseURL: "http://localhost:3000",
	trustedOrigins: [],
});

let pinSeq = 4000;
async function seedOrg(def: {
	key: "A" | "B";
	name: string;
	slugBase: string;
	pricesIncludeTax: boolean;
	branches: { name: string; slug: string; weight: number; tills: number }[];
	menu: MenuDef;
	ownerEmail: string;
}): Promise<OrgOut> {
	const o = owner.db;
	const password = `sim-${def.key}-owner-pass`;
	const user = await auth.api.signUpEmail({
		body: { email: def.ownerEmail, password, name: `${def.name} owner` },
	});
	const org = uuidv7();
	const ownerMember = uuidv7();
	const products: Record<string, string> = {};
	const locs: LocOut[] = [];
	await o.transaction(async (tx) => {
		await tx.insert(s.orgs).values({
			id: org,
			name: def.name,
			slug: def.slugBase,
			status: "active",
		});
		await tx.insert(s.members).values({
			id: ownerMember,
			orgId: org,
			userId: user.user.id,
			displayName: `${def.name} owner`,
			orgRole: "owner",
			pinHash: await hash("9999"),
		});
		for (const b of def.branches) {
			const loc = uuidv7();
			await tx.insert(s.locations).values({
				id: loc,
				orgId: org,
				name: b.name,
				slug: b.slug,
				taxBps: 500,
				pricesIncludeTax: def.pricesIncludeTax,
			});
			const devices: DevOut[] = [];
			const prefixes = ["A", "B", "C"];
			for (let i = 0; i < b.tills; i++) {
				devices.push({
					id: uuidv7(),
					name: `Till ${i + 1}`,
					kind: "pos",
					prefix: prefixes[i] as string,
					token: newSecret("sim_"),
				});
			}
			devices.push({
				id: uuidv7(),
				name: "Kitchen",
				kind: "kds",
				prefix: "K",
				token: newSecret("sim_"),
			});
			for (const d of devices) {
				await tx.insert(s.devices).values({
					id: d.id,
					orgId: org,
					locationId: loc,
					name: d.name,
					kind: d.kind,
					ticketPrefix: d.prefix,
					tokenHash: sha256(d.token),
				});
			}
			const roster: [string, string][] = [
				["manager", "Manager"],
				["cashier", "Cashier 1"],
				["cashier", "Cashier 2"],
				["kitchen", "Chef 1"],
				["kitchen", "Chef 2"],
			];
			if (def.key === "A")
				roster.push(["cashier", "Cashier 3"], ["server", "Server 1"]);
			const staff: StaffOut[] = [];
			// Owner is manager everywhere (can approve refunds at any till).
			await tx.insert(s.memberLocations).values({
				orgId: org,
				memberId: ownerMember,
				locationId: loc,
				role: "manager",
			});
			for (const [role, label] of roster) {
				const id = uuidv7();
				const pin = String(pinSeq++);
				await tx.insert(s.members).values({
					id,
					orgId: org,
					displayName: `${b.name} ${label}`,
					orgRole: "staff",
					pinHash: await hash(pin),
				});
				await tx.insert(s.memberLocations).values({
					orgId: org,
					memberId: id,
					locationId: loc,
					role: role as "manager",
				});
				staff.push({ id, name: `${b.name} ${label}`, role, pin });
			}
			staff.push({
				id: ownerMember,
				name: "Owner",
				role: "manager",
				pin: "9999",
			});
			locs.push({
				id: loc,
				name: b.name,
				slug: b.slug,
				weight: b.weight,
				devices,
				staff,
			});
		}

		const groupIds: Record<string, string> = {};
		for (const [key, g] of Object.entries(def.menu.groups)) {
			const gid = uuidv7();
			groupIds[key] = gid;
			await tx.insert(s.modifierGroups).values({
				id: gid,
				orgId: org,
				name: { en: g.en },
				minSelect: g.min,
				maxSelect: g.max,
			});
			for (const [i, [en, delta]] of g.opts.entries()) {
				await tx.insert(s.modifierOptions).values({
					orgId: org,
					groupId: gid,
					name: { en },
					priceDelta: delta,
					sortOrder: i,
				});
			}
		}
		for (const [ci, [cat, items]] of def.menu.cats.entries()) {
			const catId = uuidv7();
			products[`cat:${cat.en}`] = catId;
			await tx
				.insert(s.categories)
				.values({ id: catId, orgId: org, name: cat, sortOrder: ci });
			for (const [pi, [en, ar, price, groups]] of items.entries()) {
				const id = uuidv7();
				products[en] = id;
				await tx.insert(s.products).values({
					id,
					orgId: org,
					categoryId: catId,
					name: { en, ar },
					price,
					sortOrder: pi,
				});
				for (const [gi, g] of (groups ?? []).entries()) {
					await tx.insert(s.productModifierGroups).values({
						orgId: org,
						productId: id,
						groupId: groupIds[g] as string,
						sortOrder: gi,
					});
				}
			}
		}
	});
	return {
		key: def.key,
		id: org,
		name: def.name,
		owner: { email: def.ownerEmail, password, memberId: ownerMember },
		locations: locs,
		products,
	};
}

const A = await seedOrg({
	key: "A",
	name: "Saffron Cafe (sim)",
	slugBase: "saffron-sim",
	pricesIncludeTax: true,
	branches: [
		{ name: "Saffron Qurum", slug: "saffron-qurum", weight: 1, tills: 2 },
	],
	menu: MENU_A,
	ownerEmail: "owner-a@sim.bite",
});
const B = await seedOrg({
	key: "B",
	name: "Dukkan Grill (sim)",
	slugBase: "dukkan-sim",
	pricesIncludeTax: false,
	branches: [
		{
			name: "Dukkan Al Khuwair",
			slug: "dukkan-khuwair",
			weight: 0.34,
			tills: 2,
		},
		{ name: "Dukkan Seeb", slug: "dukkan-seeb", weight: 0.26, tills: 2 },
		{ name: "Dukkan Muttrah", slug: "dukkan-muttrah", weight: 0.22, tills: 2 },
		{ name: "Dukkan Sohar", slug: "dukkan-sohar", weight: 0.18, tills: 2 },
	],
	menu: MENU_B,
	ownerEmail: "owner-b@sim.bite",
});

// Promotions + a per-branch price override.
await owner.db.transaction(async (tx) => {
	await tx.insert(s.promotions).values([
		{
			orgId: A.id,
			name: "Afternoon karak 20%",
			kind: "percent",
			value: 2000,
			productId: A.products.Karak,
			dailyStart: "15:00",
			dailyEnd: "17:00",
			priority: 10,
		},
		{
			orgId: A.id,
			name: "Luqaimat 0.250 off",
			kind: "fixed",
			value: 250,
			productId: A.products.Luqaimat,
		},
		{
			orgId: B.id,
			name: "Mandi lunch deal",
			kind: "fixed",
			value: 500,
			categoryId: B.products["cat:Mandi"],
			dailyStart: "12:00",
			dailyEnd: "15:00",
			daysOfWeek: [0, 1, 2, 3, 4],
			priority: 5,
		},
		{
			orgId: B.id,
			name: "Late-night grills 10%",
			kind: "percent",
			value: 1000,
			categoryId: B.products["cat:Grills"],
			dailyStart: "22:30",
			dailyEnd: "01:00",
			priority: 6,
		},
	]);
	const muttrah = B.locations.find((l) => l.slug === "dukkan-muttrah");
	await tx.insert(s.productLocationSettings).values({
		orgId: B.id,
		productId: B.products["Shuwa plate"] as string,
		locationId: muttrah?.id as string,
		price: 4200,
	});
});

writeFileSync(
	new URL("./out/seed.json", import.meta.url),
	JSON.stringify({ orgs: [A, B] }, null, 2),
);
console.log("seeded", A.locations.length + B.locations.length, "locations");
await owner.client.end();
await api.client.end();
