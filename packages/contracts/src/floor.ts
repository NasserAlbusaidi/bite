import { z } from "zod";
import { Id, Version } from "./common.js";
import { TableLabel } from "./orders.js";

/**
 * Floor plan of one branch: areas ("Inside", "Terrace"), each a canvas of
 * tables. Table geometry is in grid cells (about one seat wide), so the plan
 * draws the same on a phone, the back office and a tablet.
 *
 * A table's `label` is the join key to `Order.tableLabel`: the floor shows a
 * table as busy when open orders carry its label. Unique per branch.
 */
export const TableShape = z.enum(["square", "round", "rect"]);
export type TableShape = z.infer<typeof TableShape>;

export const FLOOR_GRID = { cols: 40, rows: 28 } as const;

export const FloorArea = z.object({
	id: Id,
	name: z.string().trim().min(1).max(40),
	sortOrder: z.int().min(0).max(999),
});
export type FloorArea = z.infer<typeof FloorArea>;

const Geometry = {
	x: z
		.int()
		.min(0)
		.max(FLOOR_GRID.cols - 1),
	y: z
		.int()
		.min(0)
		.max(FLOOR_GRID.rows - 1),
	w: z.int().min(1).max(12),
	h: z.int().min(1).max(12),
};

export const FloorTable = z.object({
	id: Id,
	areaId: Id,
	label: TableLabel,
	seats: z.int().min(1).max(40),
	shape: TableShape,
	...Geometry,
	/** Server looking after the table, set from the POS floor. */
	serverMemberId: Id.nullable(),
	version: Version,
});
export type FloorTable = z.infer<typeof FloorTable>;

export const Floor = z.object({
	areas: z.array(FloorArea),
	tables: z.array(FloorTable),
});
export type Floor = z.infer<typeof Floor>;

/** One table as the back office saves it. Ids are client-made for new rows. */
export const FloorTableInput = FloorTable.omit({
	serverMemberId: true,
	version: true,
});
export type FloorTableInput = z.infer<typeof FloorTableInput>;

/**
 * PUT /v1/admin/locations/:id/floor. The whole plan in one save: areas and
 * tables missing from the body are deleted, the rest upserted by id. Labels
 * must be unique across the branch, and every table's area must be in the body.
 */
export const PutFloorRequest = z
	.object({
		areas: z.array(FloorArea).max(20),
		tables: z.array(FloorTableInput).max(300),
	})
	.superRefine((f, ctx) => {
		const areaIds = new Set(f.areas.map((a) => a.id));
		if (areaIds.size !== f.areas.length)
			ctx.addIssue({ code: "custom", message: "duplicate area id" });
		const labels = new Set<string>();
		const ids = new Set<string>();
		for (const [i, t] of f.tables.entries()) {
			const key = t.label.toLowerCase();
			if (labels.has(key))
				ctx.addIssue({
					code: "custom",
					path: ["tables", i, "label"],
					message: `table ${t.label} is on the plan twice`,
				});
			labels.add(key);
			if (ids.has(t.id))
				ctx.addIssue({ code: "custom", message: "duplicate table id" });
			ids.add(t.id);
			if (!areaIds.has(t.areaId))
				ctx.addIssue({
					code: "custom",
					path: ["tables", i, "areaId"],
					message: "unknown area",
				});
		}
	});
export type PutFloorRequest = z.infer<typeof PutFloorRequest>;

/**
 * Sync kind "order.setTable": move an open order to another table (or clear
 * it with null). Moving or merging tables on the POS is one of these per
 * order. Only dine-in orders that are not completed or cancelled.
 */
export const SetOrderTable = z.object({
	orderId: Id,
	tableLabel: TableLabel.nullable(),
});
export type SetOrderTable = z.infer<typeof SetOrderTable>;

/** Sync kind "table.assign": who is looking after a table. Null clears it. */
export const AssignTable = z.object({
	tableId: Id,
	memberId: Id.nullable(),
});
export type AssignTable = z.infer<typeof AssignTable>;
