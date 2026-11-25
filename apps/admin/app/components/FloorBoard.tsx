import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type Draft,
	type DraftTable,
	fitsAt,
	GRID,
	magnet,
	misplaced,
	moveCorner,
	moveWall,
	type Pt,
	roomOf,
	roomSize,
} from "../lib/floor";

/**
 * The 2D floor plan: a dot-grid "breadboard" with the room's walls on it.
 * Drag a table to move it, drag a wall or a corner to resize the room, drag
 * the empty floor to look around, pinch or scroll to zoom. Everything is in
 * grid units; one unit is U px of SVG.
 */
export const U = 10;
const FULL = { x: -2, y: -2, w: GRID.cols * U + 4, h: GRID.rows * U + 4 };
const MIN_W = 70;

type View = { x: number; y: number; w: number; h: number };
type Drag =
	| {
			kind: "table";
			id: string;
			before: Draft;
			dx: number;
			dy: number;
			moved: boolean;
	  }
	| { kind: "corner"; i: number; before: Draft; start: Pt[] }
	| { kind: "wall"; i: number; before: Draft; start: Pt[]; from: Pt }
	| { kind: "pan"; sx: number; sy: number; view: View; moved: boolean }
	| { kind: "pinch"; d: number; view: View; gx: number; gy: number };

export type BoardProps = {
	draft: Draft;
	areaId: string;
	selected: string | null;
	/** Label problems by table id (empty or duplicate numbers). */
	bad: Map<string, unknown>;
	onSelect: (id: string | null) => void;
	/** Live change while dragging; not an undo step. */
	onLive: (d: Draft) => void;
	/** A drag finished: `before` is the undo point, the board settles the rest. */
	onDone: (before: Draft, kind: "table" | "room") => void;
	onDelete: (id: string) => void;
	/** The edit box for the selected table. */
	popover: (t: DraftTable) => ReactNode;
	tableLabel: (t: DraftTable) => string;
	labels: { zoomIn: string; zoomOut: string; fit: string; size: string };
};

