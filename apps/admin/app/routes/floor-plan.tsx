import type { TableShape } from "@bite/contracts";
import { Icon, Logo, useToast } from "@bite/ui";
import {
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { data } from "react-router";
import { QrCode } from "../components/QrCode";
import { AdminApiError, adminApi, isDemo } from "../lib/api";
import {
	clampBox,
	collides,
	type Draft,
	type DraftTable,
	GRID,
	newTable,
	problems,
	SHAPES,
	starterFloor,
	toDraft,
	toRequest,
	totalSeats,
} from "../lib/floor";
import { guestMenuUrl } from "../lib/links";
import { loadPlaces } from "../lib/places";
import { useShell } from "../lib/use-shell";
import { uuidv7 } from "../lib/uuid";
import type { Route } from "./+types/floor-plan";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
	const api = adminApi();
	const [places, floor] = await Promise.all([
		loadPlaces(api),
		api.floor(params.locationId),
	]);
	const location = places.find((l) => l.id === params.locationId);
	if (!location) throw data(null, { status: 404 });
	return { location, floor };
}

type Drag = {
	id: string;
	mode: "move" | "resize";
	startX: number;
	startY: number;
	box: { x: number; y: number; w: number; h: number };
	cell: { w: number; h: number };
	moved: boolean;
};

const SHAPE_ORDER: TableShape[] = ["round", "square", "rect"];

