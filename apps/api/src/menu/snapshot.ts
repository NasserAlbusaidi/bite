import { createHash } from "node:crypto";
import type { MenuSnapshot } from "@bite/contracts";
import { schema, type Tx } from "@bite/db";
import { and, asc, eq, isNull, or } from "@bite/db/orm";

const {
	categories,
	locations,
	modifierGroups,
	modifierOptions,
	productLocationSettings,
	productModifierGroups,
	products,
	promotions,
} = schema;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * The full menu for one location, as the tablet and guest menu see it.
 * Must run inside withTenant(). Returns null if the location isn't visible.
 *
 * Included: active categories, visible non-archived products (86'd ones too,
 * with isAvailable=false), their modifier groups, active promotions for this
 * location or the whole org. The effective price applies the per-location
 * override. menuVersion is a content hash, so it changes exactly when the
 * snapshot does.
 */
export async function loadMenuSnapshot(
	tx: Tx,
	locationId: string,
	now: Date,
): Promise<MenuSnapshot | null> {
	const [loc] = await tx
		.select()
		.from(locations)
		.where(eq(locations.id, locationId));
	if (!loc) return null;

	const [cats, prods, groupLinks, groups, options, promos] = await Promise.all([
		tx
			.select()
			.from(categories)
			.where(eq(categories.isActive, true))
			.orderBy(asc(categories.sortOrder), asc(categories.id)),
		tx
			.select({
				p: products,
				overridePrice: productLocationSettings.price,
				isAvailable: productLocationSettings.isAvailable,
			})
			.from(products)
			.leftJoin(
				productLocationSettings,
				and(
					eq(productLocationSettings.productId, products.id),
					eq(productLocationSettings.locationId, locationId),
				),
			)
			.where(and(eq(products.isVisible, true), isNull(products.archivedAt)))
			.orderBy(asc(products.sortOrder), asc(products.id)),
		tx
			.select()
			.from(productModifierGroups)
			.orderBy(
				asc(productModifierGroups.sortOrder),
				asc(productModifierGroups.groupId),
			),
		tx.select().from(modifierGroups).orderBy(asc(modifierGroups.id)),
		tx
			.select()
			.from(modifierOptions)
			.orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.id)),
		tx
			.select()
			.from(promotions)
			.where(
				and(
					eq(promotions.isActive, true),
					or(
						isNull(promotions.locationId),
						eq(promotions.locationId, locationId),
					),
				),
			)
			.orderBy(asc(promotions.id)),
	]);

	const activeCats = new Set(cats.map((c) => c.id));
	const visible = prods.filter((r) => activeCats.has(r.p.categoryId));
	const groupsByProduct = new Map<string, string[]>();
	for (const l of groupLinks) {
		const list = groupsByProduct.get(l.productId) ?? [];
		list.push(l.groupId);
		groupsByProduct.set(l.productId, list);
	}
	const usedGroups = new Set(
		visible.flatMap((r) => groupsByProduct.get(r.p.id) ?? []),
	);

	const body: Omit<MenuSnapshot, "menuVersion" | "generatedAt"> = {
		location: {
			locationId: loc.id,
			currencyCode: loc.currencyCode,
			currencyDecimals: loc.currencyDecimals,
			pricesIncludeTax: loc.pricesIncludeTax,
			taxBps: loc.taxBps,
			timezone: loc.timezone,
			dayCutoffMinutes: loc.dayCutoffMinutes,
		},
		categories: cats.map((c) => ({
			id: c.id,
			parentId: c.parentId,
			name: c.name,
			sortOrder: c.sortOrder,
		})),
		products: visible.map(({ p, overridePrice, isAvailable }) => ({
			id: p.id,
			categoryId: p.categoryId,
			name: p.name,
			description: p.description ?? null,
			price: overridePrice ?? p.price,
			taxBps: p.taxBps,
			imageUrl: p.imageUrl,
			isAvailable: isAvailable ?? true,
			sortOrder: p.sortOrder,
			modifierGroupIds: groupsByProduct.get(p.id) ?? [],
		})),
		modifierGroups: groups
			.filter((g) => usedGroups.has(g.id))
			.map((g) => ({
				id: g.id,
				name: g.name,
				minSelect: g.minSelect,
				maxSelect: g.maxSelect,
				options: options
					.filter((o) => o.groupId === g.id)
					.map((o) => ({
						id: o.id,
						name: o.name,
						priceDelta: o.priceDelta,
						sortOrder: o.sortOrder,
						isAvailable: o.isAvailable,
					})),
			})),
		promotions: promos
			// Expired promotions can't apply again; drop them from the payload.
			.filter((p) => !p.endsAt || p.endsAt > now)
			.map((p) => ({
				id: p.id,
				name: p.name,
				kind: p.kind,
				value: p.value,
				productId: p.productId,
				categoryId: p.categoryId,
				startsAt: iso(p.startsAt),
				endsAt: iso(p.endsAt),
				dailyStart: p.dailyStart,
				dailyEnd: p.dailyEnd,
				daysOfWeek: p.daysOfWeek,
				priority: p.priority,
			})),
	};
	const menuVersion = createHash("sha256")
		.update(JSON.stringify(body))
		.digest("base64url")
		.slice(0, 22);
	return { ...body, menuVersion, generatedAt: now.toISOString() };
}
