import { describe, expect, it } from "vitest";
import {
	bites,
	covers,
	crumbs,
	loaderCss,
	logo,
	type Script,
} from "./bite-loader";

const scripts: Script[] = ["latin", "arabic"];

/** The logo outline as polygons (cubic curves flattened), absolute M/L/C/Z only. */
function polygons(d: string): [number, number][][] {
	const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
	const out: [number, number][][] = [];
	let cur: [number, number][] = [];
	let i = 0;
	let cmd = "";
	const num = () => Number(tokens[i++]);
	while (i < tokens.length) {
		const tk = tokens[i] as string;
		if (/[MLCZ]/.test(tk)) {
			cmd = tk;
			i++;
			if (cmd === "Z") {
				if (cur.length) out.push(cur);
				cur = [];
				continue;
			}
		}
		if (cmd === "M") {
			if (cur.length) out.push(cur);
			cur = [[num(), num()]];
			cmd = "L";
		} else if (cmd === "L") cur.push([num(), num()]);
		else if (cmd === "C") {
			const [x0, y0] = cur[cur.length - 1] ?? [0, 0];
			const p = [num(), num(), num(), num(), num(), num()] as const;
			for (let s = 1; s <= 8; s++) {
				const t = s / 8;
				const u = 1 - t;
				cur.push([
					u * u * u * x0 +
						3 * u * u * t * p[0] +
						3 * u * t * t * p[2] +
						t * t * t * p[4],
					u * u * u * y0 +
						3 * u * u * t * p[1] +
						3 * u * t * t * p[3] +
						t * t * t * p[5],
				]);
			}
		}
	}
	if (cur.length) out.push(cur);
	return out;
}

/** Even-odd fill rule, like the logo's `fill-rule="evenodd"`. */
function inside(polys: [number, number][][], x: number, y: number): boolean {
	let hit = false;
	for (const poly of polys)
		for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
			const [xa, ya] = poly[a] as [number, number];
			const [xb, yb] = poly[b] as [number, number];
			if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa)
				hit = !hit;
		}
	return hit;
}

function box(script: Script) {
	const [, , w, h] = logo(script).viewBox.split(" ").map(Number);
	return { W: w ?? 0, H: h ?? 0 };
}

describe.each(scripts)("bite loader (%s)", (script) => {
	it("is deterministic, so the prerendered first frame matches the app", () => {
		expect(loaderCss(script, "x")).toBe(loaderCss(script, "x"));
		expect(covers(script)).toEqual(covers(script));
	});

	it("starts at the bite already in the logo", () => {
		const [first] = bites(script);
		const [ox, oy] = logo(script).origin;
		expect(first).toMatchObject({ x: ox, y: oy });
		expect(first?.t).toBe(Math.min(...bites(script).map((b) => b.t)));
	});

	it("eats the whole logo before it fades out at 80%", () => {
		const { W, H } = box(script);
		const cs = covers(script);
		const polys = polygons(logo(script).d);
		const missed: string[] = [];
		let checked = 0;
		for (let x = 0; x <= W; x += W / 120)
			for (let y = 0; y <= H; y += H / 60) {
				if (!inside(polys, x, y)) continue;
				checked++;
				if (!cs.some((c) => Math.hypot(x - c.cx, y - c.cy) <= c.r))
					missed.push(`${x.toFixed(0)},${y.toFixed(0)}`);
			}
		expect(checked).toBeGreaterThan(500); // the outline parsed: lots of points are in the logo
		expect(missed).toEqual([]);
		// every bite has landed (start + 2% grow) before the fade at 78%
		for (const c of cs) expect(c.start + 0.02).toBeLessThan(0.78);
	});

	it("drops two crumbs per bite, never above the bite", () => {
		const cr = crumbs(script);
		expect(cr).toHaveLength(bites(script).length * 2);
		for (const c of cr) {
			expect(c.from[1]).toBeGreaterThanOrEqual(0);
			expect(c.to[1]).toBeGreaterThanOrEqual(0);
			expect(c.end[1]).toBeGreaterThanOrEqual(c.to[1]);
		}
	});

	it("crumbs come in two sizes: the logo's own and one step smaller", () => {
		const { H } = box(script);
		const full = H * 0.025;
		for (const c of crumbs(script)) {
			expect(c.r).toBeGreaterThanOrEqual(full * 0.65 - 1e-9);
			expect(c.r).toBeLessThanOrEqual(full + 1e-9);
		}
	});

	it("only animates transform and opacity", () => {
		const css = loaderCss(script, "x");
		// and only when the person hasn't asked for reduced motion
		expect(
			css.startsWith("@media (prefers-reduced-motion:no-preference){"),
		).toBe(true);
		const props =
			css.replace(/^@media[^{]*\{/, "").match(/[a-z-]+(?=:)/g) ?? [];
		const allowed = new Set([
			"transform",
			"opacity",
			"animation-timing-function",
			"animation-name",
		]);
		expect([...new Set(props)].filter((p) => !allowed.has(p))).toEqual([]);
	});
});
