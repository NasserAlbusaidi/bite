import { FLOOR_GRID, type TableShape } from "@bite/contracts";
import type {
	Floor,
	FloorArea,
	FloorTable,
	PutFloorRequest,
} from "./contracts";
import { uuidv7 } from "./uuid";

/**
 * Floor plan editor maths. Everything is in grid units: tables sit in cells
 * (x 0..39, y 0..27), room corners sit on the dots between cells
 * (x 0..40, y 0..28). The editor only asks four things (area, room shape,
 * tables, where they stand); the rest happens here.
 */
export const GRID = FLOOR_GRID;

/** A table as the editor holds it: new tables have no version yet. */
export type DraftTable = Omit<FloorTable, "version" | "serverMemberId">;
export type DraftArea = Omit<FloorArea, "outline"> & {
	outline: Pt[] | null;
};
export type Draft = { areas: DraftArea[]; tables: DraftTable[] };
export type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

export const toDraft = (f: Floor): Draft => ({
	areas: [...f.areas]
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((a) => ({ ...a, outline: a.outline ?? null })),
	tables: f.tables.map(
		({ version: _v, serverMemberId: _s, ...t }) => t as DraftTable,
	),
});

export const toRequest = (d: Draft): PutFloorRequest => ({
	areas: d.areas.map((a, i) => ({
		...a,
		sortOrder: i,
		outline: a.outline ? cleanOutline(a.outline) : null,
	})),
	tables: d.tables.map((t) => ({ ...t, label: t.label.trim() })),
});

// ---------------------------------------------------------------- rooms

/** The whole canvas: what an area without walls is. */
export const FULL_ROOM: Pt[] = [
	{ x: 0, y: 0 },
	{ x: GRID.cols, y: 0 },
	{ x: GRID.cols, y: GRID.rows },
	{ x: 0, y: GRID.rows },
];

const pts = (xy: [number, number][]): Pt[] => xy.map(([x, y]) => ({ x, y }));

/** The four starting shapes. Corners are then dragged to fit the real room. */
export const ROOM_SHAPES = {
	box: pts([
		[2, 2],
		[38, 2],
		[38, 26],
		[2, 26],
	]),
	l: pts([
		[2, 2],
		[24, 2],
		[24, 12],
		[38, 12],
		[38, 26],
		[2, 26],
	]),
	u: pts([
		[2, 2],
		[14, 2],
		[14, 13],
		[26, 13],
		[26, 2],
		[38, 2],
		[38, 26],
		[2, 26],
	]),
	t: pts([
		[2, 2],
		[38, 2],
		[38, 12],
		[29, 12],
		[29, 26],
		[11, 26],
		[11, 12],
		[2, 12],
	]),
} as const;
export type RoomShape = keyof typeof ROOM_SHAPES;

export const roomOf = (a: Pick<DraftArea, "outline"> | undefined): Pt[] =>
	a?.outline ?? FULL_ROOM;

const clampPt = (p: Pt): Pt => ({
	x: Math.max(0, Math.min(GRID.cols, Math.round(p.x))),
	y: Math.max(0, Math.min(GRID.rows, Math.round(p.y))),
});

/** Drop repeated corners (two dragged onto one dot). Never below three. */
export function cleanOutline(o: Pt[]): Pt[] {
	const out = o.map(clampPt);
	for (let i = out.length - 1; i >= 0 && out.length > 3; i--) {
		const a = out[i] as Pt;
		const b = out[(i + 1) % out.length] as Pt;
		if (a.x === b.x && a.y === b.y) out.splice(i, 1);
	}
	return out;
}

/**
 * Drag one corner. The two walls that meet there stay straight (a wall that
 * was level stays level), so dragging a corner resizes the room.
 */
export function moveCorner(start: Pt[], i: number, to: Pt): Pt[] {
	const n = start.length;
	const p = clampPt(to);
	const at = start[i] as Pt;
	const out = start.map((q) => ({ ...q }));
	for (const j of [(i - 1 + n) % n, (i + 1) % n]) {
		const q = start[j] as Pt;
		if (q.y === at.y) (out[j] as Pt).y = p.y;
		else if (q.x === at.x) (out[j] as Pt).x = p.x;
	}
	out[i] = p;
	return out;
}