export function FloorBoard(p: BoardProps) {
	const { draft, areaId } = p;
	const svg = useRef<SVGSVGElement>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const drag = useRef<Drag | null>(null);
	const ptrs = useRef(new Map<number, { x: number; y: number }>());
	const [view, setView] = useState<View>(FULL);
	const [guides, setGuides] = useState<[number, number, number, number][]>([]);
	const [room, setRoomDrag] = useState(false);
	const [, force] = useState(0);
	const dots = `dots${useId().replace(/[^a-z0-9]/gi, "")}`;

	const area = draft.areas.find((a) => a.id === areaId);
	const outline = roomOf(area);
	const here = draft.tables.filter((t) => t.areaId === areaId);
	const sel = here.find((t) => t.id === p.selected) ?? null;

	const fitView = (v: View): View => {
		const w = Math.max(MIN_W, Math.min(FULL.w, v.w));
		const h = (w * FULL.h) / FULL.w;
		return {
			w,
			h,
			x: Math.max(FULL.x, Math.min(FULL.x + FULL.w - w, v.x)),
			y: Math.max(FULL.y, Math.min(FULL.y + FULL.h - h, v.y)),
		};
	};
	/** Screen point -> grid units. */
	const toGrid = (cx: number, cy: number): Pt => {
		const el = svg.current;
		const m = el?.getScreenCTM();
		if (!el || !m) return { x: 0, y: 0 };
		const q = new DOMPoint(cx, cy).matrixTransform(m.inverse());
		return { x: q.x / U, y: q.y / U };
	};
	const zoomAt = (f: number, cx: number, cy: number) => {
		const r = svg.current?.getBoundingClientRect();
		if (!r) return;
		setView((v) => {
			const gx = v.x + ((cx - r.left) / r.width) * v.w;
			const gy = v.y + ((cy - r.top) / r.height) * v.h;
			const w = Math.max(MIN_W, Math.min(FULL.w, v.w * f));
			const h = (w * FULL.h) / FULL.w;
			return fitView({
				w,
				h,
				x: gx - ((cx - r.left) / r.width) * w,
				y: gy - ((cy - r.top) / r.height) * h,
			});
		});
	};
	const zoomMiddle = (f: number) => {
		const r = svg.current?.getBoundingClientRect();
		if (r) zoomAt(f, r.left + r.width / 2, r.top + r.height / 2);
	};

	// The browser scrolls the page on wheel unless the listener is not passive.
	useLayoutEffect(() => {
		const el = svg.current;
		if (!el) return;
		const onWheel = (e: globalThis.WheelEvent) => {
			e.preventDefault();
			zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	});
	// Re-place the edit box when the board changes size.
	useLayoutEffect(() => {
		const el = wrap.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => force((n) => n + 1));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const startPinch = () => {
		const [a, b] = [...ptrs.current.values()];
		const r = svg.current?.getBoundingClientRect();
		if (!a || !b || !r) return;
		const mx = (a.x + b.x) / 2;
		const my = (a.y + b.y) / 2;
		// A second finger cancels whatever the first one was dragging.
		const d = drag.current;
		if (d && "before" in d) p.onLive(d.before);
		setGuides([]);
		setRoomDrag(false);
		drag.current = {
			kind: "pinch",
			d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
			view,
			gx: view.x + ((mx - r.left) / r.width) * view.w,
			gy: view.y + ((my - r.top) / r.height) * view.h,
		};
	};

	const onDown = (e: PointerEvent<SVGSVGElement>) => {
		ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		svg.current?.setPointerCapture?.(e.pointerId);
		if (ptrs.current.size === 2) return startPinch();
		if (ptrs.current.size > 2) return;
		const el = e.target as Element;
		const g = toGrid(e.clientX, e.clientY);
		const corner = el.closest("[data-corner]");
		const wall = el.closest("[data-wall]");
		const tb = el.closest("[data-table]");
		if (corner) {
			drag.current = {
				kind: "corner",
				i: Number(corner.getAttribute("data-corner")),
				before: draft,
				start: outline,
			};
			setRoomDrag(true);
		} else if (wall) {
			drag.current = {
				kind: "wall",
				i: Number(wall.getAttribute("data-wall")),
				before: draft,
				start: outline,
				from: { x: Math.round(g.x), y: Math.round(g.y) },
			};
			setRoomDrag(true);
		} else if (tb) {
			const t = here.find((x) => x.id === tb.getAttribute("data-table"));
			if (!t) return;
			p.onSelect(t.id);
			drag.current = {
				kind: "table",
				id: t.id,
				before: draft,
				dx: g.x - t.x,
				dy: g.y - t.y,
				moved: false,
			};
		} else {
			drag.current = {
				kind: "pan",
				sx: e.clientX,
				sy: e.clientY,
				view,
				moved: false,
			};
		}
	};

	const setOutline = (o: Pt[]) =>
		p.onLive({
			...draft,
			areas: draft.areas.map((a) =>
				a.id === areaId ? { ...a, outline: o } : a,
			),
		});

	const onMove = (e: PointerEvent<SVGSVGElement>) => {
		if (!ptrs.current.has(e.pointerId)) return;
		ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const d = drag.current;
		if (!d) return;
		if (d.kind === "pinch") {
			const [a, b] = [...ptrs.current.values()];
			const r = svg.current?.getBoundingClientRect();
			if (!a || !b || !r) return;
			const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			const w = Math.max(MIN_W, Math.min(FULL.w, (d.view.w * d.d) / dist));
			const h = (w * FULL.h) / FULL.w;
			setView(
				fitView({
					w,
					h,
					x: d.gx - ((mx - r.left) / r.width) * w,
					y: d.gy - ((my - r.top) / r.height) * h,
				}),
			);
			return;
		}
		if (d.kind === "pan") {
			const r = svg.current?.getBoundingClientRect();
			if (!r) return;
			const dx = e.clientX - d.sx;
			const dy = e.clientY - d.sy;
			if (Math.hypot(dx, dy) > 4) d.moved = true;
			if (d.moved)
				setView(
					fitView({
						...d.view,
						x: d.view.x - (dx / r.width) * d.view.w,
						y: d.view.y - (dy / r.height) * d.view.h,
					}),
				);
			return;
		}
		const g = toGrid(e.clientX, e.clientY);
		if (d.kind === "corner")
			return setOutline(
				moveCorner(d.start, d.i, { x: Math.round(g.x), y: Math.round(g.y) }),
			);
		if (d.kind === "wall")
			return setOutline(
				moveWall(
					d.start,
					d.i,
					Math.round(g.x) - d.from.x,
					Math.round(g.y) - d.from.y,
				),
			);
		const t = draft.tables.find((x) => x.id === d.id);
		if (!t) return;
		const x = Math.max(0, Math.min(GRID.cols - t.w, Math.round(g.x - d.dx)));
		const y = Math.max(0, Math.min(GRID.rows - t.h, Math.round(g.y - d.dy)));
		if (x === t.x && y === t.y) return;
		d.moved = true;
		const m = magnet(draft, t, x, y);
		setGuides(m.guides);
		p.onLive({
			...draft,
			tables: draft.tables.map((o) =>
				o.id === t.id ? { ...o, x: m.x, y: m.y } : o,
			),
		});
	};

	const onUp = (e: PointerEvent<SVGSVGElement>) => {
		ptrs.current.delete(e.pointerId);
		const d = drag.current;
		if (!d) return;
		if (d.kind === "pinch") {
			if (ptrs.current.size === 0) drag.current = null;
			return;
		}
		drag.current = null;
		setGuides([]);
		setRoomDrag(false);
		if (d.kind === "pan") {
			if (!d.moved) p.onSelect(null);
			return;
		}
		if (d.kind === "table") {
			if (d.moved) p.onDone(d.before, "table");
			return;
		}
		p.onDone(d.before, "room");
	};

	const onTableKey = (e: KeyboardEvent<SVGGElement>, t: DraftTable) => {
		const step: Record<string, [number, number]> = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1],
		};
		const s = step[e.key];
		if (s) {
			e.preventDefault();
			if (!fitsAt(draft, t, t.x + s[0], t.y + s[1])) return;
			const before = draft;
			p.onLive({
				...draft,
				tables: draft.tables.map((o) =>
					o.id === t.id ? { ...o, x: o.x + s[0], y: o.y + s[1] } : o,
				),
			});
			p.onDone(before, "table");
		} else if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			p.onDelete(t.id);
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			p.onSelect(t.id);
		} else if (e.key === "Escape") p.onSelect(null);
	};

	const poly = outline.map((q) => `${q.x * U},${q.y * U}`).join(" ");
	const size = roomSize(outline);

	// Where the edit box goes: above the table, or below when there's no room.
	// On a phone it sits under the board instead, so it never hides the tables.
	let pop: { left: number; top: number; below: boolean } | null = null;
	const r = svg.current?.getBoundingClientRect();
	const narrow = !!r && r.width < 560;
	if (sel && r && !narrow && !drag.current) {
		const sx = (gx: number) => ((gx * U - view.x) / view.w) * r.width;
		const sy = (gy: number) => ((gy * U - view.y) / view.h) * r.height;
		const top = sy(sel.y);
		const below = top < 260;
		pop = {
			left: Math.max(130, Math.min(r.width - 130, sx(sel.x + sel.w / 2))),
			top: below ? Math.min(r.height - 40, sy(sel.y + sel.h)) : top,
			below,
		};
	}

	return (
		<div className="floor-board" ref={wrap} dir="ltr">
			<svg
				ref={svg}
				className="floor-board__svg"
				viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
				style={{ aspectRatio: `${FULL.w} / ${FULL.h}` }}
				onPointerDown={onDown}
				onPointerMove={onMove}
				onPointerUp={onUp}
				onPointerCancel={onUp}
				role="application"
			>
				<defs>
					<pattern
						id={dots}
						width={U}
						height={U}
						patternUnits="userSpaceOnUse"
						x={-U / 2}
						y={-U / 2}
					>
						<circle
							cx={U / 2}
							cy={U / 2}
							r={0.75}
							className="floor-board__dot"
						/>
					</pattern>
				</defs>
				<rect
					x={FULL.x}
					y={FULL.y}
					width={FULL.w}
					height={FULL.h}
					fill={`url(#${dots})`}
				/>
				<path
					className="floor-board__outside"
					fillRule="evenodd"
					d={`M${FULL.x} ${FULL.y}H${FULL.x + FULL.w}V${FULL.y + FULL.h}H${FULL.x}Z M${outline.map((q) => `${q.x * U} ${q.y * U}`).join(" L")}Z`}
				/>
				<polygon points={poly} className="floor-board__room" />
				<polygon points={poly} fill={`url(#${dots})`} />
				<polygon points={poly} className="floor-board__wall" />
				{here.map((t) => (
					// biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
					<g
						key={t.id}
						data-table={t.id}
						className="floor-board__table"
						data-selected={t.id === p.selected || undefined}
						data-bad={p.bad.has(t.id) || misplaced(draft, t) || undefined}
						tabIndex={0}
						role="button"
						aria-pressed={t.id === p.selected}
						aria-label={p.tableLabel(t)}
						onKeyDown={(e) => onTableKey(e, t)}
					>
						<TableArt t={t} />
					</g>
				))}
				{guides.map(([x1, y1, x2, y2]) => (
					<line
						key={`${x1},${y1},${x2},${y2}`}
						x1={x1 * U}
						y1={y1 * U}
						x2={x2 * U}
						y2={y2 * U}
						className="floor-board__guide"
					/>
				))}
				{outline.map((q, i) => {
					const n = outline[(i + 1) % outline.length] as Pt;
					const way = q.y === n.y ? "level" : q.x === n.x ? "upright" : "slant";
					return (
						<line
							// biome-ignore lint/suspicious/noArrayIndexKey: walls are positional
							key={`w${i}`}
							data-wall={i}
							data-way={way}
							className="floor-board__wall-grip"
							x1={q.x * U}
							y1={q.y * U}
							x2={n.x * U}
							y2={n.y * U}
						/>
					);
				})}
				{outline.map((q, i) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: corners are positional
						key={`c${i}`}
						data-corner={i}
						className="floor-board__corner"
						cx={q.x * U}
						cy={q.y * U}
						r={2.4}
					/>
				))}
				{room && (
					<g className="floor-board__size">
						<rect
							x={(GRID.cols / 2) * U - 20}
							y={(GRID.rows / 2) * U - 4}
							width={40}
							height={8}
							rx={4}
						/>
						<text x={(GRID.cols / 2) * U} y={(GRID.rows / 2) * U}>
							{p.labels.size
								.replace("{w}", String(size.w))
								.replace("{h}", String(size.h))}
						</text>
					</g>
				)}
			</svg>
			{sel && narrow && (
				<div className="floor-pop" data-flow>
					{p.popover(sel)}
				</div>
			)}
			{sel && pop && (
				<div
					className="floor-pop"
					data-below={pop.below || undefined}
					style={{ left: pop.left, top: pop.top }}
				>
					{p.popover(sel)}
				</div>
			)}
			<div className="floor-zoom">
				<button
					type="button"
					onClick={() => zoomMiddle(0.75)}
					aria-label={p.labels.zoomIn}
				>
					+
				</button>
				<button
					type="button"
					onClick={() => zoomMiddle(1.33)}
					aria-label={p.labels.zoomOut}
				>
					−
				</button>
				<button
					type="button"
					onClick={() => setView(FULL)}
					aria-label={p.labels.fit}
				>
					⤢
				</button>
			</div>
		</div>
	);
}