export default function FloorPlan({ loaderData }: Route.ComponentProps) {
	const { location, floor } = loaderData;
	const { t } = useShell();
	const toast = useToast();
	const [saved, setSaved] = useState(() => JSON.stringify(toDraft(floor)));
	const [draft, setDraft] = useState<Draft>(() => toDraft(floor));
	const [areaId, setAreaId] = useState(draft.areas[0]?.id ?? "");
	const [selected, setSelected] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [printOnly, setPrintOnly] = useState<string | null>(null);
	const drag = useRef<Drag | null>(null);
	const canvas = useRef<HTMLDivElement>(null);

	const dirty = JSON.stringify(draft) !== saved;
	const bad = useMemo(() => problems(draft), [draft]);
	const area = draft.areas.find((a) => a.id === areaId) ?? draft.areas[0];
	const here = draft.tables.filter((x) => x.areaId === area?.id);
	const sel = draft.tables.find((x) => x.id === selected) ?? null;

	useEffect(() => {
		if (!dirty) return;
		const warn = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	const patchTable = (id: string, p: Partial<DraftTable>) =>
		setDraft((d) => ({
			...d,
			tables: d.tables.map((x) => (x.id === id ? clampBox({ ...x, ...p }) : x)),
		}));

	const addTable = (shape: TableShape) => {
		if (!area) return;
		const tb = newTable(draft, area.id, shape);
		setDraft((d) => ({ ...d, tables: [...d.tables, tb] }));
		setSelected(tb.id);
	};

	const removeTable = (id: string) => {
		setDraft((d) => ({ ...d, tables: d.tables.filter((x) => x.id !== id) }));
		setSelected(null);
	};

	const duplicate = (src: DraftTable) => {
		const tb = newTable(draft, src.areaId, src.shape);
		const copy = { ...tb, seats: src.seats, w: src.w, h: src.h };
		setDraft((d) => ({ ...d, tables: [...d.tables, copy] }));
		setSelected(copy.id);
	};

	const addArea = () => {
		const a = {
			id: uuidv7(),
			name: t("floor_new_area", { n: draft.areas.length + 1 }),
			sortOrder: draft.areas.length,
		};
		setDraft((d) => ({ ...d, areas: [...d.areas, a] }));
		setAreaId(a.id);
		setSelected(null);
	};

	const removeArea = (id: string) => {
		const n = draft.tables.filter((x) => x.areaId === id).length;
		if (n > 0 && !window.confirm(t("floor_delete_area_confirm", { count: n })))
			return;
		setDraft((d) => ({
			areas: d.areas.filter((a) => a.id !== id),
			tables: d.tables.filter((x) => x.areaId !== id),
		}));
		setAreaId(draft.areas.find((a) => a.id !== id)?.id ?? "");
		setSelected(null);
	};

	const moveArea = (id: string, by: -1 | 1) =>
		setDraft((d) => {
			const i = d.areas.findIndex((a) => a.id === id);
			const j = i + by;
			if (i < 0 || j < 0 || j >= d.areas.length) return d;
			const areas = [...d.areas];
			[areas[i], areas[j]] = [areas[j] as never, areas[i] as never];
			return { ...d, areas };
		});

	const save = async () => {
		if (bad.size > 0) {
			toast(t("floor_fix_labels"), "danger");
			return;
		}
		setSaving(true);
		try {
			const f = await adminApi().saveFloor(location.id, toRequest(draft));
			const d = toDraft(f);
			setDraft(d);
			setSaved(JSON.stringify(d));
			toast(t("floor_saved"), "success");
		} catch (err) {
			toast(
				err instanceof AdminApiError && err.status === 409
					? t("floor_conflict")
					: t("floor_save_failed"),
				"danger",
			);
		} finally {
			setSaving(false);
		}
	};

	const onPointerDown = (
		e: PointerEvent<HTMLElement>,
		tb: DraftTable,
		mode: Drag["mode"],
	) => {
		const rect = canvas.current?.getBoundingClientRect();
		if (!rect) return;
		e.stopPropagation();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		setSelected(tb.id);
		drag.current = {
			id: tb.id,
			mode,
			startX: e.clientX,
			startY: e.clientY,
			box: { x: tb.x, y: tb.y, w: tb.w, h: tb.h },
			cell: { w: rect.width / GRID.cols, h: rect.height / GRID.rows },
			moved: false,
		};
	};
	const onPointerMove = (e: PointerEvent<HTMLElement>) => {
		const d = drag.current;
		if (!d) return;
		const dx = Math.round((e.clientX - d.startX) / d.cell.w);
		const dy = Math.round((e.clientY - d.startY) / d.cell.h);
		if (dx === 0 && dy === 0 && !d.moved) return;
		d.moved = true;
		patchTable(
			d.id,
			d.mode === "move"
				? { x: d.box.x + dx, y: d.box.y + dy }
				: { w: d.box.w + dx, h: d.box.h + dy },
		);
	};
	const onPointerUp = () => {
		drag.current = null;
	};

	const onTableKey = (e: KeyboardEvent<HTMLElement>, tb: DraftTable) => {
		const step: Record<string, [number, number]> = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1],
		};
		const s = step[e.key];
		if (s) {
			e.preventDefault();
			if (e.shiftKey) patchTable(tb.id, { w: tb.w + s[0], h: tb.h + s[1] });
			else patchTable(tb.id, { x: tb.x + s[0], y: tb.y + s[1] });
		} else if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			removeTable(tb.id);
		}
	};

	const menuUrl =
		guestMenuUrl(location.slug) ??
		(isDemo() ? `https://menu.example/${location.slug}` : null);
	const print = (label: string | null) => {
		setPrintOnly(label);
		// Let the cards render before the print dialog takes a snapshot.
		setTimeout(() => window.print(), 50);
	};
	const cards = draft.tables
		.filter((x) => printOnly === null || x.label === printOnly)
		.sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));

	if (draft.areas.length === 0) {
		return (
			<>
				<div className="page-head">
					<h1>{t("floor_title", { location: location.name })}</h1>
				</div>
				<section className="card floor-empty">
					<Icon name="layout" size={32} />
					<h2>{t("floor_empty_title")}</h2>
					<p className="muted">{t("floor_empty_hint")}</p>
					<button
						type="button"
						className="btn btn--primary"
						onClick={() => {
							const d = starterFloor(t("floor_default_area"));
							setDraft(d);
							setAreaId(d.areas[0]?.id ?? "");
						}}
					>
						{t("floor_start")}
					</button>
				</section>
			</>
		);
	}

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("floor_title", { location: location.name })}</h1>
					<p className="muted small floor-summary">
						{t("floor_summary", {
							tables: draft.tables.length,
							seats: totalSeats(draft),
							areas: draft.areas.length,
						})}
					</p>
				</div>
				<div className="actions-row">
					<button
						type="button"
						className="btn"
						disabled={!menuUrl || draft.tables.length === 0}
						onClick={() => print(null)}
						title={menuUrl ? undefined : t("guest_qr_unset")}
					>
						<Icon name="qr" size={16} /> {t("floor_print_all")}
					</button>
					<button
						type="button"
						className="btn btn--primary"
						disabled={!dirty || saving}
						onClick={save}
					>
						{saving ? t("saving") : dirty ? t("floor_save") : t("floor_saved")}
					</button>
				</div>
			</div>

			<div className="floor-editor">
				<section className="card floor-main">
					<div className="floor-areas" role="tablist">
						{draft.areas.map((a) => (
							<button
								key={a.id}
								type="button"
								role="tab"
								aria-selected={a.id === area?.id}
								className={`chip ${a.id === area?.id ? "chip--on" : ""}`}
								onClick={() => {
									setAreaId(a.id);
									setSelected(null);
								}}
							>
								{a.name}
								<span className="floor-areas__n">
									{draft.tables.filter((x) => x.areaId === a.id).length}
								</span>
							</button>
						))}
						<button type="button" className="chip" onClick={addArea}>
							<Icon name="plus" size={14} /> {t("floor_add_area")}
						</button>
					</div>
					<div className="floor-tools">
						<span className="muted small">{t("floor_add_table")}</span>
						{SHAPE_ORDER.map((s) => (
							<button
								key={s}
								type="button"
								className="btn floor-tools__btn"
								onClick={() => addTable(s)}
							>
								<span className={`floor-glyph floor-glyph--${s}`} />
								{t(`floor_shape_${s}`)}
								<span className="muted small">
									{t("floor_seats_n", { count: SHAPES[s].seats })}
								</span>
							</button>
						))}
					</div>
					{/* The floor is a physical room: left is left in Arabic too. */}
					<div className="floor-scroll">
						<div
							ref={canvas}
							className="floor-canvas"
							dir="ltr"
							style={{ aspectRatio: `${GRID.cols} / ${GRID.rows}` }}
							onPointerDown={() => setSelected(null)}
						>
							{here.map((tb) => (
								<button
									key={tb.id}
									type="button"
									aria-pressed={tb.id === selected}
									aria-label={t("floor_table_aria", {
										label: tb.label,
										seats: tb.seats,
									})}
									className="floor-table"
									data-shape={tb.shape}
									data-selected={tb.id === selected || undefined}
									data-bad={bad.has(tb.id) || collides(draft, tb) || undefined}
									style={{
										left: `${(tb.x / GRID.cols) * 100}%`,
										top: `${(tb.y / GRID.rows) * 100}%`,
										width: `${(tb.w / GRID.cols) * 100}%`,
										height: `${(tb.h / GRID.rows) * 100}%`,
									}}
									onPointerDown={(e) => onPointerDown(e, tb, "move")}
									onPointerMove={onPointerMove}
									onPointerUp={onPointerUp}
									onPointerCancel={onPointerUp}
									onKeyDown={(e) => onTableKey(e, tb)}
									onFocus={() => setSelected(tb.id)}
								>
									<Chairs seats={tb.seats} shape={tb.shape} />
									<strong className="floor-table__label">
										{tb.label || "?"}
									</strong>
									<span className="floor-table__seats">
										<Icon name="user" size={11} />
										{tb.seats}
									</span>
									{tb.id === selected && (
										<span
											className="floor-table__resize"
											aria-hidden="true"
											onPointerDown={(e) => onPointerDown(e, tb, "resize")}
											onPointerMove={onPointerMove}
											onPointerUp={onPointerUp}
										/>
									)}
								</button>
							))}
							{here.length === 0 && (
								<p className="floor-canvas__empty muted">
									{t("floor_area_empty")}
								</p>
							)}
						</div>
					</div>
					<p className="muted small">{t("floor_drag_hint")}</p>
				</section>

				<aside className="card floor-side">
					{sel ? (
						<TablePanel
							key={sel.id}
							table={sel}
							areas={draft.areas}
							problem={bad.get(sel.id)}
							canPrint={!!menuUrl}
							onChange={(p) => patchTable(sel.id, p)}
							onDuplicate={() => duplicate(sel)}
							onDelete={() => removeTable(sel.id)}
							onPrint={() => print(sel.label)}
							onDone={() => setSelected(null)}
						/>
					) : area ? (
						<div className="form">
							<h2>{t("floor_area")}</h2>
							<label className="fieldset">
								<span>{t("floor_area_name")}</span>
								<input
									className="input"
									value={area.name}
									maxLength={40}
									onChange={(e) =>
										setDraft((d) => ({
											...d,
											areas: d.areas.map((a) =>
												a.id === area.id ? { ...a, name: e.target.value } : a,
											),
										}))
									}
								/>
							</label>
							<p className="muted small">
								{t("floor_area_stats", {
									tables: here.length,
									seats: totalSeats(draft, area.id),
								})}
							</p>
							<div className="actions-row">
								<button
									type="button"
									className="btn"
									onClick={() => moveArea(area.id, -1)}
									disabled={draft.areas[0]?.id === area.id}
								>
									{t("floor_area_earlier")}
								</button>
								<button
									type="button"
									className="btn"
									onClick={() => moveArea(area.id, 1)}
									disabled={draft.areas.at(-1)?.id === area.id}
								>
									{t("floor_area_later")}
								</button>
							</div>
							<button
								type="button"
								className="btn btn--danger"
								onClick={() => removeArea(area.id)}
							>
								<Icon name="trash" size={16} /> {t("floor_delete_area")}
							</button>
							<hr />
							<p className="muted small">{t("floor_side_hint")}</p>
						</div>
					) : null}
				</aside>
			</div>

			{/* Only these print (see @media print): one card per table, both languages. */}
			{menuUrl && (
				<section className="card card--print floor-print">
					{cards.map((x) => {
						const url = `${menuUrl}?table=${encodeURIComponent(x.label)}`;
						return (
							<div className="table-card" aria-hidden="true" key={x.id}>
								<strong className="table-card__name">{location.name}</strong>
								<strong className="table-card__table">
									Table {x.label} ·{" "}
									<span lang="ar" dir="rtl">
										طاولة {x.label}
									</span>
								</strong>
								<span className="table-card__cta">Scan to order</span>
								<span className="table-card__cta" lang="ar" dir="rtl">
									امسح الرمز للطلب
								</span>
								<QrCode
									value={url}
									size={260}
									label=""
									className="table-card__qr"
								/>
								<span className="table-card__url" dir="ltr">
									{url.replace(/^https?:\/\//, "")}
								</span>
								<Logo height={18} />
							</div>
						);
					})}
				</section>
			)}
		</>
	);
}

