/**
 * In-memory stand-in for the guest API, used when BITE_API_URL is unset
 * (local dev, tests, previews). Pricing here is a DEV STUB, not parity:
 * list price + modifier deltas, tax per line. The real API prices with core.
 */
import {
	applyRate,
	bps,
	minor,
	sum,
	taxFromInclusive,
	times,
	ZERO,
} from "@bite/core";
import type { GuestApi } from "./api.server";
import { GuestApiError } from "./api.server";
import { estimateUnit, indexMenu, validateSelection } from "./cart";
import {
	CreateGuestOrderRequest,
	type GuestOrderView,
	type PublicMenuResponse,
} from "./contracts";
import { uuidv7 } from "./uuid";

const id = (n: number) =>
	`0193a1b2-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

export const DEMO_SLUG = "demo-bakery";

export function demoMenu(): PublicMenuResponse {
	const breads = id(1);
	const pastries = id(2);
	const drinks = id(3);
	const milk = id(100);
	const extraShot = id(200);
	return {
		location: {
			slug: DEMO_SLUG,
			name: "Demo Bakery · Azaiba",
			orgName: "Demo Bakery",
			isAcceptingOrders: true,
			theme: { accent: "#b4532a" },
		},
		menu: {
			location: {
				locationId: id(9000),
				currencyCode: "OMR",
				currencyDecimals: 3,
				pricesIncludeTax: true,
				taxBps: 500,
				timezone: "Asia/Muscat",
				dayCutoffMinutes: 240,
			},
			menuVersion: "demo-1",
			generatedAt: "2026-11-17T10:00:00Z",
			categories: [
				{
					id: breads,
					parentId: null,
					name: { en: "Breads", ar: "خبز" },
					sortOrder: 0,
				},
				{
					id: pastries,
					parentId: null,
					name: { en: "Pastries", ar: "معجنات" },
					sortOrder: 1,
				},
				{
					id: drinks,
					parentId: null,
					name: { en: "Coffee", ar: "قهوة" },
					sortOrder: 2,
				},
			],
			products: [
				{
					id: id(10),
					categoryId: breads,
					name: { en: "Country sourdough", ar: "خبز العجين المخمر" },
					description: {
						en: "800 g loaf, 36 hour ferment.",
						ar: "رغيف ٨٠٠ غرام، تخمير ٣٦ ساعة.",
					},
					price: 2500,
					taxBps: null,
					imageUrl: null,
					isAvailable: true,
					sortOrder: 0,
					modifierGroupIds: [],
				},
				{
					id: id(11),
					categoryId: breads,
					name: { en: "Seeded rye", ar: "خبز الجاودار بالبذور" },
					description: null,
					price: 2800,
					taxBps: null,
					imageUrl: null,
					isAvailable: false,
					sortOrder: 1,
					modifierGroupIds: [],
				},
				{
					id: id(20),
					categoryId: pastries,
					name: { en: "Butter croissant", ar: "كرواسون بالزبدة" },
					description: {
						en: "Laminated with French butter.",
						ar: "مصنوع بالزبدة الفرنسية.",
					},
					price: 1200,
					taxBps: null,
					imageUrl: null,
					isAvailable: true,
					sortOrder: 0,
					modifierGroupIds: [],
				},
				{
					id: id(21),
					categoryId: pastries,
					name: { en: "Cardamom bun", ar: "كعكة الهيل" },
					description: null,
					price: 1350,
					taxBps: null,
					imageUrl: null,
					isAvailable: true,
					sortOrder: 1,
					modifierGroupIds: [],
				},
				{
					id: id(30),
					categoryId: drinks,
					name: { en: "Flat white", ar: "فلات وايت" },
					description: null,
					price: 1600,
					taxBps: null,
					imageUrl: null,
					isAvailable: true,
					sortOrder: 0,
					modifierGroupIds: [milk, extraShot],
				},
			],
			modifierGroups: [
				{
					id: milk,
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
						{
							id: id(103),
							name: { en: "Almond", ar: "حليب اللوز" },
							priceDelta: 300,
							sortOrder: 2,
							isAvailable: false,
						},
					],
				},
				{
					id: extraShot,
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
						{
							id: id(202),
							name: { en: "Vanilla", ar: "فانيلا" },
							priceDelta: 250,
							sortOrder: 1,
							isAvailable: true,
						},
					],
				},
			],
			promotions: [],
		},
	};
}

export function fixtureApi(
	source: () => PublicMenuResponse = demoMenu,
): GuestApi {
	const orders = new Map<string, GuestOrderView>();
	const byKey = new Map<string, { body: string; order: GuestOrderView }>();

	return {
		async getMenu(slug) {
			const m = source();
			return slug === m.location.slug ? m : null;
		},
		async getOrder(token) {
			return orders.get(token) ?? null;
		},
		async placeOrder(input, key) {
			const req = CreateGuestOrderRequest.parse(input);
			const body = JSON.stringify(req);
			const seen = byKey.get(key);
			if (seen) {
				if (seen.body !== body) throw new GuestApiError("idempotency_mismatch");
				return seen.order;
			}
			const m = source();
			if (req.locationSlug !== m.location.slug)
				throw new GuestApiError("not_found");
			if (!m.location.isAcceptingOrders) {
				throw new GuestApiError("unprocessable", {
					reason: "not_accepting_orders",
				});
			}
			const idx = indexMenu(m.menu);
			const unavailable = req.lines.filter(
				(l) => !idx.products.get(l.productId)?.isAvailable,
			);
			if (unavailable.length) {
				throw new GuestApiError("unprocessable", {
					reason: "items_unavailable",
					lineIds: unavailable.map((l) => l.id),
				});
			}
			const badMods = req.lines.filter((l) => {
				const p = idx.products.get(l.productId);
				return !p || validateSelection(p, idx, l.modifierOptionIds) !== null;
			});
			if (badMods.length) {
				throw new GuestApiError("unprocessable", {
					reason: "invalid_modifiers",
					lineIds: badMods.map((l) => l.id),
				});
			}
			const loc = m.menu.location;
			const lines = req.lines.map((l) => {
				const p = idx.products.get(l.productId);
				if (!p) throw new Error("unreachable");
				const unit = estimateUnit(p, idx, l.modifierOptionIds);
				const lineTotal = times(unit, l.quantity);
				const rate = bps(p.taxBps ?? loc.taxBps);
				const lineTax = loc.pricesIncludeTax
					? taxFromInclusive(lineTotal, rate)
					: applyRate(lineTotal, rate);
				return {
					id: l.id,
					productId: p.id,
					name: p.name,
					quantity: l.quantity,
					unitPrice: unit,
					listUnitPrice: p.price,
					promotionId: null,
					modifiers: l.modifierOptionIds.map((oid) => {
						const gid = idx.optionGroup.get(oid) ?? "";
						const opt = idx.groups.get(gid)?.options.find((o) => o.id === oid);
						return {
							groupId: gid,
							optionId: oid,
							name: opt?.name ?? { en: "?" },
							priceDelta: opt?.priceDelta ?? 0,
						};
					}),
					taxBps: rate,
					lineTotal,
					lineDiscount: ZERO,
					lineTax,
					note: l.note ?? null,
					voidedAt: null,
					voidReason: null,
				};
			});
			const gross = sum(lines.map((l) => minor(l.lineTotal)));
			const taxTotal = sum(lines.map((l) => minor(l.lineTax)));
			const order: GuestOrderView = {
				ticketNumber: `Q-${String(orders.size + 1).padStart(3, "0")}`,
				type: req.type,
				paymentStatus: "unpaid",
				fulfillmentStatus: "pending",
				subtotal: loc.pricesIncludeTax ? gross - taxTotal : gross,
				discountTotal: 0,
				taxTotal,
				total: loc.pricesIncludeTax ? gross : gross + taxTotal,
				placedAt: new Date().toISOString(),
				readyAt: null,
				lines,
				trackingToken: uuidv7(),
			};
			orders.set(order.trackingToken, order);
			byKey.set(key, { body, order });
			return order;
		},
	};
}