/** One table, drawn as the room would look from above: top and chairs. */
function TableArt({ t }: { t: DraftTable }) {
	const X = t.x * U;
	const Y = t.y * U;
	const W = t.w * U;
	const H = t.h * U;
	const n = Math.min(t.seats, 16);
	const chairs: ReactNode[] = [];
	const bar = (k: string, x: number, y: number, w: number, h: number) =>
		chairs.push(
			<rect
				key={k}
				x={x}
				y={y}
				width={w}
				height={h}
				rx={0.8}
				className="floor-board__chair"
			/>,
		);
	if (t.shape === "round") {
		for (let i = 0; i < n; i++) {
			const a = (i / n) * 2 * Math.PI - Math.PI / 2;
			chairs.push(
				<circle
					key={i}
					cx={X + W / 2 + (W / 2 + 0.2) * Math.cos(a)}
					cy={Y + H / 2 + (H / 2 + 0.2) * Math.sin(a)}
					r={1.5}
					className="floor-board__chair"
				/>,
			);
		}
	} else if (t.shape === "square") {
		const c = [0, 0, 0, 0];
		for (let i = 0; i < n; i++) c[i % 4] = (c[i % 4] as number) + 1;
		const [top, bottom, left, right] = c as [number, number, number, number];
		for (let i = 0; i < top; i++)
			bar(`t${i}`, X + (W * (i + 1)) / (top + 1) - 2, Y - 0.4, 4, 1.6);
		for (let i = 0; i < bottom; i++)
			bar(`b${i}`, X + (W * (i + 1)) / (bottom + 1) - 2, Y + H - 1.2, 4, 1.6);
		for (let i = 0; i < left; i++)
			bar(`l${i}`, X - 0.4, Y + (H * (i + 1)) / (left + 1) - 2, 1.6, 4);
		for (let i = 0; i < right; i++)
			bar(`r${i}`, X + W - 1.2, Y + (H * (i + 1)) / (right + 1) - 2, 1.6, 4);
	} else {
		const wide = W >= H;
		const a = Math.ceil(n / 2);
		const b = n - a;
		for (let i = 0; i < a; i++)
			wide
				? bar(`a${i}`, X + (W * (i + 1)) / (a + 1) - 2, Y - 0.4, 4, 1.6)
				: bar(`a${i}`, X - 0.4, Y + (H * (i + 1)) / (a + 1) - 2, 1.6, 4);
		for (let i = 0; i < b; i++)
			wide
				? bar(`b${i}`, X + (W * (i + 1)) / (b + 1) - 2, Y + H - 1.2, 4, 1.6)
				: bar(`b${i}`, X + W - 1.2, Y + (H * (i + 1)) / (b + 1) - 2, 1.6, 4);
	}
	return (
		<>
			{chairs}
			{t.shape === "round" ? (
				<ellipse
					cx={X + W / 2}
					cy={Y + H / 2}
					rx={W / 2 - 1.2}
					ry={H / 2 - 1.2}
					className="floor-board__top"
				/>
			) : (
				<rect
					x={X + 1.2}
					y={Y + 1.2}
					width={W - 2.4}
					height={H - 2.4}
					rx={1.8}
					className="floor-board__top"
				/>
			)}
			<text x={X + W / 2} y={Y + H / 2} className="floor-board__label">
				{t.label || "?"}
			</text>
		</>
	);
}