/** Drag wall `i` (corner i to corner i+1) by dx, dy: it slides in or out. */
export function moveWall(start: Pt[], i: number, dx: number, dy: number) {
	const n = start.length;
	const j = (i + 1) % n;
	const a = start[i] as Pt;
	const b = start[j] as Pt;
	const level = a.y === b.y;
	const upright = a.x === b.x;
	const out = start.map((q) => ({ ...q }));
	for (const k of [i, j]) {
		const q = start[k] as Pt;
		out[k] = clampPt({
			x: level ? q.x : q.x + Math.round(dx),
			y: upright ? q.y : q.y + Math.round(dy),
		});
	}
	return out;
}

/** Width and depth of the room in metres (a dot is about half a metre). */
export function roomSize(o: Pt[]) {
	const xs = o.map((p) => p.x);
	const ys = o.map((p) => p.y);
	return {
		w: (Math.max(...xs) - Math.min(...xs)) / 2,
		h: (Math.max(...ys) - Math.min(...ys)) / 2,
	};
}

export function inside(px: number, py: number, poly: Pt[]): boolean {
	let c = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i] as Pt;
		const b = poly[j] as Pt;
		if (
			a.y > py !== b.y > py &&
			px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x
		)
			c = !c;
	}
	return c;
}

/** True when the box is inside the walls and no wall runs through it. */
export function boxInRoom(b: Box, poly: Pt[]): boolean {
	const e = 0.02;
	const probe: [number, number][] = [
		[b.x + e, b.y + e],
		[b.x + b.w - e, b.y + e],
		[b.x + e, b.y + b.h - e],
		[b.x + b.w - e, b.y + b.h - e],
		[b.x + b.w / 2, b.y + b.h / 2],
	];
	if (!probe.every(([x, y]) => inside(x, y, poly))) return false;
	for (let i = 0; i < poly.length; i++) {
		const p = poly[i] as Pt;
		const q = poly[(i + 1) % poly.length] as Pt;
		if (
			p.x === q.x &&
			p.x > b.x &&
			p.x < b.x + b.w &&
			Math.max(p.y, q.y) > b.y &&
			Math.min(p.y, q.y) < b.y + b.h
		)
			return false;
		if (
			p.y === q.y &&
			p.y > b.y &&
			p.y < b.y + b.h &&
			Math.max(p.x, q.x) > b.x &&
			Math.min(p.x, q.x) < b.x + b.w
		)
			return false;
	}
	return true;
}

// --------------------------------------------------------------- tables

const overlaps = (a: Box, b: Box) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (b: Box, g: number): Box => ({
	x: b.x - g,
	y: b.y - g,
	w: b.w + 2 * g,
	h: b.h + 2 * g,
});

/** Keep a box on the canvas. */
export function clampBox<T extends Box>(b: T): T {
	const w = Math.max(1, Math.min(12, Math.round(b.w)));
	const h = Math.max(1, Math.min(12, Math.round(b.h)));
	return {
		...b,
		w,
		h,
		x: Math.max(0, Math.min(GRID.cols - w, Math.round(b.x))),
		y: Math.max(0, Math.min(GRID.rows - h, Math.round(b.y))),
	};
}

/** True when `t` sits on another table in the same area. */
export function collides(d: Draft, t: DraftTable): boolean {
	return d.tables.some(
		(o) => o.id !== t.id && o.areaId === t.areaId && overlaps(o, t),
	);
}

const roomFor = (d: Draft, areaId: string) =>
	roomOf(d.areas.find((a) => a.id === areaId));

/**
 * Can `t` stand at (x, y)? Inside the walls with a dot to spare for chairs,
 * and a dot away from every other table in its area.
 */
export function fitsAt(d: Draft, t: DraftTable, x: number, y: number): boolean {
	const b = { x, y, w: t.w, h: t.h };
	if (x < 0 || y < 0 || x + t.w > GRID.cols || y + t.h > GRID.rows)
		return false;
	const area = d.areas.find((a) => a.id === t.areaId);
	// With walls, keep a dot free for the chairs; the bare canvas has no walls.
	if (!boxInRoom(area?.outline ? grow(b, 1) : b, roomOf(area))) return false;
	return !d.tables.some(
		(o) => o.id !== t.id && o.areaId === t.areaId && overlaps(grow(o, 1), b),
	);
}

/** Outside the walls or on top of another table: shown red, blocks saving. */
export const misplaced = (d: Draft, t: DraftTable) =>
	!boxInRoom(t, roomFor(d, t.areaId)) || collides(d, t);

