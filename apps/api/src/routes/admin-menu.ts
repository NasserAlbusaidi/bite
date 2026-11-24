import {
	type AdminCategory,
	type AdminModifierGroup,
	type AdminProduct,
	type AdminPromotion,
	CreateCategory,
	CreateModifierGroup,
	CreateModifierOption,
	CreateProduct,
	CreatePromotion,
	DIETARY_TAGS,
	type LocationProduct,
	Reorder,
	SetLocationProduct,
	UpdateCategory,
	UpdateModifierGroup,
	UpdateModifierOption,
	UpdateProduct,
	UpdatePromotion,
} from "@bite/contracts";
import { schema, type Tx } from "@bite/db";
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from "@bite/db/orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { requireRoomFor } from "../lib/entitlements.js";
import { ApiError } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import {
	adminTx,
	requireLocation,
	requireOrgWide,
} from "../middleware/admin-auth.js";

const {
	categories,
	products,
	productLocationSettings,
	productModifierGroups,
	modifierGroups,
	modifierOptions,
	promotions,
} = schema;

type Loc = { en: string; ar?: string | undefined };
/** Contract text -> DB jsonb (drop an explicit undefined `ar`). */
const loc = (t: Loc) => (t.ar ? { en: t.en, ar: t.ar } : { en: t.en });
const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** Drop undefined keys so a PATCH only touches what was sent. */
function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(o).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}
const idParam = z.object({ id: z.uuid() });
const notFound = (what: string) =>
	new ApiError("not_found", `${what} not found`);

// ---------------------------------------------------------------- DTOs

type CategoryRow = typeof categories.$inferSelect;
const categoryDto = (r: CategoryRow): AdminCategory => ({
	id: r.id,
	parentId: r.parentId,
	name: r.name,
	sortOrder: r.sortOrder,
	isActive: r.isActive,
});

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

type ProductRow = typeof products.$inferSelect;
const productDto = (r: ProductRow, groupIds: string[]): AdminProduct => ({
	id: r.id,
	categoryId: r.categoryId,
	name: r.name,
	description: r.description,
	price: r.price,
	taxBps: r.taxBps,
	imageUrl: r.imageUrl,
	dietaryTags: DIETARY_TAGS.filter((t) => r.dietaryTags.includes(t)),
	isVisible: r.isVisible,
	sortOrder: r.sortOrder,
	modifierGroupIds: groupIds,
	archivedAt: iso(r.archivedAt),
});

async function groupIdsFor(tx: Tx, productIds: string[]) {
	const m = new Map<string, string[]>();
	if (productIds.length === 0) return m;
	const rows = await tx
		.select()
		.from(productModifierGroups)
		.where(inArray(productModifierGroups.productId, productIds))
		.orderBy(asc(productModifierGroups.sortOrder));
	for (const r of rows) {
		const list = m.get(r.productId) ?? [];
		list.push(r.groupId);
		m.set(r.productId, list);
	}
	return m;
}

async function loadProduct(tx: Tx, id: string) {
	const [p] = await tx.select().from(products).where(eq(products.id, id));
	if (!p) throw notFound("product");
	const g = await groupIdsFor(tx, [id]);
	return productDto(p, g.get(id) ?? []);
}

async function setProductGroups(
	tx: Tx,
	orgId: string,
	id: string,
	ids: string[],
) {
	if (new Set(ids).size !== ids.length) {
		throw new ApiError("bad_request", "duplicate modifier group");
	}
	await tx
		.delete(productModifierGroups)
		.where(eq(productModifierGroups.productId, id));
	if (ids.length === 0) return;
	await tx.insert(productModifierGroups).values(
		ids.map((groupId, i) => ({
			orgId,
			productId: id,
			groupId,
			sortOrder: i,
		})),
	);
}

async function loadGroups(tx: Tx, where?: SQL): Promise<AdminModifierGroup[]> {
	const groups = await tx
		.select()
		.from(modifierGroups)
		.where(where)
		.orderBy(asc(modifierGroups.createdAt), asc(modifierGroups.id));
	if (groups.length === 0) return [];
	const opts = await tx
		.select()
		.from(modifierOptions)
		.where(
			inArray(
				modifierOptions.groupId,
				groups.map((g) => g.id),
			),
		)
		.orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.id));
	return groups.map((g) => ({
		id: g.id,
		name: g.name,
		minSelect: g.minSelect,
		maxSelect: g.maxSelect,
		options: opts
			.filter((o) => o.groupId === g.id)
			.map((o) => ({
				id: o.id,
				name: o.name,
				priceDelta: o.priceDelta,
				sortOrder: o.sortOrder,
				isAvailable: o.isAvailable,
			})),
	}));
}

