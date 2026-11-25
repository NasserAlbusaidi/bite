import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
	type Draft,
	type DraftTable,
	GRID,
	magnet,
	misplaced,
	moveWall,
	type Pt,
	roomOf,
} from "../lib/floor";
import type { BoardProps } from "./FloorBoard";

/**
 * The same floor, in 3D. One finger turns the room, pinch zooms, two fingers
 * move it, double-tap resets. Tables and walls drag just like in 2D: one grid
 * dot is one unit of the 3D world, on the floor plane y = 0.
 */
type Props = BoardProps & { failed: string; reset: string };

const WALL_H = 3;
const HOME = { theta: 0, phi: 0.95, radius: 46 };

type Orbit = {
	theta: number;
	phi: number;
	radius: number;
	target: THREE.Vector3;
};
type Drag =
	| {
			kind: "table";
			id: string;
			before: Draft;
			dx: number;
			dy: number;
			moved: boolean;
	  }
	| { kind: "wall"; i: number; before: Draft; start: Pt[]; from: Pt }
	| { kind: "orbit"; theta: number; phi: number }
	| {
			kind: "pinch";
			d: number;
			mid: { x: number; y: number };
			radius: number;
			target: THREE.Vector3;
	  };

/** The starting view; a narrow screen (a phone) steps back to fit the room. */
const home = (aspect = 1.5): Orbit => ({
	...HOME,
	radius: HOME.radius * Math.max(1, 1.2 / aspect),
	target: new THREE.Vector3(GRID.cols / 2, 0, GRID.rows / 2),
});

