import type {
	AssignTable,
	Floor,
	OrderAtTable,
	PutFloorRequest,
	SetOrderTable,
} from "@bite/contracts";
import { checkAtTable } from "@bite/core";
import { schema, type Tx } from "@bite/db";
import { and, asc, eq, inArray, notInArray, sql } from "@bite/db/orm";
import { ApiError } from "../lib/errors.js";
import type { MutationCtx, MutationOutcome } from "../sync/context.js";
import { checkBaseVersion, lockOrder, reject } from "../sync/orders.js";

const { floorAreas, floorTables, memberLocations, orders } = schema;

/** The branch's floor plan, areas in order, tables by label. */
export async function loadFloor(tx: Tx, locationId: string): Promise<Floor> {
	const areas = await tx
		.select()
		.from(floorAreas)
		.where(eq(floorAreas.locationId, locationId))
		.orderBy(asc(floorAreas.sortOrder), asc(floorAreas.name));
	const tables = await tx
		.select()
		.from(floorTables)
		.where(
			and(
				eq(floorTables.locationId, locationId),
				eq(floorTables.isActive, true),
			),
		)
		.orderBy(asc(floorTables.label));
	return {
		areas: areas.map((a) => ({
			id: a.id,
			name: a.name,
			sortOrder: a.sortOrder,
			outline: a.outline ?? null,
		})),
		tables: tables.map((t) => ({
			id: t.id,
			areaId: t.areaId,
			label: t.label,
			seats: t.seats,
			shape: t.shape,
			x: t.x,
			y: t.y,
			w: t.w,
			h: t.h,
			serverMemberId: t.serverMemberId,
			version: t.version,
		})),
	};
}

/**
 * Replace the plan. Rows are upserted by id so a table keeps its server
 * assignment through a layout edit; whatever is missing is deleted. Labels
 * are freed first (renamed to a tail of their id) so swapping two tables' numbers in
 * one save never trips the per-branch unique label.
 */
export async function saveFloor(
	tx: Tx,
	orgId: string,
	locationId: string,
	f: PutFloorRequest,
): Promise<Floor> {
	const areaIds = f.areas.map((a) => a.id);
	const tableIds = f.tables.map((t) => t.id);

	// Ids that already exist somewhere else (another branch) can't be taken over.
	const foreign = [
		...(areaIds.length
			? await tx
					.select({ id: floorAreas.id, loc: floorAreas.locationId })
					.from(floorAreas)
					.where(inArray(floorAreas.id, areaIds))
			: []),
		...(tableIds.length
			? await tx
					.select({ id: floorTables.id, loc: floorTables.locationId })
					.from(floorTables)
					.where(inArray(floorTables.id, tableIds))
			: []),
	].filter((r) => r.loc !== locationId);
	if (foreign.length > 0)
		throw reject("id_taken", "id belongs to another branch");

	await tx
		.delete(floorTables)
		.where(
			and(
				eq(floorTables.locationId, locationId),
				...(tableIds.length ? [notInArray(floorTables.id, tableIds)] : []),
			),
		);
	await tx
		.delete(floorAreas)
		.where(
			and(
				eq(floorAreas.locationId, locationId),
				...(areaIds.length ? [notInArray(floorAreas.id, areaIds)] : []),
			),
		);
	if (f.areas.length) {
		await tx
			.insert(floorAreas)
			.values(
				f.areas.map((a) => ({
					id: a.id,
					orgId,
					locationId,
					name: a.name,
					sortOrder: a.sortOrder,
					outline: a.outline,
				})),
			)
			.onConflictDoUpdate({
				target: floorAreas.id,
				set: {
					name: sql`excluded.name`,
					sortOrder: sql`excluded.sort_order`,
					outline: sql`excluded.outline`,
					updatedAt: sql`now()`,
				},
			});
	}
	if (f.tables.length) {
		await tx
			.update(floorTables)
			.set({ label: sql`'~' || right(${floorTables.id}::text, 17)` })
			.where(eq(floorTables.locationId, locationId));
		await tx
			.insert(floorTables)
			.values(
				f.tables.map((t) => ({
					id: t.id,
					orgId,
					locationId,
					areaId: t.areaId,
					label: t.label,
					seats: t.seats,
					shape: t.shape,
					x: t.x,
					y: t.y,
					w: t.w,
					h: t.h,
				})),
			)
			.onConflictDoUpdate({
				target: floorTables.id,
				set: {
					areaId: sql`excluded.area_id`,
					label: sql`excluded.label`,
					seats: sql`excluded.seats`,
					shape: sql`excluded.shape`,
					x: sql`excluded.x`,
					y: sql`excluded.y`,
					w: sql`excluded.w`,
					h: sql`excluded.h`,
					isActive: true,
					version: sql`${floorTables.version} + 1`,
					updatedAt: sql`now()`,
				},
			});
	}
	return loadFloor(tx, locationId);
}

