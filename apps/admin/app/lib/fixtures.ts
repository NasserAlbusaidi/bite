/**
 * Demo back office that runs entirely in the browser (VITE_API_URL unset).
 * State persists in localStorage so edits survive a refresh. Validation is
 * the same schema validation the API does; tenancy and auth are not modelled.
 */
import { type AdminApi, AdminApiError } from "./api-types";
import {
	type AdminCategory,
	type AdminDevice,
	type AdminLocationSettings,
	type AdminMe,
	type AdminMenu,
	type AdminModifierGroup,
	type AdminProduct,
	type AdminPromotion,
	type AdminStaff,
	CreateCategory,
	CreateModifierGroup,
	CreateModifierOption,
	CreatePinStaff,
	CreateProduct,
	CreatePromotion,
	InviteStaff,
	type InviteStaffResponse,
	type LocationProduct,
	RegisterDeviceRequest,
	ResetPin,
	SetLocationProduct,
	UpdateCategory,
	UpdateLocation,
	UpdateModifierGroup,
	UpdateModifierOption,
	UpdateProduct,
	UpdatePromotion,
	UpdateStaff,
} from "./contracts";
import { demoOrders, demoReport, ordersCsv } from "./demo-orders";
import { uuidv7 } from "./uuid";

const id = (n: number) =>
	`0193a1b2-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

type DemoState = {
	menu: AdminMenu;
	/** locationId -> productId -> override */
	overrides: Record<string, Record<string, SetLocationProduct>>;
	promotions: AdminPromotion[];
	staff: AdminStaff[];
	locations: AdminLocationSettings[];
	devices: AdminDevice[];
	/** memberId -> invited email, until accepted. Missing in older saves. */
	pendingInvites?: Record<string, string>;
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
		promotions: [
			{
				id: id(500),
				locationId: null,
				name: "Pastry hour",
				kind: "percent",
				value: 2000,
				productId: null,
				categoryId: pastries,
				startsAt: null,
				endsAt: null,
				dailyStart: "07:00",
				dailyEnd: "09:00",
				daysOfWeek: null,
				priority: 0,
				isActive: true,
			},
		],
		staff: [
			{
				id: DEMO_ME.member.id,
				displayName: "Nasser",
				email: "owner@example.com",
				orgRole: "owner",
				hasPin: true,
				isActive: true,
				locations: [
					{ locationId: id(9000), role: "manager" },
					{ locationId: id(9001), role: "manager" },
				],
			},
			{
				id: id(7001),
				displayName: "Mohammed",
				email: "manager@example.com",
				orgRole: "staff",
				hasPin: true,
				isActive: true,
				locations: [{ locationId: id(9000), role: "manager" }],
			},
			{
				id: id(7002),
				displayName: "Aisha",
				email: null,
				orgRole: "staff",
				hasPin: true,
				isActive: true,
				locations: [{ locationId: id(9000), role: "cashier" }],
			},
			{
				id: id(7003),
				displayName: "Ravi",
				email: null,
				orgRole: "staff",
				hasPin: true,
				isActive: true,
				locations: [
					{ locationId: id(9000), role: "kitchen" },
					{ locationId: id(9001), role: "kitchen" },
				],
			},
		],
		locations: structuredClone(DEMO_LOCATIONS),
		devices: [
			{
				id: id(600),
				locationId: id(9000),
				name: "Counter iPad",
				kind: "pos",
				ticketPrefix: "A",
				lastSeenAt: "2026-11-17T10:12:00Z",
				revokedAt: null,
			},
			{
				id: id(601),
				locationId: id(9000),
				name: "Kitchen screen",
				kind: "kds",
				ticketPrefix: "K",
				lastSeenAt: "2026-11-17T10:14:00Z",
				revokedAt: null,
			},
		],
	};
}

const KEY = "bite.admin.demo.v5";

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
	const group = (gid: string) => {
		const g = state.menu.modifierGroups.find((x) => x.id === gid);
		if (!g) throw new AdminApiError("not_found", 404);
		return g;
	};
	const defined = <T extends object>(o: T) =>
		Object.fromEntries(
			Object.entries(o).filter(([, v]) => v !== undefined),
		) as Partial<T>;
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

	const checkPromoRefs = (p: {
		locationId?: string | null | undefined;
		productId?: string | null | undefined;
		categoryId?: string | null | undefined;
	}) => {
		if (
			p.locationId &&
			!DEMO_ME.locations.some((l) => l.location.id === p.locationId)
		)
			throw new AdminApiError("bad_request", 400);
		if (p.productId) product(p.productId);
		if (
			p.categoryId &&
			!state.menu.categories.some((c) => c.id === p.categoryId)
		)
			throw new AdminApiError("bad_request", 400);
	};

	const member = (sid: string) => {
		const s = state.staff.find((x) => x.id === sid);
		if (!s) throw new AdminApiError("not_found", 404);
		return s;
	};
	/** Same shape the API returns: a fresh one-time token, valid 7 days. */
	const issueInvite = (sid: string, email: string): InviteStaffResponse => {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		const inviteToken = btoa(String.fromCharCode(...bytes))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replace(/=+$/, "");
		state.pendingInvites = { ...state.pendingInvites, [sid]: email };
		return {
			staff: clone(member(sid)),
			inviteToken,
			expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
		};
	};
	const checkStaffLocations = (ls: { locationId: string }[]) => {
		const ids = ls.map((l) => l.locationId);
		if (
			new Set(ids).size !== ids.length ||
			!ids.every((i) => DEMO_ME.locations.some((l) => l.location.id === i))
		)
			throw new AdminApiError("bad_request", 400);
	};

	return {
		async me() {
			const me = clone(DEMO_ME);
			for (const l of me.locations) {
				const s = state.locations.find((x) => x.id === l.location.id);
				if (s)
					l.location = {
						id: s.id,
						name: s.name,
						slug: s.slug,
						isActive: s.isActive,
					};
			}
			return me;
		},
		async locations() {
			return clone(state.locations);
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
		async createModifierGroup(input) {
			const v = valid(CreateModifierGroup, input);
			const g: AdminModifierGroup = { id: uuidv7(), ...v, options: [] };
			state.menu.modifierGroups.push(g);
			persist();
			return clone(g);
		},
		async updateModifierGroup(gid, input) {
			const g = group(gid);
			const v = valid(UpdateModifierGroup, input);
			const next = {
				name: v.name ?? g.name,
				minSelect: v.minSelect ?? g.minSelect,
				maxSelect: v.maxSelect ?? g.maxSelect,
			};
			if (next.maxSelect < next.minSelect)
				throw new AdminApiError("bad_request", 400);
			Object.assign(g, next);
			persist();
			return clone(g);
		},
		async createModifierOption(gid, input) {
			const g = group(gid);
			const v = valid(CreateModifierOption, input);
			g.options.push({
				id: uuidv7(),
				name: v.name,
				priceDelta: v.priceDelta ?? 0,
				sortOrder: v.sortOrder ?? g.options.length,
				isAvailable: v.isAvailable ?? true,
			});
			persist();
			return clone(g);
		},
		async updateModifierOption(gid, oid, input) {
			const g = group(gid);
			const o = g.options.find((x) => x.id === oid);
			if (!o) throw new AdminApiError("not_found", 404);
			Object.assign(o, defined(valid(UpdateModifierOption, input)));
			persist();
			return clone(g);
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
		async promotions() {
			return clone(state.promotions);
		},
		async createPromotion(input) {
			const v = valid(CreatePromotion, input);
			checkPromoRefs(v);
			const created: AdminPromotion = {
				id: uuidv7(),
				name: v.name,
				kind: v.kind,
				value: v.value,
				locationId: v.locationId ?? null,
				productId: v.productId ?? null,
				categoryId: v.categoryId ?? null,
				startsAt: v.startsAt ?? null,
				endsAt: v.endsAt ?? null,
				dailyStart: v.dailyStart ?? null,
				dailyEnd: v.dailyEnd ?? null,
				daysOfWeek: v.daysOfWeek ?? null,
				priority: v.priority ?? 0,
				isActive: v.isActive ?? true,
			};
			state.promotions.push(created);
			persist();
			return clone(created);
		},
		async updatePromotion(pid, input) {
			const existing = state.promotions.find((p) => p.id === pid);
			if (!existing) throw new AdminApiError("not_found", 404);
			const v = valid(UpdatePromotion, input);
			// Rules apply to the merged result, the way the API checks it.
			const merged = { ...existing };
			for (const [k, val] of Object.entries(v))
				if (val !== undefined) Object.assign(merged, { [k]: val });
			valid(CreatePromotion, merged);
			checkPromoRefs(merged);
			Object.assign(existing, merged);
			persist();
			return clone(existing);
		},
		async updateLocation(lid, input) {
			const l = state.locations.find((x) => x.id === lid);
			if (!l) throw new AdminApiError("not_found", 404);
			for (const [k, v] of Object.entries(valid(UpdateLocation, input)))
				if (v !== undefined) Object.assign(l, { [k]: v });
			persist();
			return clone(l);
		},
		async devices(lid) {
			if (!state.locations.some((x) => x.id === lid))
				throw new AdminApiError("not_found", 404);
			return clone(state.devices.filter((d) => d.locationId === lid));
		},
		async registerDevice(input) {
			const v = valid(RegisterDeviceRequest, input);
			if (v.ticketPrefix === "G") throw new AdminApiError("bad_request", 400);
			if (!state.locations.some((x) => x.id === v.locationId))
				throw new AdminApiError("not_found", 404);
			if (
				state.devices.some(
					(d) =>
						d.locationId === v.locationId &&
						!d.revokedAt &&
						d.ticketPrefix === v.ticketPrefix,
				)
			)
				throw new AdminApiError("conflict", 409);
			const deviceId = uuidv7();
			state.devices.push({
				id: deviceId,
				locationId: v.locationId,
				name: v.name,
				kind: v.kind,
				ticketPrefix: v.ticketPrefix,
				lastSeenAt: null,
				revokedAt: null,
			});
			persist();
			// Demo only: a real token comes from the API and is shown once.
			return { deviceId, token: `demo_${deviceId.replaceAll("-", "")}` };
		},
		async revokeDevice(did) {
			const d = state.devices.find((x) => x.id === did);
			if (!d) throw new AdminApiError("not_found", 404);
			d.revokedAt ??= new Date().toISOString();
			persist();
		},
		async salesReport(q) {
			if (!state.locations.some((x) => x.id === q.locationId))
				throw new AdminApiError("not_found", 404);
			const orders = demoOrders(q.locationId, state.menu, q.from, q.to);
			return demoReport(q.locationId, q.from, q.to, orders, state.menu);
		},
		async orders(q) {
			if (!state.locations.some((x) => x.id === q.locationId))
				throw new AdminApiError("not_found", 404);
			const rows = demoOrders(q.locationId, state.menu, q.from, q.to)
				.map((o) => o.row)
				.filter(
					(r) =>
						(!q.paymentStatus || r.paymentStatus === q.paymentStatus) &&
						(!q.fulfillmentStatus ||
							r.fulfillmentStatus === q.fulfillmentStatus),
				)
				.sort((a, b) => b.placedAt.localeCompare(a.placedAt));
			const start = q.cursor ? Number.parseInt(q.cursor, 10) : 0;
			const limit = q.limit ?? 50;
			const items = rows.slice(start, start + limit);
			const next = start + limit;
			return next < rows.length
				? { items, nextCursor: String(next) }
				: { items };
		},
		async ordersCsv(q) {
			const { items } = await this.orders({ ...q, limit: 100_000 });
			return new Blob([ordersCsv(items, 3)], { type: "text/csv" });
		},
		async staff() {
			return clone(state.staff);
		},
		async inviteStaff(input) {
			const v = valid(InviteStaff, input);
			checkStaffLocations(v.locations);
			if (
				state.staff.some(
					(s) => s.email?.toLowerCase() === v.email.toLowerCase(),
				)
			)
				throw new AdminApiError("conflict", 409);
			const created: AdminStaff = {
				id: uuidv7(),
				displayName: v.displayName,
				email: v.email,
				orgRole: v.orgRole,
				hasPin: false,
				isActive: true,
				locations: v.locations,
			};
			state.staff.push(created);
			const res = issueInvite(created.id, v.email);
			persist();
			return res;
		},
		async reissueInvite(sid) {
			const s = member(sid);
			const email = state.pendingInvites?.[sid];
			if (!email) throw new AdminApiError("conflict", 409);
			const res = issueInvite(s.id, email);
			persist();
			return res;
		},
		async createPinStaff(input) {
			const v = valid(CreatePinStaff, input);
			checkStaffLocations(v.locations);
			const created: AdminStaff = {
				id: uuidv7(),
				displayName: v.displayName,
				email: null,
				orgRole: "staff",
				hasPin: true,
				isActive: true,
				locations: v.locations,
			};
			state.staff.push(created);
			persist();
			return clone(created);
		},
		async updateStaff(sid, input) {
			const s = member(sid);
			const v = valid(UpdateStaff, input);
			if (s.orgRole === "owner" && v.orgRole !== undefined)
				throw new AdminApiError("forbidden", 403);
			if (v.locations) checkStaffLocations(v.locations);
			if (v.displayName !== undefined) s.displayName = v.displayName;
			if (v.orgRole !== undefined) s.orgRole = v.orgRole;
			if (v.locations !== undefined) s.locations = v.locations;
			persist();
			return clone(s);
		},
		async resetPin(sid, pin) {
			valid(ResetPin, { pin });
			member(sid).hasPin = true;
			persist();
		},
		async deactivateStaff(sid) {
			const s = member(sid);
			if (s.orgRole === "owner") throw new AdminApiError("forbidden", 403);
			s.isActive = false;
			persist();
		},
	};
}
