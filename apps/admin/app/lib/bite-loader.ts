/**
 * The "Bite" loader: the real wordmark gets eaten bite by bite, starting at
 * the bite that is already in the logo, with crumbs falling off each bite.
 * When it is all eaten it fades out and the whole logo fades back in.
 *
 * Bites are circles painted in the page background over the logo, so it works
 * the same in every browser (no animated SVG masks, no CSS `r`). Only
 * `transform` and `opacity` animate. Everything here is pure and deterministic
 * so the markup can be prerendered into index.html and unit tested.
 */
import {
	ARABIC_PATH,
	ARABIC_VIEWBOX,
	LATIN_PATH,
	LATIN_VIEWBOX,
} from "@bite/ui/brand";

export type Script = "latin" | "arabic";
export const LOOP_MS = 6800;

type Pt = { x: number; y: number };
type Bite = Pt & { r: number; t: number };
export type Cover = { cx: number; cy: number; r: number; start: number };
export type Crumb = {
	cx: number;
	cy: number;
	r: number;
	start: number;
	from: [number, number];
	to: [number, number];
	end: [number, number];
};

const LOGO = {
	latin: { d: LATIN_PATH, viewBox: LATIN_VIEWBOX, origin: [1300, 215] },
	arabic: { d: ARABIC_PATH, viewBox: ARABIC_VIEWBOX, origin: [1000, 310] },
} as const;

/** Stable 0–1 noise, so every render (and the prerender) matches. */
function noise(a: number, b = 0): number {
	const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
	return h - Math.floor(h);
}

function size(script: Script) {
	const [, , w, h] = LOGO[script].viewBox.split(" ").map(Number);
	const W = w ?? 0;
	const H = h ?? 0;
	return { W, H, R: script === "arabic" ? W * 0.13 : H * 0.2 };
}

/** Where and when each bite lands, as fractions of the loop. */
export function bites(script: Script): Bite[] {
	const { W, H, R } = size(script);
	const [ox, oy] = LOGO[script].origin;
	const span = (i: number, n: number, a: number, b: number) =>
		a + (b - a) * (n < 2 ? 0 : i / (n - 1));
	const grid: Pt[] = [];
	// The Arabic lettering is taller, so it gets a fourth row.
	const rows =
		script === "arabic" ? [0.08, 0.34, 0.6, 0.86] : [0.2, 0.52, 0.84];
	for (let x = -R * 0.3; x <= W + R * 0.3; x += R * 1.05)
		for (const fy of rows) grid.push({ x, y: fy * H });
	// The far end of the word is finished by hand-placed bites below, so the
	// ending is uneven instead of a neat stack.
	const ripple = grid
		.filter((p) => p.x > R * 1.25)
		.sort(
			(p, q) => Math.hypot(p.x - ox, p.y - oy) - Math.hypot(q.x - ox, q.y - oy),
		);
	// The second bite takes the logo's own flying crumbs.
	const own =
		script === "arabic"
			? { x: W * 0.93, y: H * 0.33, r: R * 0.75 }
			: { x: W * 0.77, y: H * 0.08, r: R * 0.75 };
	const all: (Pt & { r?: number })[] = [
		{ x: ox, y: oy, r: R * 0.9 },
		own,
		...ripple,
	];
	const body = all.map((p, i): Bite => {
		const j = noise(i + 3, 1);
		return {
			x: p.x + (i ? (j - 0.5) * R * 0.16 : 0),
			y: p.y + (i ? (((j * 13) % 1) - 0.5) * H * 0.03 : 0),
			r: (p.r ?? R) * (i ? 1.02 + ((j * 7) % 1) * 0.12 : 1),
			t: span(i, all.length, 0.06, 0.54),
		};
	});
	const tail: [number, number, number, number][] = [
		[1.05, 0.12, 1.2, 0.565],
		[0.25, 0.42, 1.35, 0.585],
		[1.0, 0.66, 0.9, 0.615],
		[0.05, 0.12, 0.8, 0.64],
		[0.4, 0.92, 1.15, 0.685],
	];
	return [
		...body,
		...tail.map(([x, y, s, t]) => ({ x: R * x, y: H * y, r: R * s, t })),
	];
}