/** Nearest spot where `t` fits, searching outwards ring by ring. */
export function nearestFree(
	d: Draft,
	t: DraftTable,
	x: number,
	y: number,
): { x: number; y: number } | null {
	for (let r = 0; r < Math.max(GRID.cols, GRID.rows); r++)
		for (let dy = -r; dy <= r; dy++)
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				if (fitsAt(d, t, x + dx, y + dy)) return { x: x + dx, y: y + dy };
			}
	return null;
}

/** After a drop: slide the table to the nearest free spot if it landed badly. */
export function settle(d: Draft, t: DraftTable): DraftTable {
	if (fitsAt(d, t, t.x, t.y)) return t;
	const p = nearestFree(d, t, t.x, t.y);
	return p ? { ...t, ...p } : t;
}

/**
 * After the walls move: bring every table in the area back inside and apart.
 * Returns the plan and how many tables have no room left.
 */
export function settleArea(
	d: Draft,
	areaId: string,
): { draft: Draft; stuck: number } {
	let stuck = 0;
	// Settle one by one against the tables already settled, so two tables on
	// one spot end up side by side instead of both counting as stuck.
	const done: DraftTable[] = d.tables.filter((t) => t.areaId !== areaId);
	for (const t of d.tables) {
		if (t.areaId !== areaId) continue;
		const cur = { ...d, tables: done };
		if (fitsAt(cur, t, t.x, t.y)) {
			done.push(t);
			continue;
		}
		const p = nearestFree(cur, t, t.x, t.y);
		if (!p) stuck++;
		done.push(p ? { ...t, ...p } : t);
	}
	const order = new Map(d.tables.map((t, i) => [t.id, i]));
	done.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
	return { draft: { ...d, tables: done }, stuck };
}

/**
 * While dragging: pull the table into line with a neighbour when it's within
 * a dot of it. Returns the snapped spot and guide lines to draw.
 */
export function magnet(d: Draft, t: DraftTable, x: number, y: number) {
	let nx = x;
	let ny = y;
	const others = d.tables.filter((o) => o.id !== t.id && o.areaId === t.areaId);
	for (const o of others) {
		const dy = o.y + o.h / 2 - (ny + t.h / 2);
		const dx = o.x + o.w / 2 - (nx + t.w / 2);
		if (dy !== 0 && Math.abs(dy) <= 1) ny = Math.round(o.y + o.h / 2 - t.h / 2);
		if (dx !== 0 && Math.abs(dx) <= 1) nx = Math.round(o.x + o.w / 2 - t.w / 2);
	}
	const guides: [number, number, number, number][] = [];
	for (const o of others) {
		if (o.y + o.h / 2 === ny + t.h / 2)
			guides.push([
				Math.min(o.x, nx),
				ny + t.h / 2,
				Math.max(o.x + o.w, nx + t.w),
				ny + t.h / 2,
			]);
		if (o.x + o.w / 2 === nx + t.w / 2)
			guides.push([
				nx + t.w / 2,
				Math.min(o.y, ny),
				nx + t.w / 2,
				Math.max(o.y + o.h, ny + t.h),
			]);
	}
	return { x: nx, y: ny, guides };
}

export const SEAT_CHOICES = [2, 4, 6, 8] as const;

/** The shape Bite picks for a number of seats. The admin can change it. */
export const shapeFor = (seats: number): TableShape =>
	seats <= 2 ? "round" : seats <= 4 ? "square" : "rect";

/** Table size in cells for a shape and seat count. */
export function sizeFor(shape: TableShape, seats: number) {
	const s = Math.max(1, Math.min(12, seats));
	if (shape === "rect") return { w: Math.min(12, Math.max(4, s + 1)), h: 3 };
	const side = s <= 2 ? 3 : s <= 4 ? 4 : s <= 6 ? 5 : 6;
	return { w: side, h: side };
}

/** Change shape and/or seats, keeping the table where it was. */
export function reshape(
	d: Draft,
	t: DraftTable,
	shape: TableShape,
	seats: number,
): DraftTable {
	const z = sizeFor(shape, seats);
	const cx = t.x + t.w / 2;
	const cy = t.y + t.h / 2;
	const next = clampBox({
		...t,
		shape,
		seats,
		w: z.w,
		h: z.h,
		x: Math.round(cx - z.w / 2),
		y: Math.round(cy - z.h / 2),
	});
	return settle(d, next);
}

