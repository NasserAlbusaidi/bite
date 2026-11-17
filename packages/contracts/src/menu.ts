import { z } from "zod";
import {
	Bps,
	Id,
	Instant,
	LocalizedText,
	Minor,
	NonNegMinor,
} from "./common.js";

/** What @bite/core pricing needs from the location. Snapshotted on orders. */
export const LocationPricing = z.object({
	locationId: Id,
	currencyCode: z.string().length(3),
	currencyDecimals: z.int().min(0).max(4),
	pricesIncludeTax: z.boolean(),
	taxBps: Bps,
	timezone: z.string(),
	dayCutoffMinutes: z.int().min(0).max(1439),
});
export type LocationPricing = z.infer<typeof LocationPricing>;

export const MenuCategory = z.object({
	id: Id,
	parentId: Id.nullable(),
	name: LocalizedText,
	sortOrder: z.int(),
});

export const MenuModifierOption = z.object({
	id: Id,
	name: LocalizedText,
	priceDelta: Minor,
	sortOrder: z.int(),
	isAvailable: z.boolean(),
});

export const MenuModifierGroup = z.object({
	id: Id,
	name: LocalizedText,
	minSelect: z.int().min(0),
	maxSelect: z.int().min(1),
	options: z.array(MenuModifierOption),
});

export const MenuProduct = z.object({
	id: Id,
	categoryId: Id,
	name: LocalizedText,
	description: LocalizedText.nullable(),
	/** Effective price at this location (override applied). Gross or net per LocationPricing. */
	price: NonNegMinor,
	/** Null = use LocationPricing.taxBps. */
	taxBps: Bps.nullable(),
	imageUrl: z.string().nullable(),
	/** False = 86'd at this location. */
	isAvailable: z.boolean(),
	sortOrder: z.int(),
	modifierGroupIds: z.array(Id),
});

export const MenuPromotion = z.object({
	id: Id,
	name: z.string(),
	kind: z.enum(["percent", "fixed"]),
	/** Bps when percent, minor units off the unit price when fixed. */
	value: z.int().min(1),
	productId: Id.nullable(),
	categoryId: Id.nullable(),
	startsAt: Instant.nullable(),
	endsAt: Instant.nullable(),
	/** Local "HH:MM:SS"; may wrap midnight. */
	dailyStart: z.string().nullable(),
	dailyEnd: z.string().nullable(),
	/** 0 = Sunday. Null = every day. */
	daysOfWeek: z.array(z.int().min(0).max(6)).nullable(),
	priority: z.int(),
});

/**
 * Everything a tablet needs to price offline, or the guest menu needs to render.
 * Archived and hidden products are excluded; 86'd products are included with
 * isAvailable=false so the POS can grey them out.
 */
export const MenuSnapshot = z.object({
	location: LocationPricing,
	/** Changes whenever anything in the snapshot changes. Use as ETag. */
	menuVersion: z.string(),
	generatedAt: Instant,
	categories: z.array(MenuCategory),
	products: z.array(MenuProduct),
	modifierGroups: z.array(MenuModifierGroup),
	promotions: z.array(MenuPromotion),
});
export type MenuSnapshot = z.infer<typeof MenuSnapshot>;

/** 86 / un-86 a product at the caller's location. */
export const SetAvailabilityRequest = z.object({ isAvailable: z.boolean() });
