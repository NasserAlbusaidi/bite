import { clockAt, type LocalClock } from "./clock.js";
import { type BasisPoints, bps, type Minor, minor } from "./money.js";
import type {
	LineInput,
	ModifierSnapshot,
	PricingContext,
	PricingSettings,
} from "./pricing.js";
import type { Promotion } from "./promotions.js";

export const m = (n: number): Minor => minor(n);

/** 2026-03-19 is a Thursday. */
export const THU_2PM: LocalClock = clockAt("2026-03-19", "14:00:00");

export function line(
	over: Partial<LineInput> & {
		price?: number;
		tax?: number | null;
		mods?: number[];
	} = {},
): LineInput {
	const { price, tax, mods, ...rest } = over;
	return {
		productId: "p1",
		categoryId: "c1",
		name: { en: "Item" },
		quantity: 1,
		listUnitPrice: m(price ?? 1000),
		taxBps: tax === undefined || tax === null ? null : bps(tax),
		modifiers: (mods ?? []).map(
			(d, i): ModifierSnapshot => ({
				groupId: "g1",
				optionId: `o${i}`,
				name: { en: `Mod ${i}` },
				priceDelta: m(d),
			}),
		),
		...rest,
	};
}

export function ctx(
	settings: Partial<PricingSettings> = {},
	promotions: Promotion[] = [],
	at: LocalClock = THU_2PM,
): PricingContext {
	return {
		settings: {
			pricesIncludeTax: false,
			taxBps: bps(0) as BasisPoints,
			...settings,
		},
		promotions,
		at,
	};
}
