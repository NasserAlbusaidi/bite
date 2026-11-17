import type { MenuSnapshot } from "@bite/contracts";

export const LOC = "0190f000-0000-7000-8000-00000000f001";
const CAT_COFFEE = "0190f000-0000-7000-8000-00000000c001";
const CAT_FOOD = "0190f000-0000-7000-8000-00000000c002";
export const P_FLAT = "0190f000-0000-7000-8000-00000000a001";
export const P_CROISSANT = "0190f000-0000-7000-8000-00000000a002";
export const P_SOLDOUT = "0190f000-0000-7000-8000-00000000a003";
export const G_MILK = "0190f000-0000-7000-8000-00000000b001";
export const O_OAT = "0190f000-0000-7000-8000-00000000d001";
export const O_FULL = "0190f000-0000-7000-8000-00000000d002";
export const PROMO = "0190f000-0000-7000-8000-00000000e001";

/** Inclusive-tax shop in Muscat, 5% VAT, 4am day cutoff, 10% off food. */
export function menuFixture(
	over: Partial<MenuSnapshot["location"]> = {},
): MenuSnapshot {
	return {
		location: {
			locationId: LOC,
			currencyCode: "OMR",
			currencyDecimals: 3,
			pricesIncludeTax: true,
			taxBps: 500,
			timezone: "Asia/Muscat",
			dayCutoffMinutes: 240,
			...over,
		},
		menuVersion: "v1",
		generatedAt: "2026-11-17T10:00:00Z",
		categories: [
			{
				id: CAT_COFFEE,
				parentId: null,
				name: { en: "Coffee", ar: "قهوة" },
				sortOrder: 0,
			},
			{ id: CAT_FOOD, parentId: null, name: { en: "Food" }, sortOrder: 1 },
		],
		products: [
			{
				id: P_FLAT,
				categoryId: CAT_COFFEE,
				name: { en: "Flat white", ar: "فلات وايت" },
				description: null,
				price: 1_800,
				taxBps: null,
				imageUrl: null,
				isAvailable: true,
				sortOrder: 0,
				modifierGroupIds: [G_MILK],
			},
			{
				id: P_CROISSANT,
				categoryId: CAT_FOOD,
				name: { en: "Croissant" },
				description: null,
				price: 1_250,
				taxBps: null,
				imageUrl: null,
				isAvailable: true,
				sortOrder: 0,
				modifierGroupIds: [],
			},
			{
				id: P_SOLDOUT,
				categoryId: CAT_FOOD,
				name: { en: "Cookie" },
				description: null,
				price: 500,
				taxBps: null,
				imageUrl: null,
				isAvailable: false,
				sortOrder: 1,
				modifierGroupIds: [],
			},
		],
		modifierGroups: [
			{
				id: G_MILK,
				name: { en: "Milk" },
				minSelect: 1,
				maxSelect: 1,
				options: [
					{
						id: O_FULL,
						name: { en: "Full cream" },
						priceDelta: 0,
						sortOrder: 0,
						isAvailable: true,
					},
					{
						id: O_OAT,
						name: { en: "Oat" },
						priceDelta: 300,
						sortOrder: 1,
						isAvailable: true,
					},
				],
			},
		],
		promotions: [
			{
				id: PROMO,
				name: "Food 10%",
				kind: "percent",
				value: 1_000,
				productId: null,
				categoryId: CAT_FOOD,
				startsAt: null,
				endsAt: null,
				dailyStart: null,
				dailyEnd: null,
				daysOfWeek: null,
				priority: 0,
			},
		],
	};
}