export default function Floor3D(p: Props) {
	const wrap = useRef<HTMLDivElement>(null);
	const [broken, setBroken] = useState(false);
	const props = useRef(p);
	props.current = p;
	// The scene lives outside React; these let the effects talk to it.
	const world = useRef<{
		draw: () => void;
		zoom: (f: number) => void;
		reset: () => void;
	} | null>(null);

	useEffect(() => {
		const el = wrap.current;
		if (!el) return;
		let renderer: THREE.WebGLRenderer;
		try {
			renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		} catch {
			setBroken(true);
			return;
		}
		renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
		renderer.domElement.className = "floor-board__canvas";
		renderer.domElement.style.touchAction = "none";
		el.prepend(renderer.domElement);

		const css = getComputedStyle(el);
		const tone = (name: string, fallback: string) =>
			new THREE.Color(css.getPropertyValue(name).trim() || fallback);
		const C = {
			floor: tone("--surface", "#ffffff"),
			outside: tone("--surface-sunken", "#ecf1e6"),
			wall: tone("--line-strong", "#7e8f72"),
			dot: tone("--line-strong", "#7e8f72"),
			table: tone("--text-strong", "#004225"),
			chair: tone("--line", "#dce4d2"),
			on: tone("--action", "#7ac70c"),
			bad: tone("--danger", "#b4321b"),
			text: css.getPropertyValue("--text-strong").trim() || "#004225",
		};

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
		scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
		const sun = new THREE.DirectionalLight(0xffffff, 1.4);
		sun.position.set(10, 40, 25);
		scene.add(sun);

		const ground = new THREE.Mesh(
			new THREE.PlaneGeometry(400, 400),
			new THREE.MeshLambertMaterial({ color: C.outside }),
		);
		ground.rotation.x = -Math.PI / 2;
		ground.position.set(GRID.cols / 2, -0.05, GRID.rows / 2);
		scene.add(ground);

		const stuff = new THREE.Group();
		scene.add(stuff);
		const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
		const ray = new THREE.Raycaster();
		let orbit = home(camera.aspect);
		let frame = 0;

		const render = () => {
			frame = 0;
			const { theta, phi, radius, target } = orbit;
			camera.position.set(
				target.x + radius * Math.sin(phi) * Math.sin(theta),
				target.y + radius * Math.cos(phi),
				target.z + radius * Math.sin(phi) * Math.cos(theta),
			);
			camera.lookAt(target);
			renderer.render(scene, camera);
		};
		const kick = () => {
			if (!frame) frame = requestAnimationFrame(render);
		};

		const dispose = (o: THREE.Object3D) =>
			o.traverse((m) => {
				if (
					m instanceof THREE.Mesh ||
					m instanceof THREE.Points ||
					m instanceof THREE.Sprite
				) {
					m.geometry.dispose();
					const mat = m.material as THREE.Material & {
						map?: THREE.Texture | null;
					};
					mat.map?.dispose();
					mat.dispose();
				}
			});

		const label = (text: string) => {
			const c = document.createElement("canvas");
			c.width = 128;
			c.height = 64;
			const g = c.getContext("2d");
			if (g) {
				g.font = "bold 40px system-ui, sans-serif";
				g.textAlign = "center";
				g.textBaseline = "middle";
				g.fillStyle = "#ffffff";
				g.fillText(text, 64, 34);
			}
			const s = new THREE.Sprite(
				new THREE.SpriteMaterial({
					map: new THREE.CanvasTexture(c),
					depthTest: false,
				}),
			);
			s.scale.set(2.6, 1.3, 1);
			return s;
		};

		const tableMesh = (t: DraftTable, color: THREE.Color) => {
			const g = new THREE.Group();
			const cx = t.x + t.w / 2;
			const cz = t.y + t.h / 2;
			const mat = new THREE.MeshLambertMaterial({ color });
			const top =
				t.shape === "round"
					? new THREE.Mesh(
							new THREE.CylinderGeometry(t.w / 2 - 1, t.w / 2 - 1, 0.25, 32),
							mat,
						)
					: new THREE.Mesh(new THREE.BoxGeometry(t.w - 2, 0.25, t.h - 2), mat);
			top.position.set(cx, 1.5, cz);
			const leg = new THREE.Mesh(
				new THREE.CylinderGeometry(0.25, 0.4, 1.5, 12),
				new THREE.MeshLambertMaterial({ color: C.wall }),
			);
			leg.position.set(cx, 0.75, cz);
			g.add(top, leg);
			const n = Math.min(t.seats, 16);
			const chair = (x: number, z: number) => {
				const m = new THREE.Mesh(
					new THREE.BoxGeometry(1.2, 0.9, 1.2),
					new THREE.MeshLambertMaterial({ color: C.chair }),
				);
				m.position.set(x, 0.45, z);
				g.add(m);
			};
			if (t.shape === "round") {
				for (let i = 0; i < n; i++) {
					const a = (i / n) * 2 * Math.PI;
					chair(
						cx + (t.w / 2 - 0.3) * Math.sin(a),
						cz - (t.h / 2 - 0.3) * Math.cos(a),
					);
				}
			} else {
				const wide = t.w >= t.h;
				const sides = t.shape === "square" ? 4 : 2;
				const per = Array.from(
					{ length: sides },
					(_, i) => Math.floor(n / sides) + (i < n % sides ? 1 : 0),
				);
				const along = (count: number, side: number) => {
					for (let i = 0; i < count; i++) {
						const f = (i + 1) / (count + 1);
						const ends = [
							[t.x + t.w * f, t.y + 0.6],
							[t.x + t.w * f, t.y + t.h - 0.6],
							[t.x + 0.6, t.y + t.h * f],
							[t.x + t.w - 0.6, t.y + t.h * f],
						] as const;
						const k = wide || sides === 4 ? side : side + 2;
						const [x, z] = ends[k] as readonly [number, number];
						chair(x, z);
					}
				};
				for (const [side, c] of per.entries()) along(c, side);
			}
			const s = label(t.label || "?");
			s.position.set(cx, 2.4, cz);
			g.add(s);
			g.traverse((o) => {
				o.userData.table = t.id;
			});
			return g;
		};

		const draw = () => {
			const { draft, areaId, selected, bad } = props.current;
			for (const c of [...stuff.children]) {
				stuff.remove(c);
				dispose(c);
			}
			const outline = roomOf(draft.areas.find((a) => a.id === areaId));
			const shape = new THREE.Shape(
				outline.map((q) => new THREE.Vector2(q.x, q.y)),
			);
			const floor = new THREE.Mesh(
				new THREE.ShapeGeometry(shape),
				new THREE.MeshLambertMaterial({
					color: C.floor,
					side: THREE.DoubleSide,
				}),
			);
			floor.rotation.x = Math.PI / 2;
			stuff.add(floor);

			// The breadboard dots, on the floor.
			const dots: number[] = [];
			const inRoom = (x: number, y: number) => {
				let inside = false;
				for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
					const a = outline[i] as Pt;
					const b = outline[j] as Pt;
					if (
						a.y > y !== b.y > y &&
						x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
					)
						inside = !inside;
				}
				return inside;
			};
			for (let x = 0; x <= GRID.cols; x++)
				for (let y = 0; y <= GRID.rows; y++)
					if (inRoom(x + 0.01, y + 0.01)) dots.push(x, 0.02, y);
			const pg = new THREE.BufferGeometry();
			pg.setAttribute("position", new THREE.Float32BufferAttribute(dots, 3));
			stuff.add(
				new THREE.Points(
					pg,
					new THREE.PointsMaterial({ color: C.dot, size: 0.18 }),
				),
			);

			outline.forEach((a, i) => {
				const b = outline[(i + 1) % outline.length] as Pt;
				const len = Math.hypot(b.x - a.x, b.y - a.y);
				const wall = new THREE.Mesh(
					new THREE.BoxGeometry(len + 0.3, WALL_H, 0.3),
					new THREE.MeshLambertMaterial({
						color: C.wall,
						transparent: true,
						opacity: 0.85,
					}),
				);
				wall.position.set((a.x + b.x) / 2, WALL_H / 2, (a.y + b.y) / 2);
				wall.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
				wall.userData.wall = i;
				stuff.add(wall);
			});

			for (const t of draft.tables) {
				if (t.areaId !== areaId) continue;
				const color =
					bad.has(t.id) || misplaced(draft, t)
						? C.bad
						: t.id === selected
							? C.on
							: C.table;
				stuff.add(tableMesh(t, color));
			}
			kick();
		};

		const size = () => {
			const r = el.getBoundingClientRect();
			renderer.setSize(r.width, r.height, false);
			const first = camera.aspect === 1;
			camera.aspect = r.width / Math.max(1, r.height);
			camera.updateProjectionMatrix();
			if (first) orbit = home(camera.aspect);
			kick();
		};
		const ro = new ResizeObserver(size);
		ro.observe(el);
		size();

		// ----------------------------------------------------------- pointers
		const cvs = renderer.domElement;
		const ptrs = new Map<number, { x: number; y: number }>();
		let drag: Drag | null = null;
		let down = { x: 0, y: 0, at: 0, hit: null as string | null };
		let lastTap = 0;

		const cast = (cx: number, cy: number) => {
			const r = cvs.getBoundingClientRect();
			ray.setFromCamera(
				new THREE.Vector2(
					((cx - r.left) / r.width) * 2 - 1,
					-((cy - r.top) / r.height) * 2 + 1,
				),
				camera,
			);
		};
		const onFloor = (cx: number, cy: number): Pt => {
			cast(cx, cy);
			const v = new THREE.Vector3();
			ray.ray.intersectPlane(floorPlane, v);
			return { x: v.x, y: v.z };
		};
		const pick = (cx: number, cy: number) => {
			cast(cx, cy);
			for (const h of ray.intersectObjects(stuff.children, true)) {
				if (h.object.userData.table)
					return { table: h.object.userData.table as string };
				if (typeof h.object.userData.wall === "number")
					return { wall: h.object.userData.wall as number };
			}
			return {};
		};

		const startPinch = () => {
			const [a, b] = [...ptrs.values()];
			if (!a || !b) return;
			if (drag && "before" in drag) props.current.onLive(drag.before);
			drag = {
				kind: "pinch",
				d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
				mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
				radius: orbit.radius,
				target: orbit.target.clone(),
			};
		};

		const onDown = (e: PointerEvent) => {
			ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
			cvs.setPointerCapture(e.pointerId);
			if (ptrs.size === 2) return startPinch();
			if (ptrs.size > 2) return;
			const P = props.current;
			const hit = pick(e.clientX, e.clientY);
			down = {
				x: e.clientX,
				y: e.clientY,
				at: performance.now(),
				hit: hit.table ?? null,
			};
			if (hit.table) {
				const t = P.draft.tables.find((x) => x.id === hit.table);
				if (!t) return;
				P.onSelect(t.id);
				const g = onFloor(e.clientX, e.clientY);
				drag = {
					kind: "table",
					id: t.id,
					before: P.draft,
					dx: g.x - t.x,
					dy: g.y - t.y,
					moved: false,
				};
			} else if (hit.wall !== undefined) {
				const g = onFloor(e.clientX, e.clientY);
				drag = {
					kind: "wall",
					i: hit.wall,
					before: P.draft,
					start: roomOf(P.draft.areas.find((a) => a.id === P.areaId)),
					from: { x: Math.round(g.x), y: Math.round(g.y) },
				};
			} else {
				drag = { kind: "orbit", theta: orbit.theta, phi: orbit.phi };
			}
		};

		const onMove = (e: PointerEvent) => {
			if (!ptrs.has(e.pointerId)) return;
			ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
			const P = props.current;
			const d = drag;
			if (!d) return;
			if (d.kind === "pinch") {
				const [a, b] = [...ptrs.values()];
				if (!a || !b) return;
				const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
				orbit.radius = Math.max(12, Math.min(120, (d.radius * d.d) / dist));
				// Two fingers moving together slide the room under them.
				const mx = (a.x + b.x) / 2 - d.mid.x;
				const my = (a.y + b.y) / 2 - d.mid.y;
				const k = orbit.radius / 600;
				const right = new THREE.Vector3(
					Math.cos(orbit.theta),
					0,
					-Math.sin(orbit.theta),
				);
				const fwd = new THREE.Vector3(
					Math.sin(orbit.theta),
					0,
					Math.cos(orbit.theta),
				);
				orbit.target = d.target
					.clone()
					.addScaledVector(right, -mx * k)
					.addScaledVector(fwd, -my * k);
				return kick();
			}
			if (d.kind === "orbit") {
				orbit.theta = d.theta - (e.clientX - down.x) * 0.008;
				orbit.phi = Math.max(
					0.15,
					Math.min(1.4, d.phi - (e.clientY - down.y) * 0.006),
				);
				return kick();
			}
			const g = onFloor(e.clientX, e.clientY);
			if (d.kind === "wall") {
				const o = moveWall(
					d.start,
					d.i,
					Math.round(g.x) - d.from.x,
					Math.round(g.y) - d.from.y,
				);
				P.onLive({
					...P.draft,
					areas: P.draft.areas.map((a) =>
						a.id === P.areaId ? { ...a, outline: o } : a,
					),
				});
				return;
			}
			const t = P.draft.tables.find((x) => x.id === d.id);
			if (!t) return;
			const x = Math.max(0, Math.min(GRID.cols - t.w, Math.round(g.x - d.dx)));
			const y = Math.max(0, Math.min(GRID.rows - t.h, Math.round(g.y - d.dy)));
			if (x === t.x && y === t.y) return;
			d.moved = true;
			const m = magnet(P.draft, t, x, y);
			P.onLive({
				...P.draft,
				tables: P.draft.tables.map((o) =>
					o.id === t.id ? { ...o, x: m.x, y: m.y } : o,
				),
			});
		};

		const onUp = (e: PointerEvent) => {
			ptrs.delete(e.pointerId);
			const d = drag;
			if (!d) return;
			if (d.kind === "pinch") {
				if (ptrs.size === 0) drag = null;
				return;
			}
			drag = null;
			const P = props.current;
			if (d.kind === "table") {
				if (d.moved) P.onDone(d.before, "table");
				return;
			}
			if (d.kind === "wall") return P.onDone(d.before, "room");
			const still = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
			if (!still) return;
			const now = performance.now();
			if (now - lastTap < 320) {
				orbit = home(camera.aspect);
				kick();
			}
			lastTap = now;
			P.onSelect(null);
		};

		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			orbit.radius = Math.max(
				12,
				Math.min(120, orbit.radius * (e.deltaY > 0 ? 1.1 : 1 / 1.1)),
			);
			kick();
		};

		cvs.addEventListener("pointerdown", onDown);
		cvs.addEventListener("pointermove", onMove);
		cvs.addEventListener("pointerup", onUp);
		cvs.addEventListener("pointercancel", onUp);
		cvs.addEventListener("wheel", onWheel, { passive: false });

		world.current = {
			draw,
			zoom: (f) => {
				orbit.radius = Math.max(12, Math.min(120, orbit.radius * f));
				kick();
			},
			reset: () => {
				orbit = home(camera.aspect);
				kick();
			},
		};
		draw();

		return () => {
			world.current = null;
			cancelAnimationFrame(frame);
			ro.disconnect();
			cvs.removeEventListener("wheel", onWheel);
			dispose(scene);
			renderer.dispose();
			cvs.remove();
		};
	}, []);

	// Redraw when the plan or the selection changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: these props are what the scene shows
	useEffect(() => {
		world.current?.draw();
	}, [p.draft, p.areaId, p.selected, p.bad]);

	const sel = p.draft.tables.find(
		(t) => t.id === p.selected && t.areaId === p.areaId,
	);

	return (
		<div className="floor-board floor-board--3d" ref={wrap} dir="ltr">
			{broken && <p className="floor-board__broken muted">{p.failed}</p>}
			{sel && (
				<div className="floor-pop" data-dock>
					{p.popover(sel)}
				</div>
			)}
			<div className="floor-zoom">
				<button
					type="button"
					onClick={() => world.current?.zoom(0.8)}
					aria-label={p.labels.zoomIn}
				>
					+
				</button>
				<button
					type="button"
					onClick={() => world.current?.zoom(1.25)}
					aria-label={p.labels.zoomOut}
				>
					−
				</button>
				<button
					type="button"
					onClick={() => world.current?.reset()}
					aria-label={p.reset}
				>
					⟲
				</button>
			</div>
		</div>
	);
}