/** Next free table number: one past the highest numeric label in the branch. */
export function nextLabel(d: Draft): string {
	const taken = new Set(d.tables.map((t) => t.label.toLowerCase()));
	let n =
		d.tables.reduce((m, t) => {
			const v = /^\d+$/.test(t.label) ? Number(t.label) : 0;
			return Math.max(m, v);
		}, 0) + 1;
	while (taken.has(String(n))) n += 1;
	return String(n);
}

/** First free spot for a w x h table in an area, scanning row by row. */
export function freeSpot(
	d: Draft,
	areaId: string,
	w: number,
	h: number,
): { x: number; y: number } {
	const probe: DraftTable = {
		id: "_probe",
		areaId,
		label: "",
		seats: 1,
		shape: "square",
		x: 0,
		y: 0,
		w,
		h,
	};
	const room = roomFor(d, areaId);
	const xs = room.map((p) => p.x);
	const ys = room.map((p) => p.y);
	const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2 - w / 2);
	const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2 - h / 2);
	return nearestFree(d, probe, cx, cy) ?? { x: 0, y: 0 };
}

/** A new table with the seats asked for, placed nearest the room's middle. */
export function newTable(d: Draft, areaId: string, seats = 4): DraftTable {
	const shape = shapeFor(seats);
	const z = sizeFor(shape, seats);
	return {
		id: uuidv7(),
		areaId,
		label: nextLabel(d),
		seats,
		shape,
		w: z.w,
		h: z.h,
		...freeSpot(d, areaId, z.w, z.h),
	};
}

/**
 * "How many tables?" on a fresh area: four-seaters in tidy rows from the back
 * wall, a two-dot aisle between them. Returns the plan and how many fit.
 */
export function layOut(d: Draft, areaId: string, count: number) {
	const room = roomFor(d, areaId);
	const xs = room.map((p) => p.x);
	const ys = room.map((p) => p.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const keep = d.tables.filter((t) => t.areaId !== areaId);
	const z = sizeFor("square", 4);
	let best: DraftTable[] = [];
	for (let anchor = 0; anchor < 6 && best.length < count; anchor++) {
		const placed: DraftTable[] = [];
		for (
			let y = minY + 1 + anchor;
			y + z.h < maxY && placed.length < count;
			y += z.h + 2
		)
			for (let x = minX + 1; x + z.w < maxX && placed.length < count; x++) {
				const b = { x, y, w: z.w, h: z.h };
				if (!boxInRoom(grow(b, 1), room)) continue;
				if (placed.some((o) => overlaps(grow(o, 2), b))) continue;
				placed.push({
					id: uuidv7(),
					areaId,
					label: "",
					seats: 4,
					shape: "square",
					...b,
				});
			}
		if (placed.length > best.length) best = placed;
	}
	// Number them 1, 2, 3… skipping numbers other areas already use.
	let next: Draft = { ...d, tables: keep };
	const labelled: DraftTable[] = [];
	for (const t of best) {
		const label = nextLabel(next);
		labelled.push({ ...t, label });
		next = { ...next, tables: [...next.tables, { ...t, label }] };
	}
	return { draft: next, placed: labelled.length };
}

/** Problems that block saving, by table id. */
export function problems(d: Draft): Map<string, "label_empty" | "label_dup"> {
	const out = new Map<string, "label_empty" | "label_dup">();
	const seen = new Map<string, string>();
	for (const t of d.tables) {
		const key = t.label.trim().toLowerCase();
		if (!key) {
			out.set(t.id, "label_empty");
			continue;
		}
		const other = seen.get(key);
		if (other) {
			out.set(t.id, "label_dup");
			out.set(other, "label_dup");
		}
		seen.set(key, t.id);
	}
	return out;
}

/** A starter plan for a branch with none: an L-shaped room of eight tables. */
export function starterFloor(areaName: string): Draft {
	const area: DraftArea = {
		id: uuidv7(),
		name: areaName,
		sortOrder: 0,
		outline: ROOM_SHAPES.l.map((p) => ({ ...p })),
	};
	return layOut({ areas: [area], tables: [] }, area.id, 8).draft;
}

export const totalSeats = (d: Draft, areaId?: string) =>
	d.tables
		.filter((t) => !areaId || t.areaId === areaId)
		.reduce((n, t) => n + t.seats, 0);
