/**
 * In-memory stand-in for the guest API, used when BITE_API_URL is unset
 * (local dev, tests, previews). Prices with @bite/core like the real API,
 * but skips everything else the API checks (tenancy, rate limits, shifts).
 */
import { bps, priceCart } from "@bite/core";
import type { GuestApi } from "./api.server";
import { GuestApiError } from "./api.server";
import {
	CreateGuestOrderRequest,
	type GuestOrderView,
	type PublicMenuResponse,
} from "./contracts";
import { clockFor, menuPricing } from "./pricing";
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
			promotions: [
				{
					id: id(500),
					name: "Pastry hour",
					kind: "percent",
					value: 2000,
					productId: null,
					categoryId: pastries,
					startsAt: null,
					endsAt: null,
					dailyStart: null,
					dailyEnd: null,
					daysOfWeek: null,
					priority: 0,
				},
			],
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
			const pricing = menuPricing(m.menu);
			const priced = priceCart(
				req.lines.map((l) => ({ ...l, note: l.note ?? null })),
				pricing.catalog,
				{
					settings: {
						pricesIncludeTax: m.menu.location.pricesIncludeTax,
						taxBps: bps(m.menu.location.taxBps),
						locationId: m.menu.location.locationId,
					},
					promotions: pricing.promotions,
					at: clockFor(pricing, Date.now()),
				},
			);
			if (!priced.ok) {
				const lineIds = (codes: string[]) =>
					priced.errors.flatMap((e) =>
						codes.includes(e.code) && e.lineIndex !== undefined
							? [req.lines[e.lineIndex]?.id ?? ""]
							: [],
					);
				const unavailable = lineIds(["unknown_product", "product_unavailable"]);
				if (unavailable.length) {
					throw new GuestApiError("unprocessable", {
						reason: "items_unavailable",
						lineIds: unavailable,
					});
				}
				const mods = lineIds([
					"invalid_modifier",
					"duplicate_modifier",
					"modifier_unavailable",
					"modifier_below_min",
					"modifier_above_max",
				]);
				if (mods.length) {
					throw new GuestApiError("unprocessable", {
						reason: "invalid_modifiers",
						lineIds: mods,
					});
				}
				throw new GuestApiError("unprocessable", { reason: "total_too_high" });
			}
			const p = priced.value;
			const lines = p.lines.map((l, i) => ({
				id: req.lines[i]?.id ?? uuidv7(),
				productId: l.productId,
				name: l.name,
				quantity: l.quantity,
				unitPrice: l.unitPrice,
				listUnitPrice: l.listUnitPrice,
				promotionId: l.promotionId,
				modifiers: [...l.modifiers],
				taxBps: l.taxBps,
				lineTotal: l.lineTotal,
				lineDiscount: l.lineDiscount,
				lineTax: l.lineTax,
				note: l.note,
				voidedAt: null,
				voidReason: null,
			}));
			const order: GuestOrderView = {
				ticketNumber: `Q-${String(orders.size + 1).padStart(3, "0")}`,
				type: req.type,
				paymentStatus: "unpaid",
				fulfillmentStatus: "pending",
				subtotal: p.subtotal,
				discountTotal: p.discountTotal,
				taxTotal: p.taxTotal,
				total: p.total,
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
