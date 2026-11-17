import type { MenuProduct, MenuSnapshot } from "@bite/contracts";
import {
	type BasisPoints,
	buildCatalog,
	type Catalog,
	type LocalizedText,
	localClock,
	type Minor,
	type Promotion,
	promotedUnitPrice,
} from "@bite/core";
import type { SqlExecutor } from "../db/driver.js";
import { kvGet, kvSet } from "../db/kv.js";

const KEY = "menu.snapshot";

export async function loadMenu(db: SqlExecutor): Promise<MenuSnapshot | null> {
	const raw = await kvGet(db, KEY);
	return raw ? (JSON.parse(raw) as MenuSnapshot) : null;
}

export async function saveMenu(
	db: SqlExecutor,
	menu: MenuSnapshot,
): Promise<void> {
	await kvSet(db, KEY, JSON.stringify(menu));
}

/** Menu shaped for core. Contracts use plain numbers; core brands them. */
export type PricedMenu = {
	snapshot: MenuSnapshot;
	catalog: Catalog;
	promotions: Promotion[];
};

export function prepareMenu(snapshot: MenuSnapshot): PricedMenu {
	const catalog = buildCatalog(
		snapshot.products.map((p) => ({
			id: p.id,
			categoryId: p.categoryId,
			name: p.name as LocalizedText,
			price: p.price as Minor,
			taxBps: p.taxBps as BasisPoints | null,
			isAvailable: p.isAvailable,
			modifierGroupIds: p.modifierGroupIds,
		})),
		snapshot.modifierGroups.map((g) => ({
			id: g.id,
			name: g.name as LocalizedText,
			minSelect: g.minSelect,
			maxSelect: g.maxSelect,
			options: [...g.options]
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map((o) => ({
					id: o.id,
					name: o.name as LocalizedText,
					priceDelta: o.priceDelta as Minor,
					isAvailable: o.isAvailable,
				})),
		})),
	);
	const promotions: Promotion[] = snapshot.promotions.map((p) => ({
		id: p.id,
		kind: p.kind,
		value: p.value,
		productId: p.productId,
		categoryId: p.categoryId,
		startsAt: p.startsAt,
		endsAt: p.endsAt,
		dailyStart: p.dailyStart,
		dailyEnd: p.dailyEnd,
		daysOfWeek: p.daysOfWeek,
		priority: p.priority,
	}));
	return { snapshot, catalog, promotions };
}

/** Price shown on the product tile right now (promotion applied, before modifiers). */
export function tilePrice(
	menu: PricedMenu,
	product: MenuProduct,
	nowMs: number,
) {
	return promotedUnitPrice(
		{
			id: product.id,
			categoryId: product.categoryId,
			price: product.price as Minor,
		},
		menu.promotions,
		localClock(nowMs, menu.snapshot.location.timezone),
		menu.snapshot.location.locationId,
	);
}