/** Little chairs around the table, so the plan reads like a room. */
function Chairs({ seats, shape }: { seats: number; shape: TableShape }) {
	const n = Math.min(seats, 12);
	if (shape === "round") {
		return (
			<span className="floor-chairs" aria-hidden="true">
				{Array.from({ length: n }, (_, i) => {
					const a = (i / n) * 2 * Math.PI - Math.PI / 2;
					return (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration
							key={i}
							className="floor-chair"
							style={{
								left: `${50 + 56 * Math.cos(a)}%`,
								top: `${50 + 56 * Math.sin(a)}%`,
							}}
						/>
					);
				})}
			</span>
		);
	}
	// Square and long tables: chairs along the long sides, ends when odd.
	const top = Math.ceil(n / 2);
	const bottom = n - top;
	const side = (count: number, y: string) =>
		Array.from({ length: count }, (_, i) => (
			<span
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration
				key={`${y}${i}`}
				className="floor-chair"
				style={{ left: `${((i + 1) / (count + 1)) * 100}%`, top: y }}
			/>
		));
	return (
		<span className="floor-chairs" aria-hidden="true">
			{side(top, "-9%")}
			{side(bottom, "109%")}
		</span>
	);
}

function TablePanel({
	table,
	areas,
	problem,
	canPrint,
	onChange,
	onDuplicate,
	onDelete,
	onPrint,
	onDone,
}: {
	table: DraftTable;
	areas: Draft["areas"];
	problem: "label_empty" | "label_dup" | undefined;
	canPrint: boolean;
	onChange: (p: Partial<DraftTable>) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onPrint: () => void;
	onDone: () => void;
}) {
	const { t } = useShell();
	return (
		<div className="form">
			<div className="card-head">
				<h2>{t("floor_table_n", { label: table.label || "?" })}</h2>
				<button
					type="button"
					className="icon-btn"
					onClick={onDone}
					aria-label={t("floor_close")}
				>
					<Icon name="close" size={16} />
				</button>
			</div>
			<label className="fieldset">
				<span>{t("floor_table_label")}</span>
				<input
					className={`input input--short ${problem ? "input--bad" : ""}`}
					value={table.label}
					maxLength={20}
					onChange={(e) => onChange({ label: e.target.value })}
					aria-invalid={!!problem}
				/>
				{problem && (
					<span className="error small">{t(`floor_${problem}`)}</span>
				)}
				<span className="muted small">{t("floor_label_hint")}</span>
			</label>
			<div className="fieldset">
				<span>{t("floor_seats")}</span>
				<div className="floor-stepper">
					<button
						type="button"
						className="icon-btn"
						aria-label={t("floor_fewer_seats")}
						disabled={table.seats <= 1}
						onClick={() => onChange({ seats: table.seats - 1 })}
					>
						<Icon name="minus" size={16} />
					</button>
					<strong>{table.seats}</strong>
					<button
						type="button"
						className="icon-btn"
						aria-label={t("floor_more_seats")}
						disabled={table.seats >= 40}
						onClick={() => onChange({ seats: table.seats + 1 })}
					>
						<Icon name="plus" size={16} />
					</button>
				</div>
			</div>
			<div className="fieldset">
				<span>{t("floor_shape")}</span>
				<div className="choice-chips">
					{SHAPE_ORDER.map((s) => (
						<button
							key={s}
							type="button"
							className={`chip ${table.shape === s ? "chip--on" : ""}`}
							aria-pressed={table.shape === s}
							onClick={() =>
								onChange({
									shape: s,
									...(s === "round" && { h: table.w }),
								})
							}
						>
							<span className={`floor-glyph floor-glyph--${s}`} />
							{t(`floor_shape_${s}`)}
						</button>
					))}
				</div>
			</div>
			{areas.length > 1 && (
				<label className="fieldset">
					<span>{t("floor_area")}</span>
					<select
						className="input"
						value={table.areaId}
						onChange={(e) => onChange({ areaId: e.target.value })}
					>
						{areas.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</select>
				</label>
			)}
			<div className="actions-row">
				<button type="button" className="btn" onClick={onDuplicate}>
					<Icon name="copy" size={16} /> {t("floor_duplicate")}
				</button>
				<button
					type="button"
					className="btn"
					onClick={onPrint}
					disabled={!canPrint || !table.label.trim()}
				>
					<Icon name="qr" size={16} /> {t("floor_print_one")}
				</button>
			</div>
			<button type="button" className="btn btn--danger" onClick={onDelete}>
				<Icon name="trash" size={16} /> {t("floor_delete_table")}
			</button>
		</div>
	);
}
