import { FLOOR_GRID } from "@bite/contracts";
import type {
	Floor,
	FloorArea,
	FloorTable,
	PutFloorRequest,
} from "./contracts";
import { uuidv7 } from "./uuid";

export const GRID = FLOOR_GRID;

/** A table as the editor holds it: new tables have no version yet. */
export type DraftTable = Omit<FloorTable, "version" | "serverMemberId">;
export type Draft = { areas: FloorArea[]; tables: DraftTable[] };

export const toDraft = (f: Floor): Draft => ({
	areas: [...f.areas].sort((a, b) => a.sortOrder - b.sortOrder),
	tables: f.tables.map(
		({ version: _v, serverMemberId: _s, ...t }) => t as DraftTable,
	),
});

export const toRequest = (d: Draft): PutFloorRequest => ({
	areas: d.areas.map((a, i) => ({ ...a, sortOrder: i })),
	tables: d.tables.map((t) => ({ ...t, label: t.label.trim() })),
});

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

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
	for (let y = 1; y + h <= GRID.rows; y += 1)
		for (let x = 1; x + w <= GRID.cols; x += 1) {
			const box = { x, y, w: w + 1, h: h + 1 };
			if (
				!d.tables.some(
					(o) =>
						o.areaId === areaId &&
						overlaps({ x: o.x, y: o.y, w: o.w + 1, h: o.h + 1 }, box),
				)
			)
				return { x, y };
		}
	return { x: 0, y: 0 };
}

export const SHAPES = {
	round: { w: 3, h: 3, seats: 2 },
	square: { w: 4, h: 3, seats: 4 },
	rect: { w: 7, h: 3, seats: 6 },
} as const;

export function newTable(
	d: Draft,
	areaId: string,
	shape: keyof typeof SHAPES = "square",
): DraftTable {
	const s = SHAPES[shape];
	return {
		id: uuidv7(),
		areaId,
		label: nextLabel(d),
		seats: s.seats,
		shape,
		w: s.w,
		h: s.h,
		...freeSpot(d, areaId, s.w, s.h),
	};
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

/** A starter plan for a branch with none: one room of eight tables. */
export function starterFloor(areaName: string): Draft {
	const area: FloorArea = { id: uuidv7(), name: areaName, sortOrder: 0 };
	const d: Draft = { areas: [area], tables: [] };
	for (const shape of [
		"round",
		"round",
		"round",
		"square",
		"square",
		"square",
		"rect",
		"rect",
	] as const)
		d.tables.push(newTable(d, area.id, shape));
	return d;
}

export const totalSeats = (d: Draft, areaId?: string) =>
	d.tables
		.filter((t) => !areaId || t.areaId === areaId)
		.reduce((n, t) => n + t.seats, 0);
