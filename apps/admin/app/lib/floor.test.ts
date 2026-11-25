import { PutFloorRequest } from "@bite/contracts";
import { describe, expect, it } from "vitest";
import {
	boxInRoom,
	clampBox,
	cleanOutline,
	collides,
	type Draft,
	type DraftTable,
	fitsAt,
	layOut,
	magnet,
	misplaced,
	moveCorner,
	moveWall,
	newTable,
	nextLabel,
	problems,
	ROOM_SHAPES,
	reshape,
	roomSize,
	settleArea,
	shapeFor,
	sizeFor,
	starterFloor,
	toRequest,
} from "./floor";

const area = "0193a1b2-0000-7000-8000-000000000001";
const box = () => ROOM_SHAPES.box.map((p) => ({ ...p }));
const base = (outline = box()): Draft => ({
	areas: [{ id: area, name: "Inside", sortOrder: 0, outline }],
	tables: [],
});
const at = (d: Draft, x: number, y: number, seats = 4): DraftTable => ({
	...newTable(d, area, seats),
	x,
	y,
});

describe("floor plan: tables", () => {
	it("numbers new tables past the highest number", () => {
		const d = base();
		expect(nextLabel(d)).toBe("1");
		d.tables.push({ ...newTable(d, area), label: "7" });
		d.tables.push({ ...newTable(d, area), label: "T2" });
		expect(nextLabel(d)).toBe("8");
	});

	it("places new tables inside the walls and apart", () => {
		const d = base();
		for (let i = 0; i < 12; i++) d.tables.push(newTable(d, area, 4));
		for (const t of d.tables) expect(misplaced(d, t)).toBe(false);
	});

	it("picks a shape and size from the seats", () => {
		expect(shapeFor(2)).toBe("round");
		expect(shapeFor(4)).toBe("square");
		expect(shapeFor(8)).toBe("rect");
		expect(sizeFor("rect", 8)).toEqual({ w: 9, h: 3 });
		expect(sizeFor("round", 6)).toEqual({ w: 5, h: 5 });
	});

	it("reshapes a table in place, sliding it off a neighbour", () => {
		const d = base();
		const a = at(d, 10, 10);
		d.tables.push(a);
		const b = at(d, 16, 10);
		d.tables.push(b);
		const long = reshape(d, a, "rect", 8);
		expect(long).toMatchObject({ shape: "rect", seats: 8, w: 9, h: 3 });
		expect(fitsAt({ ...d, tables: [long, b] }, long, long.x, long.y)).toBe(
			true,
		);
	});

	it("keeps tables on the canvas", () => {
		expect(clampBox({ x: -3, y: 99, w: 30, h: 0.4 })).toEqual({
			x: 0,
			y: 27,
			w: 12,
			h: 1,
		});
	});

	it("flags empty and duplicate labels, case-insensitively", () => {
		const d = base();
		const a = { ...newTable(d, area), label: "t1" };
		d.tables.push(a);
		const b = { ...newTable(d, area), label: "T1" };
		d.tables.push(b);
		const c = { ...newTable(d, area), label: " " };
		d.tables.push(c);
		const p = problems(d);
		expect(p.get(a.id)).toBe("label_dup");
		expect(p.get(b.id)).toBe("label_dup");
		expect(p.get(c.id)).toBe("label_empty");
	});

	it("pulls a dragged table into line with a neighbour", () => {
		const d = base();
		const a = at(d, 5, 10);
		d.tables.push(a);
		const b = at(d, 15, 11);
		const m = magnet(d, b, 15, 11);
		expect(m.y).toBe(10);
		expect(m.guides.length).toBeGreaterThan(0);
	});
});

describe("floor plan: walls", () => {
	it("dragging a corner keeps both walls straight", () => {
		const o = moveCorner(box(), 2, { x: 30, y: 20 });
		expect(o).toEqual([
			{ x: 2, y: 2 },
			{ x: 30, y: 2 },
			{ x: 30, y: 20 },
			{ x: 2, y: 20 },
		]);
	});

	it("dragging a wall slides it, and stays on the canvas", () => {
		// Wall 1 is the right-hand wall of the box.
		expect(moveWall(box(), 1, -6.4, 3)).toEqual([
			{ x: 2, y: 2 },
			{ x: 32, y: 2 },
			{ x: 32, y: 26 },
			{ x: 2, y: 26 },
		]);
		expect(moveWall(box(), 1, 99, 0)[1]).toEqual({ x: 40, y: 2 });
		expect(roomSize(box())).toEqual({ w: 18, h: 12 });
	});

	it("drops corners dragged onto each other, never below three", () => {
		const o = moveCorner(box(), 1, { x: 38, y: 26 });
		expect(cleanOutline(o)).toHaveLength(3);
	});

	it("knows what is inside an L-shaped room", () => {
		const l = ROOM_SHAPES.l;
		expect(boxInRoom({ x: 4, y: 4, w: 4, h: 4 }, l)).toBe(true);
		// The cut-out corner is outside.
		expect(boxInRoom({ x: 30, y: 4, w: 4, h: 4 }, l)).toBe(false);
		// Straddling the inner wall.
		expect(boxInRoom({ x: 22, y: 10, w: 4, h: 4 }, l)).toBe(false);
	});

	it("moving a wall in brings tables back inside", () => {
		const d = base();
		const t = at(d, 30, 10);
		d.tables.push(t);
		const small = moveWall(box(), 1, -12, 0);
		const moved: Draft = { ...d, areas: [{ ...d.areas[0]!, outline: small }] };
		expect(misplaced(moved, t)).toBe(true);
		const { draft, stuck } = settleArea(moved, area);
		expect(stuck).toBe(0);
		expect(misplaced(draft, draft.tables[0]!)).toBe(false);
	});

	it("reports tables that no longer fit anywhere", () => {
		const tiny = [
			{ x: 0, y: 0 },
			{ x: 7, y: 0 },
			{ x: 7, y: 7 },
			{ x: 0, y: 7 },
		];
		const d = base(tiny);
		d.tables.push(at(d, 1, 1), { ...at(d, 1, 1), id: "x", label: "9" });
		expect(settleArea(d, area).stuck).toBe(1);
	});
});

describe("floor plan: quick setup", () => {
	it("lays out the asked number of tables in the room", () => {
		const { draft, placed } = layOut(base(ROOM_SHAPES.l), area, 10);
		expect(placed).toBe(10);
		expect(draft.tables.map((t) => t.label)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
			"7",
			"8",
			"9",
			"10",
		]);
		for (const t of draft.tables) {
			expect(misplaced(draft, t)).toBe(false);
			expect(collides(draft, t)).toBe(false);
		}
	});

	it("says how many fit when the room is too small", () => {
		expect(layOut(base(ROOM_SHAPES.box), area, 200).placed).toBeLessThan(200);
	});

	it("a starter plan is a valid save, walls and all", () => {
		const r = PutFloorRequest.safeParse(toRequest(starterFloor("Inside")));
		expect(r.success).toBe(true);
		expect(r.data?.tables).toHaveLength(8);
		expect(r.data?.areas[0]?.outline).toHaveLength(6);
	});
});
