import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, tenantPolicy, updatedAt } from "./_shared.js";
import { locations, members } from "./tenancy.js";

export const tableShape = pgEnum("table_shape", ["square", "round", "rect"]);

/**
 * A part of a branch's floor: "Inside", "Terrace", "Majlis". Each area is its
 * own canvas on the floor plan. Names are plain text (staff-facing).
 */
export const floorAreas = pgTable(
	"floor_areas",
	{
		id: id(),
		orgId: orgId(),
		locationId: uuid("location_id").notNull(),
		name: text("name").notNull(),
		sortOrder: smallint("sort_order").notNull().default(0),
		/**
		 * The room's walls: corner points on the plan's dot grid, in order.
		 * Null means the whole canvas (plans made before walls existed).
		 */
		outline: jsonb("outline").$type<{ x: number; y: number }[]>(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("cascade"),
		check("floor_areas_name_len", sql`char_length(${t.name}) between 1 and 40`),
		index("floor_areas_location_idx").on(t.locationId),
		tenantPolicy(),
	],
);

/**
 * One table on the floor plan. `label` is what guests and staff call it ("7",
 * "T3") and is the join key to `orders.table_label`, so it is unique per
 * branch. Position and size are in grid units on the area's canvas (a cell is
 * about one seat wide), so the plan scales to any screen.
 */
export const floorTables = pgTable(
	"floor_tables",
	{
		id: id(),
		orgId: orgId(),
		locationId: uuid("location_id").notNull(),
		areaId: uuid("area_id").notNull(),
		label: text("label").notNull(),
		seats: smallint("seats").notNull().default(4),
		shape: tableShape("shape").notNull().default("square"),
		x: smallint("x").notNull().default(0),
		y: smallint("y").notNull().default(0),
		w: smallint("w").notNull().default(2),
		h: smallint("h").notNull().default(2),
		isActive: boolean("is_active").notNull().default(true),
		/** Server looking after this table today. Set from the POS floor. */
		serverMemberId: uuid("server_member_id"),
		serverAssignedAt: timestamp("server_assigned_at", { withTimezone: true }),
		/** Bumped on every write; table.assign conflicts on it. */
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique().on(t.orgId, t.id),
		unique("floor_tables_label_uq").on(t.locationId, t.label),
		foreignKey({
			columns: [t.orgId, t.locationId],
			foreignColumns: [locations.orgId, locations.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.areaId],
			foreignColumns: [floorAreas.orgId, floorAreas.id],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.orgId, t.serverMemberId],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("restrict"),
		check(
			"floor_tables_label_len",
			sql`char_length(${t.label}) between 1 and 20`,
		),
		check("floor_tables_seats", sql`${t.seats} between 1 and 40`),
		check(
			"floor_tables_geometry",
			sql`${t.x} between 0 and 200 and ${t.y} between 0 and 200 and ${t.w} between 1 and 20 and ${t.h} between 1 and 20`,
		),
		index("floor_tables_location_idx").on(t.locationId),
		tenantPolicy(),
	],
);
