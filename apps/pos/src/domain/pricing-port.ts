/**
 * TEMPORARY type port for @bite/core pricing (core PR #3, docs/core-api.md,
 * not merged yet). The POS never prices on its own: when #3 lands this file
 * becomes a re-export of LineInput/PricedOrder/priceLines/localClock/businessDate.
 */
import type { BasisPoints, Minor } from "@bite/core";

export type LocalizedText = { en: string; ar?: string };

export type CartModifier = {
	groupId: string;
	optionId: string;
	name: LocalizedText;
	priceDelta: Minor;
};

export type LineInput = {
	productId: string | null;
	categoryId: string | null;
	name: LocalizedText;
	quantity: number;
	/** List price (before promotions). */
	listUnitPrice: Minor;
	modifiers: CartModifier[];
	/** Null = location default. */
	taxBps: BasisPoints | null;
};

export type PricedLine = {
	listUnitPrice: Minor;
	unitPrice: Minor;
	promotionId: string | null;
	lineTotal: Minor;
	lineDiscount: Minor;
	lineTax: Minor;
	taxBps: BasisPoints;
};

export type PricedOrder = {
	lines: PricedLine[];
	subtotal: Minor;
	discountTotal: Minor;
	taxTotal: Minor;
	total: Minor;
};

export type PricingSettings = {
	pricesIncludeTax: boolean;
	taxBps: BasisPoints;
	locationId: string;
};

/** Opaque here; built by core's localClock(epochMs, timeZone). */
export type LocalClock = { readonly __localClock: unique symbol };

export type PriceLinesFn = (
	lines: LineInput[],
	opts: { settings: PricingSettings; promotions: unknown[]; at: LocalClock },
) => { ok: true; value: PricedOrder } | { ok: false; errors: unknown[] };

export type BusinessDateFn = (
	epochMs: number,
	timeZone: string,
	dayCutoffMinutes: number,
) => string;