/** order.setTable: move an open dine-in order to another table (or none). */
export async function setOrderTable(
	ctx: MutationCtx,
	p: SetOrderTable,
): Promise<MutationOutcome> {
	const o = await lockOrder(ctx.tx, p.orderId, ctx.device.locationId);
	checkBaseVersion(ctx, o);
	if (o.tableLabel === p.tableLabel) return { entityVersion: o.version };
	// A served order still holds its table until it's cleared, so it can move.
	if (o.fulfillmentStatus === "cancelled" || o.tableClearedAt) {
		throw reject("order_closed", "order is closed");
	}
	if (o.type !== "dine_in" && p.tableLabel !== null) {
		throw reject("not_dine_in", "only dine-in orders sit at a table");
	}
	const [u] = await ctx.tx
		.update(orders)
		.set({ tableLabel: p.tableLabel, version: sql`${orders.version} + 1` })
		.where(eq(orders.id, o.id))
		.returning({ version: orders.version });
	return { entityVersion: u?.version ?? o.version + 1 };
}

/** table.assign: the server looking after a table. Must work at this branch. */
export async function assignTable(
	ctx: MutationCtx,
	p: AssignTable,
): Promise<MutationOutcome> {
	const { tx, device } = ctx;
	const [t] = await tx
		.select()
		.from(floorTables)
		.where(eq(floorTables.id, p.tableId))
		.for("update");
	if (!t || t.locationId !== device.locationId) {
		throw reject("not_found", "no such table at this location");
	}
	if (ctx.baseVersion !== undefined && ctx.baseVersion !== t.version) {
		throw new ApiError("conflict", "table changed since the tablet saw it", {
			currentVersion: t.version,
		});
	}
	if (p.memberId === t.serverMemberId) return { entityVersion: t.version };
	if (p.memberId) {
		const [ml] = await tx
			.select({ role: memberLocations.role })
			.from(memberLocations)
			.where(
				and(
					eq(memberLocations.memberId, p.memberId),
					eq(memberLocations.locationId, device.locationId),
				),
			);
		if (!ml) throw reject("not_staff", "member is not staff at this location");
		if (ml.role === "kitchen")
			throw reject("not_floor_staff", "kitchen staff don't serve tables");
	}
	const [u] = await tx
		.update(floorTables)
		.set({
			serverMemberId: p.memberId,
			serverAssignedAt: p.memberId ? ctx.now : null,
			version: sql`${floorTables.version} + 1`,
		})
		.where(eq(floorTables.id, t.id))
		.returning({ version: floorTables.version });
	return { entityVersion: u?.version ?? t.version + 1 };
}

/**
 * Served / cleared at the table. No base-version check: both are facts about
 * the room, not edits to the bill, and replaying one is a no-op.
 */
export async function orderAtTable(
	ctx: MutationCtx,
	p: OrderAtTable,
): Promise<MutationOutcome> {
	const o = await lockOrder(ctx.tx, p.orderId, ctx.device.locationId);
	const done = p.step === "served" ? o.servedAt : o.tableClearedAt;
	if (done) return { entityVersion: o.version };
	const check = checkAtTable(o, p.step);
	if (!check.ok) throw reject(check.error, `cannot mark ${p.step}`);
	const now = ctx.now;
	const [u] = await ctx.tx
		.update(orders)
		.set({
			version: sql`${orders.version} + 1`,
			...(p.step === "served"
				? { servedAt: now }
				: { tableClearedAt: now, servedAt: o.servedAt ?? now }),
			...(check.complete
				? { fulfillmentStatus: "completed" as const, completedAt: now }
				: {}),
		})
		.where(eq(orders.id, o.id))
		.returning({ version: orders.version });
	return { entityVersion: u?.version ?? o.version + 1 };
}
