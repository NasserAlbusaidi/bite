/**
 * Demo back office that runs entirely in the browser (VITE_API_URL unset).
 * State persists in localStorage so edits survive a refresh. Validation is
 * the same schema validation the API does; tenancy and auth are not modelled.
 */
import { type AdminApi, AdminApiError } from "./api-types";
import {
	type AdminCategory,
	type AdminLocationSettings,
	type AdminMe,
	type AdminMenu,
	type AdminProduct,
	CreateCategory,
	CreateProduct,
	type LocationProduct,
	SetLocationProduct,
	UpdateCategory,
	UpdateProduct,
} from "./contracts";
import { uuidv7 } from "./uuid";

const id = (n: number) =>
	`0193a1b2-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

type DemoState = {
	menu: AdminMenu;
	/** locationId -> productId -> override */
	overrides: Record<string, Record<string, SetLocationProduct>>;
};

const azaiba = {
	id: id(9000),
	name: "Azaiba",
	slug: "demo-bakery",
	isActive: true,
};
const almouj = {
	id: id(9001),
	name: "Al Mouj",
	slug: "demo-bakery-al-mouj",
	isActive: true,
};

export const DEMO_ME: AdminMe = {
	member: {
		id: id(7000),
		displayName: "Nasser",
		email: "owner@example.com",
		orgRole: "owner",
	},
	org: { id: id(8000), name: "Demo Bakery", slug: "demo-bakery" },
	locations: [
		{ location: azaiba, role: "manager" },
		{ location: almouj, role: "manager" },
	],
};

const settings = (l: typeof azaiba): AdminLocationSettings => ({
	...l,
	timezone: "Asia/Muscat",
	currencyCode: "OMR",
	pricesIncludeTax: true,
	taxBps: 500,
	vatNumber: null,
	dayCutoffMinutes: 240,
	address: null,
	phone: null,
	whatsappNumber: null,
	businessHours: null,
	theme: {},
	receiptHeader: null,
	ordersPausedUntil: null,
});
export const DEMO_LOCATIONS: AdminLocationSettings[] = [
	settings(azaiba),
	settings(almouj),
];

export function demoState(): DemoState {
	const breads = id(1);
	const pastries = id(2);
	const drinks = id(3);
	const p = (
		n: number,
		categoryId: string,
		en: string,
		ar: string,
		price: number,
		sortOrder: number,
		modifierGroupIds: string[] = [],
	): AdminProduct => ({
		id: id(n),
		categoryId,
		name: { en, ar },
		description: null,
		price,
		taxBps: null,
		imageUrl: null,
		isVisible: true,
		sortOrder,
		archivedAt: null,
		modifierGroupIds,
	});
	return {
		menu: {
			categories: [
				{
					id: breads,
					parentId: null,
					name: { en: "Breads", ar: "خبز" },
					sortOrder: 0,
					isActive: true,
				},
				{
					id: pastries,
					parentId: null,
					name: { en: "Pastries", ar: "معجنات" },
					sortOrder: 1,
					isActive: true,
				},
				{
					id: drinks,
					parentId: null,
					name: { en: "Coffee", ar: "قهوة" },
					sortOrder: 2,
					isActive: true,
				},
			],
			products: [
				p(10, breads, "Country sourdough", "خبز العجين المخمر", 2500, 0),
				p(11, breads, "Seeded rye", "خبز الجاودار بالبذور", 2800, 1),
				p(20, pastries, "Butter croissant", "كرواسون بالزبدة", 1200, 0),
				p(21, pastries, "Cardamom bun", "كعكة الهيل", 1350, 1),
				p(30, drinks, "Flat white", "فلات وايت", 1600, 0, [id(100), id(200)]),
			],
			modifierGroups: [
				{
					id: id(100),
					name: { en: "Milk", ar: "الحليب" },
					minSelect: 1,
					maxSelect: 1,
					options: [
						{
							id: id(101),
							name: { en: "Full cream", ar: "كامل الدسم" },
							priceDelta: 0,
							sortOrder: 0,
							isAvailable: true,
						},
						{
							id: id(102),
							name: { en: "Oat", ar: "حليب الشوفان" },
							priceDelta: 300,
							sortOrder: 1,
							isAvailable: true,
						},
					],
				},
				{
					id: id(200),
					name: { en: "Extras", ar: "إضافات" },
					minSelect: 0,
					maxSelect: 2,
					options: [
						{
							id: id(201),
							name: { en: "Extra shot", ar: "جرعة إضافية" },
							priceDelta: 400,
							sortOrder: 0,
							isAvailable: true,
						},
					],
				},
			],
		},
		overrides: {
			[id(9000)]: {
				[id(11)]: { price: null, isAvailable: false },
			},
			[id(9001)]: {
				[id(20)]: { price: 1300, isAvailable: true },
			},
		},
	};
}

const KEY = "bite.admin.demo.v2";

export function fixtureAdminApi(
	initial: DemoState = demoState(),
	storage: Pick<Storage, "getItem" | "setItem"> | null = typeof window ===
	"undefined"
		? null
		: window.localStorage,
): AdminApi {
	let state: DemoState = initial;
	try {
		const raw = storage?.getItem(KEY);
		if (raw) state = JSON.parse(raw) as DemoState;
	} catch {
		state = initial;
	}
	const persist = () => {
		try {
			storage?.setItem(KEY, JSON.stringify(state));
		} catch {
			// storage full or blocked: keep in memory
		}
	};
	const clone = <T>(v: T): T => structuredClone(v);
	const valid = <T>(
		schema: {
			safeParse(
				v: unknown,
			): { success: true; data: T } | { success: false; error: unknown };
		},
		v: unknown,
	): T => {
		const r = schema.safeParse(v);
		if (!r.success) throw new AdminApiError("bad_request", 400, r.error);
		return r.data;
	};
	const product = (pid: string) => {
		const p = state.menu.products.find((x) => x.id === pid);
		if (!p) throw new AdminApiError("not_found", 404);
		return p;
	};
	const checkRefs = (p: {
		categoryId?: string | undefined;
		modifierGroupIds?: string[] | undefined;
	}) => {
		if (
			p.categoryId !== undefined &&
			!state.menu.categories.some((c) => c.id === p.categoryId)
		)
			throw new AdminApiError("bad_request", 400);
		if (
			!(p.modifierGroupIds ?? []).every((g) =>
				state.menu.modifierGroups.some((x) => x.id === g),
			)
		) {
			throw new AdminApiError("bad_request", 400);
		}
	};

	return {
		async me() {
			return clone(DEMO_ME);
		},
		async locations() {
			return clone(DEMO_LOCATIONS);
		},
		async menu() {
			return clone(state.menu);
		},
		async createProduct(input) {
			const p = valid(CreateProduct, input);
			checkRefs(p);
			const created: AdminProduct = {
				id: uuidv7(),
				categoryId: p.categoryId,
				name: p.name,
				price: p.price,
				description: p.description ?? null,
				taxBps: p.taxBps ?? null,
				imageUrl: p.imageUrl ?? null,
				isVisible: p.isVisible ?? true,
				sortOrder: p.sortOrder ?? state.menu.products.length,
				modifierGroupIds: p.modifierGroupIds ?? [],
				archivedAt: null,
			};
			state.menu.products.push(created);
			persist();
			return clone(created);
		},
		async updateProduct(pid, input) {
			const p = valid(UpdateProduct, input);
			checkRefs(p);
			const existing = product(pid);
			for (const [k, v] of Object.entries(p))
				if (v !== undefined) Object.assign(existing, { [k]: v });
			persist();
			return clone(existing);
		},
		async archiveProduct(pid) {
			product(pid).archivedAt = new Date().toISOString();
			persist();
		},
		async createCategory(input) {
			const v = valid(CreateCategory, input);
			const c: AdminCategory = {
				id: uuidv7(),
				name: v.name,
				parentId: v.parentId ?? null,
				sortOrder: v.sortOrder ?? state.menu.categories.length,
				isActive: v.isActive ?? true,
			};
			state.menu.categories.push(c);
			persist();
			return clone(c);
		},
		async updateCategory(cid, input) {
			const c = state.menu.categories.find((x) => x.id === cid);
			if (!c) throw new AdminApiError("not_found", 404);
			for (const [k, v] of Object.entries(valid(UpdateCategory, input)))
				if (v !== undefined) Object.assign(c, { [k]: v });
			persist();
			return clone(c);
		},
		async locationProducts(locationId) {
			if (!DEMO_ME.locations.some((l) => l.location.id === locationId))
				throw new AdminApiError("not_found", 404);
			const o = state.overrides[locationId] ?? {};
			return state.menu.products
				.filter((p) => !p.archivedAt)
				.map((p): LocationProduct => {
					const s = o[p.id];
					const overridePrice = s?.price ?? null;
					return {
						productId: p.id,
						name: clone(p.name),
						categoryId: p.categoryId,
						basePrice: p.price,
						overridePrice,
						effectivePrice: overridePrice ?? p.price,
						isAvailable: s?.isAvailable ?? true,
					};
				});
		},
		async setLocationProduct(locationId, productId, input) {
			if (!DEMO_ME.locations.some((l) => l.location.id === locationId))
				throw new AdminApiError("not_found", 404);
			product(productId);
			const s = valid(SetLocationProduct, input);
			const loc = state.overrides[locationId] ?? {};
			state.overrides[locationId] = loc;
			if (s.price === null && s.isAvailable) delete loc[productId];
			else loc[productId] = s;
			persist();
		},
	};
}
