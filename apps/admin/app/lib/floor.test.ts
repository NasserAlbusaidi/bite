import { PutFloorRequest } from "@bite/contracts";
import { describe, expect, it } from "vitest";
import {
	clampBox,
	collides,
	type Draft,
	freeSpot,
	newTable,
	nextLabel,
	problems,
	starterFloor,
	toRequest,
} from "./floor";

const area = "0193a1b2-0000-7000-8000-000000000001";
const base = (): Draft => ({
	areas: [{ id: area, name: "Inside", sortOrder: 0 }],
	tables: [],
});

describe("floor plan editor helpers", () => {
	it("numbers new tables past the highest number", () => {
		const d = base();
		expect(nextLabel(d)).toBe("1");
		d.tables.push({ ...newTable(d, area), label: "7" });
		d.tables.push({ ...newTable(d, area), label: "T2" });
		expect(nextLabel(d)).toBe("8");
	});

	it("places new tables where nothing else is", () => {
		const d = base();
		for (let i = 0; i < 10; i++) d.tables.push(newTable(d, area));
		for (const t of d.tables) expect(collides(d, t)).toBe(false);
		expect(freeSpot(base(), area, 2, 2)).toEqual({ x: 1, y: 1 });
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

	it("a starter plan is a valid save", () => {
		const r = PutFloorRequest.safeParse(toRequest(starterFloor("Inside")));
		expect(r.success).toBe(true);
		expect(r.data?.tables).toHaveLength(8);
	});
});