async function loadGroup(tx: Tx, id: string) {
	const [g] = await loadGroups(tx, eq(modifierGroups.id, id));
	if (!g) throw notFound("modifier group");
	return g;
}

type PromotionRow = typeof promotions.$inferSelect;
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const promotionDto = (r: PromotionRow): AdminPromotion => ({
	id: r.id,
	locationId: r.locationId,
	name: r.name,
	kind: r.kind,
	value: r.value,
	productId: r.productId,
	categoryId: r.categoryId,
	startsAt: iso(r.startsAt),
	endsAt: iso(r.endsAt),
	dailyStart: hhmm(r.dailyStart),
	dailyEnd: hhmm(r.dailyEnd),
	daysOfWeek: r.daysOfWeek,
	priority: r.priority,
	isActive: r.isActive,
});

/** Org-wide promotions (locationId null) need owner/admin; location ones need that location. */
function requirePromotionScope(
	c: Parameters<typeof requireOrgWide>[0],
	locationId: string | null,
) {
	if (locationId === null) requireOrgWide(c);
	else requireLocation(c, locationId);
}

/** Plan check before one more promotion goes live: active ones across the org. */
function requirePromotionRoom(c: Context<AppEnv>, tx: Tx) {
	return requireRoomFor(
		tx,
		c.var.deps,
		c.var.admin.orgId,
		"activePromotions",
		async () => {
			const [r] = await tx
				.select({ n: sql<number>`count(*)::int` })
				.from(promotions)
				.where(eq(promotions.isActive, true));
			return r?.n ?? 0;
		},
	);
}

/** Reorder: every id must exist (in this org), else nothing changes. */
async function reorder(
	tx: Tx,
	table: typeof categories | typeof products,
	items: { id: string; sortOrder: number }[],
) {
	const ids = items.map((i) => i.id);
	if (new Set(ids).size !== ids.length) {
		throw new ApiError("bad_request", "duplicate id");
	}
	const values = sql.join(
		items.map((i) => sql`(${i.id}::uuid, ${i.sortOrder}::int)`),
		sql`, `,
	);
	const updated = await tx.execute(sql`
		update ${table} t set sort_order = v.sort_order, updated_at = now()
		from (values ${values}) as v(id, sort_order)
		where t.id = v.id
		returning t.id`);
	if (updated.length !== items.length) {
		throw notFound("one or more items");
	}
}

// ---------------------------------------------------------------- routes

/**
 * The menu belongs to the org: everyone in the back office can read it, only
 * owners/admins change it. Managers change price/availability per location
 * and promotions for their locations. Every write fires the menu.changed
 * realtime event through the DB triggers (0008).
 */