/** The circles that make up each bite (a main bite plus two smaller lobes). */
export function covers(script: Script): Cover[] {
	return bites(script).flatMap((b) =>
		(
			[
				[0, 0, 1],
				[0.75, -0.35, 0.45],
				[-0.2, 0.8, 0.4],
			] as const
		).map(([dx, dy, s]) => ({
			cx: b.x + dx * b.r,
			cy: b.y + dy * b.r,
			r: b.r * s,
			start: b.t,
		})),
	);
}

/**
 * Two crumbs per bite. They fly the way the eating is heading (from the
 * original bite toward this one), never above the bite, at one of two sizes,
 * and each bite spaces its crumbs a little differently.
 */
export function crumbs(script: Script): Crumb[] {
	const { H, R } = size(script);
	const [ox, oy] = LOGO[script].origin;
	const clamp = (a: number, lo: number, hi: number) =>
		Math.min(hi, Math.max(lo, a));
	return bites(script).flatMap((b, i) => {
		let heading =
			Math.hypot(b.x - ox, b.y - oy) < R * 0.5
				? Math.PI
				: Math.atan2(b.y - oy, b.x - ox);
		if (Math.sin(heading) < 0) heading = -heading;
		heading = clamp(heading, Math.PI * 0.06, Math.PI * 0.94);
		const rb = noise(i + 1, 7);
		const spread = (0.12 + rb * 0.22) * Math.PI;
		const reach = 0.75 + rb * 0.6;
		return [0, 1].map((k): Crumb => {
			const rr = noise(i + 1, k + 1);
			const a = clamp(
				heading + (k - 0.5) * spread + (rr - 0.5) * 0.15,
				Math.PI * 0.04,
				Math.PI * 0.96,
			);
			const e0 = b.r * 0.55;
			const e1 = b.r * (0.55 + (0.3 + rr * 0.3) * reach);
			const drop = R * (0.12 + rr * 0.12);
			const at = (e: number): [number, number] => [
				Math.cos(a) * e,
				Math.sin(a) * e,
			];
			const to = at(e1);
			return {
				cx: b.x,
				cy: b.y,
				r: H * 0.025 * (0.65 + 0.35 * ((rr * 7) % 1)),
				start: b.t,
				from: at(e0),
				to,
				end: [to[0] * 1.08, to[1] * 1.08 + drop],
			};
		});
	});
}

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
const px = (n: number) => `${n.toFixed(0)}px`;

/** Keyframes for one script. `id` keeps the two scripts' names apart. */
export function loaderCss(script: Script, id: string): string {
	let css = "";
	covers(script).forEach((c, i) => {
		css += `@keyframes ${id}c${i}{0%,${pct(c.start)}{transform:scale(0)}${pct(c.start + 0.02)},80.5%{transform:scale(1)}81%,100%{transform:scale(0)}}.${id} .bl-c${i}{animation-name:${id}c${i}}`;
	});
	crumbs(script).forEach((c, i) => {
		const tr = (p: [number, number]) => `translate(${px(p[0])},${px(p[1])})`;
		css += `@keyframes ${id}k${i}{0%,${pct(c.start)}{opacity:0;transform:${tr(c.from)};animation-timing-function:cubic-bezier(.2,.8,.4,1)}${pct(c.start + 0.005)}{opacity:1}${pct(c.start + 0.04)}{opacity:1;transform:${tr(c.to)};animation-timing-function:ease-in}${pct(c.start + 0.09)},100%{opacity:0;transform:${tr(c.end)}}}.${id} .bl-k${i}{animation-name:${id}k${i}}`;
	});
	// Only when motion is welcome; otherwise styles.css just fades the logo.
	return `@media (prefers-reduced-motion:no-preference){${css}}`;
}

export function logo(script: Script) {
	return LOGO[script];
}
