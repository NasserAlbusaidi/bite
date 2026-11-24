import type { AdminCategory, AdminProduct, CreateProduct } from "./contracts";

/** What the menu page can narrow the list down to. */
export type MenuFilter = "all" | "hidden" | "no_photo" | "no_arabic";

export const MENU_FILTERS: MenuFilter[] = [
	"all",
	"hidden",
	"no_photo",
	"no_arabic",
];

const missingArabic = (p: AdminProduct) =>
	!p.name.ar?.trim() || (!!p.description?.en && !p.description.ar?.trim());

export function matchesFilter(p: AdminProduct, f: MenuFilter): boolean {
	switch (f) {
		case "hidden":
			return !p.isVisible;
		case "no_photo":
			return !p.imageUrl;
		case "no_arabic":
			return missingArabic(p);
		default:
			return true;
	}
}

/** Case-insensitive across both languages, names and descriptions. */
export function matchesQuery(p: AdminProduct, q: string): boolean {
	const needle = q.trim().toLowerCase();
	if (!needle) return true;
	return [p.name.en, p.name.ar, p.description?.en, p.description?.ar].some(
		(s) => !!s && s.toLowerCase().includes(needle),
	);
}

/** How many live products each filter would show. */
export function filterCounts(products: AdminProduct[]) {
	const out = {} as Record<MenuFilter, number>;
	for (const f of MENU_FILTERS)
		out[f] = products.filter((p) => matchesFilter(p, f)).length;
	return out;
}

export const bySort = <T extends { sortOrder: number; id: string }>(
	a: T,
	b: T,
) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

export function sortedCategories(categories: AdminCategory[]) {
	return [...categories].sort(bySort);
}

/** Move `id` to `targetId`'s slot (before it going up, after it going down). */
export function moveTo(ids: string[], id: string, targetId: string): string[] {
	const from = ids.indexOf(id);
	const to = ids.indexOf(targetId);
	if (from < 0 || to < 0 || from === to) return ids;
	const next = ids.filter((x) => x !== id);
	next.splice(to, 0, id);
	return next;
}

/** Move one step up (-1) or down (+1); clamps at the ends. */
export function moveBy(ids: string[], id: string, step: -1 | 1): string[] {
	const from = ids.indexOf(id);
	const to = from + step;
	if (from < 0 || to < 0 || to >= ids.length) return ids;
	const next = [...ids];
	next[from] = ids[to] as string;
	next[to] = id;
	return next;
}

/** Sort orders 0..n-1 in list order: the body of PATCH /…/order. */
export const reorderBody = (ids: string[]) =>
	ids.map((id, sortOrder) => ({ id, sortOrder }));

/**
 * A copy of a product, hidden until someone checks it: a duplicate that
 * goes straight onto the guest menu with "(copy)" in its name is a bug report.
 */
export function duplicateOf(
	p: AdminProduct,
	sortOrder: number,
	suffix: { en: string; ar: string },
): CreateProduct {
	return {
		categoryId: p.categoryId,
		name: p.name.ar
			? { en: `${p.name.en} ${suffix.en}`, ar: `${p.name.ar} ${suffix.ar}` }
			: { en: `${p.name.en} ${suffix.en}` },
		description: p.description,
		price: p.price,
		taxBps: p.taxBps,
		imageUrl: p.imageUrl,
		isVisible: false,
		sortOrder,
		modifierGroupIds: [...p.modifierGroupIds],
		dietaryTags: [...(p.dietaryTags ?? [])],
	};
}

/** Next free sort order at the end of a category. */
export function endOf(products: AdminProduct[], categoryId: string): number {
	const mine = products.filter(
		(p) => p.categoryId === categoryId && !p.archivedAt,
	);
	return mine.length === 0 ? 0 : Math.max(...mine.map((p) => p.sortOrder)) + 1;
}

/** "Rye", "كرواسون" → "R", "ك": the placeholder tile when there's no photo. */
export const initial = (name: string) =>
	Array.from(name.trim())[0]?.toUpperCase() ?? "·";