export const adminMenuRoutes = new Hono<AppEnv>()
	// categories
	.get("/categories", async (c) => {
		const rows = await adminTx(c, (tx) =>
			tx
				.select()
				.from(categories)
				.orderBy(asc(categories.sortOrder), asc(categories.id)),
		);
		return c.json({ items: rows.map(categoryDto) });
	})
	.post("/categories", validate("json", CreateCategory), async (c) => {
		requireOrgWide(c);
		const b = c.req.valid("json");
		const [row] = await adminTx(c, (tx) =>
			tx
				.insert(categories)
				.values({
					orgId: c.var.admin.orgId,
					name: loc(b.name),
					parentId: b.parentId ?? null,
					...defined({ sortOrder: b.sortOrder, isActive: b.isActive }),
				})
				.returning(),
		);
		return c.json(categoryDto(row as CategoryRow), 201);
	})
	.patch("/categories/order", validate("json", Reorder), async (c) => {
		requireOrgWide(c);
		const items = c.req.valid("json");
		await adminTx(c, (tx) => reorder(tx, categories, items));
		return c.body(null, 204);
	})
	.patch(
		"/categories/:id",
		validate("param", idParam),
		validate("json", UpdateCategory),
		async (c) => {
			requireOrgWide(c);
			const { id } = c.req.valid("param");
			const b = c.req.valid("json");
			if (b.parentId === id) {
				throw new ApiError(
					"unprocessable",
					"a category can't be its own parent",
				);
			}
			const [row] = await adminTx(c, (tx) =>
				tx
					.update(categories)
					.set(
						defined({
							name: b.name && loc(b.name),
							parentId: b.parentId,
							sortOrder: b.sortOrder,
							isActive: b.isActive,
						}),
					)
					.where(eq(categories.id, id))
					.returning(),
			);
			if (!row) throw notFound("category");
			return c.json(categoryDto(row));
		},
	)
	.post("/categories/:id/archive", validate("param", idParam), async (c) => {
		requireOrgWide(c);
		const { id } = c.req.valid("param");
		const [row] = await adminTx(c, (tx) =>
			tx
				.update(categories)
				.set({ isActive: false })
				.where(eq(categories.id, id))
				.returning(),
		);
		if (!row) throw notFound("category");
		return c.json(categoryDto(row));
	})
	// products
	.get(
		"/products",
		validate(
			"query",
			z.object({ archived: z.enum(["true", "false"]).default("false") }),
		),
		async (c) => {
			const archived = c.req.valid("query").archived === "true";
			const items = await adminTx(c, async (tx) => {
				const rows = await tx
					.select()
					.from(products)
					.where(archived ? undefined : isNull(products.archivedAt))
					.orderBy(asc(products.sortOrder), asc(products.id));
				const g = await groupIdsFor(
					tx,
					rows.map((r) => r.id),
				);
				return rows.map((r) => productDto(r, g.get(r.id) ?? []));
			});
			return c.json({ items });
		},
	)
	.post("/products", validate("json", CreateProduct), async (c) => {
		requireOrgWide(c);
		const b = c.req.valid("json");
		const orgId = c.var.admin.orgId;
		const dto = await adminTx(c, async (tx) => {
			const [row] = await tx
				.insert(products)
				.values({
					orgId,
					categoryId: b.categoryId,
					name: loc(b.name),
					description: b.description ? loc(b.description) : null,
					price: b.price,
					taxBps: b.taxBps ?? null,
					imageUrl: b.imageUrl ?? null,
					dietaryTags: uniq(b.dietaryTags ?? []),
					...defined({ isVisible: b.isVisible, sortOrder: b.sortOrder }),
				})
				.returning({ id: products.id });
			const id = (row as { id: string }).id;
			if (b.modifierGroupIds) {
				await setProductGroups(tx, orgId, id, b.modifierGroupIds);
			}
			return loadProduct(tx, id);
		});
		return c.json(dto, 201);
	})
	.patch("/products/order", validate("json", Reorder), async (c) => {
		requireOrgWide(c);
		const items = c.req.valid("json");
		await adminTx(c, (tx) => reorder(tx, products, items));
		return c.body(null, 204);
	})
	.patch(
		"/products/:id",
		validate("param", idParam),
		validate("json", UpdateProduct),
		async (c) => {
			requireOrgWide(c);
			const { id } = c.req.valid("param");
			const b = c.req.valid("json");
			const dto = await adminTx(c, async (tx) => {
				const set = defined({
					categoryId: b.categoryId,
					name: b.name && loc(b.name),
					description:
						b.description === undefined
							? undefined
							: b.description === null
								? null
								: loc(b.description),
					price: b.price,
					taxBps: b.taxBps,
					imageUrl: b.imageUrl,
					dietaryTags: b.dietaryTags && uniq(b.dietaryTags),
					isVisible: b.isVisible,
					sortOrder: b.sortOrder,
				});
				const [row] = await tx
					.update(products)
					.set({ ...set, updatedAt: new Date() })
					.where(eq(products.id, id))
					.returning({ id: products.id });
				if (!row) throw notFound("product");
				if (b.modifierGroupIds) {
					await setProductGroups(tx, c.var.admin.orgId, id, b.modifierGroupIds);
				}
				return loadProduct(tx, id);
			});
			return c.json(dto);
		},
	)
	.post("/products/:id/archive", validate("param", idParam), async (c) => {
		requireOrgWide(c);
		const { id } = c.req.valid("param");
		const dto = await adminTx(c, async (tx) => {
			const [row] = await tx
				.update(products)
				.set({ archivedAt: sql`coalesce(${products.archivedAt}, now())` })
				.where(eq(products.id, id))
				.returning({ id: products.id });
			if (!row) throw notFound("product");
			return loadProduct(tx, id);
		});
		return c.json(dto);
	})
	// modifier groups + options
	.get("/modifier-groups", async (c) => {
		const items = await adminTx(c, (tx) => loadGroups(tx));
		return c.json({ items });
	})
	.post(
		"/modifier-groups",
		validate("json", CreateModifierGroup),
		async (c) => {
			requireOrgWide(c);
			const b = c.req.valid("json");
			const dto = await adminTx(c, async (tx) => {
				const [row] = await tx
					.insert(modifierGroups)
					.values({
						orgId: c.var.admin.orgId,
						name: loc(b.name),
						minSelect: b.minSelect,
						maxSelect: b.maxSelect,
					})
					.returning({ id: modifierGroups.id });
				return loadGroup(tx, (row as { id: string }).id);
			});
			return c.json(dto, 201);
		},
	)
	.patch(
		"/modifier-groups/:id",
		validate("param", idParam),
		validate("json", UpdateModifierGroup),
		async (c) => {
			requireOrgWide(c);
			const { id } = c.req.valid("param");
			const b = c.req.valid("json");
			const dto = await adminTx(c, async (tx) => {
				const [row] = await tx
					.update(modifierGroups)
					.set({
						...defined({
							name: b.name && loc(b.name),
							minSelect: b.minSelect,
							maxSelect: b.maxSelect,
						}),
						updatedAt: new Date(),
					})
					.where(eq(modifierGroups.id, id))
					.returning({ id: modifierGroups.id });
				if (!row) throw notFound("modifier group");
				return loadGroup(tx, id);
			});
			return c.json(dto);
		},
	)
	.post(
		"/modifier-groups/:id/options",
		validate("param", idParam),
		validate("json", CreateModifierOption),
		async (c) => {
			requireOrgWide(c);
			const { id } = c.req.valid("param");
			const b = c.req.valid("json");
			const dto = await adminTx(c, async (tx) => {
				await tx.insert(modifierOptions).values({
					orgId: c.var.admin.orgId,
					groupId: id,
					name: loc(b.name),
					...defined({
						priceDelta: b.priceDelta,
						sortOrder: b.sortOrder,
						isAvailable: b.isAvailable,
					}),
				});
				return loadGroup(tx, id);
			});
			return c.json(dto, 201);
		},
	)
	.patch(
		"/modifier-groups/:id/options/:optionId",
		validate("param", z.object({ id: z.uuid(), optionId: z.uuid() })),
		validate("json", UpdateModifierOption),
		async (c) => {
			requireOrgWide(c);
			const { id, optionId } = c.req.valid("param");
			const b = c.req.valid("json");
			const dto = await adminTx(c, async (tx) => {
				const [row] = await tx
					.update(modifierOptions)
					.set({
						...defined({
							name: b.name && loc(b.name),
							priceDelta: b.priceDelta,
							sortOrder: b.sortOrder,
							isAvailable: b.isAvailable,
						}),
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(modifierOptions.id, optionId),
							eq(modifierOptions.groupId, id),
						),
					)
					.returning({ id: modifierOptions.id });
				if (!row) throw notFound("modifier option");
				return loadGroup(tx, id);
			});
			return c.json(dto);
		},
	)
	// per-location overrides (managers of that location)
	.get("/locations/:id/products", validate("param", idParam), async (c) => {
		const { id } = c.req.valid("param");
		requireLocation(c, id);
		const rows = await adminTx(c, (tx) =>
			tx
				.select({ p: products, s: productLocationSettings })
				.from(products)
				.leftJoin(
					productLocationSettings,
					and(
						eq(productLocationSettings.productId, products.id),
						eq(productLocationSettings.locationId, id),
					),
				)
				.where(isNull(products.archivedAt))
				.orderBy(asc(products.sortOrder), asc(products.id)),
		);
		const items: LocationProduct[] = rows.map(({ p, s }) => ({
			productId: p.id,
			name: p.name,
			categoryId: p.categoryId,
			basePrice: p.price,
			overridePrice: s?.price ?? null,
			effectivePrice: s?.price ?? p.price,
			isAvailable: s?.isAvailable ?? true,
		}));
		return c.json({ items });
	})
	.put(
		"/locations/:id/products/:productId",
		validate("param", z.object({ id: z.uuid(), productId: z.uuid() })),
		validate("json", SetLocationProduct),
		async (c) => {
			const { id, productId } = c.req.valid("param");
			requireLocation(c, id);
			const b = c.req.valid("json");
			const item = await adminTx(c, async (tx) => {
				const [p] = await tx
					.select()
					.from(products)
					.where(eq(products.id, productId));
				if (!p) throw notFound("product");
				await tx
					.insert(productLocationSettings)
					.values({
						orgId: c.var.admin.orgId,
						productId,
						locationId: id,
						price: b.price,
						isAvailable: b.isAvailable,
					})
					.onConflictDoUpdate({
						target: [
							productLocationSettings.productId,
							productLocationSettings.locationId,
						],
						set: {
							price: b.price,
							isAvailable: b.isAvailable,
							updatedAt: new Date(),
						},
					});
				return {
					productId: p.id,
					name: p.name,
					categoryId: p.categoryId,
					basePrice: p.price,
					overridePrice: b.price,
					effectivePrice: b.price ?? p.price,
					isAvailable: b.isAvailable,
				} satisfies LocationProduct;
			});
			return c.json(item);
		},
	)
	// promotions
	.get("/promotions", async (c) => {
		const a = c.var.admin;
		const rows = await adminTx(c, (tx) =>
			tx
				.select()
				.from(promotions)
				.where(
					a.orgWide
						? undefined
						: or(
								isNull(promotions.locationId),
								inArray(promotions.locationId, [...a.manages]),
							),
				)
				.orderBy(asc(promotions.createdAt), asc(promotions.id)),
		);
		return c.json({ items: rows.map(promotionDto) });
	})
	.post("/promotions", validate("json", CreatePromotion), async (c) => {
		const b = c.req.valid("json");
		const locationId = b.locationId ?? null;
		requirePromotionScope(c, locationId);
		const [row] = await adminTx(c, async (tx) => {
			if (b.isActive !== false) await requirePromotionRoom(c, tx);
			return tx
				.insert(promotions)
				.values({
					orgId: c.var.admin.orgId,
					locationId,
					name: b.name,
					kind: b.kind,
					value: b.value,
					productId: b.productId ?? null,
					categoryId: b.categoryId ?? null,
					startsAt: b.startsAt ? new Date(b.startsAt) : null,
					endsAt: b.endsAt ? new Date(b.endsAt) : null,
					dailyStart: b.dailyStart ?? null,
					dailyEnd: b.dailyEnd ?? null,
					daysOfWeek: b.daysOfWeek ?? null,
					...defined({ priority: b.priority, isActive: b.isActive }),
				})
				.returning();
		});
		return c.json(promotionDto(row as PromotionRow), 201);
	})
	.patch(
		"/promotions/:id",
		validate("param", idParam),
		validate("json", UpdatePromotion),
		async (c) => {
			const { id } = c.req.valid("param");
			const b = c.req.valid("json");
			const row = await adminTx(c, async (tx) => {
				const [cur] = await tx
					.select()
					.from(promotions)
					.where(eq(promotions.id, id))
					.for("update");
				if (!cur) throw notFound("promotion");
				// Must be allowed to touch it where it is now AND where it's going.
				requirePromotionScope(c, cur.locationId);
				if (b.locationId !== undefined) requirePromotionScope(c, b.locationId);
				// Switching one back on counts as adding one.
				if (b.isActive === true && !cur.isActive) {
					await requirePromotionRoom(c, tx);
				}
				const ts = (v: string | null | undefined) =>
					v === undefined ? undefined : v === null ? null : new Date(v);
				const [u] = await tx
					.update(promotions)
					.set({
						...defined({
							locationId: b.locationId,
							name: b.name,
							kind: b.kind,
							value: b.value,
							productId: b.productId,
							categoryId: b.categoryId,
							startsAt: ts(b.startsAt),
							endsAt: ts(b.endsAt),
							dailyStart: b.dailyStart,
							dailyEnd: b.dailyEnd,
							daysOfWeek: b.daysOfWeek,
							priority: b.priority,
							isActive: b.isActive,
						}),
						updatedAt: new Date(),
					})
					.where(eq(promotions.id, id))
					.returning();
				return u as PromotionRow;
			});
			return c.json(promotionDto(row));
		},
	);
