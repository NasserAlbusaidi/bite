import type { TableShape } from "@bite/contracts";
import { Dialog, Icon, Logo, useToast } from "@bite/ui";
import {
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { data } from "react-router";
import { type BoardProps, FloorBoard } from "../components/FloorBoard";
import { QrCode } from "../components/QrCode";
import { AdminApiError, adminApi, isDemo } from "../lib/api";
import {
	type Draft,
	type DraftTable,
	fitsAt,
	layOut,
	misplaced,
	newTable,
	problems,
	ROOM_SHAPES,
	type RoomShape,
	reshape,
	SEAT_CHOICES,
	settle,
	settleArea,
	toDraft,
	toRequest,
	totalSeats,
} from "../lib/floor";
import { guestMenuUrl } from "../lib/links";
import { loadPlaces } from "../lib/places";
import { useShell } from "../lib/use-shell";
import { uuidv7 } from "../lib/uuid";
import type { Route } from "./+types/floor-plan";

// three.js is big: only load it when someone opens the 3D view.
const Floor3D = lazy(() => import("../components/Floor3D"));

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

const SHAPES: TableShape[] = ["round", "square", "rect"];
const ROOMS = Object.keys(ROOM_SHAPES) as RoomShape[];
const HISTORY = 60;

/** The room-shape dialog: a fresh area also asks how many tables. */
type Setup = { areaId: string; fresh: boolean };

export default function FloorPlan({ loaderData }: Route.ComponentProps) {
	const { location, floor } = loaderData;
	const { t } = useShell();
	const toast = useToast();
	const [saved, setSaved] = useState(() => JSON.stringify(toDraft(floor)));
	const [draft, setDraft] = useState<Draft>(() => toDraft(floor));
	const [past, setPast] = useState<Draft[]>([]);
	const [, setFuture] = useState<Draft[]>([]);
	const [areaId, setAreaId] = useState(draft.areas[0]?.id ?? "");
	const [selected, setSelected] = useState<string | null>(null);
	const [three, setThree] = useState(false);
	const [setup, setSetup] = useState<Setup | null>(null);
	const [areaEdit, setAreaEdit] = useState(false);
	const [seatMenu, setSeatMenu] = useState(false);
	const [undoNote, setUndoNote] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [printOnly, setPrintOnly] = useState<string | null>(null);
	const [printMenu, setPrintMenu] = useState(false);
	const live = useRef(draft);
	live.current = draft;
	/** The plan before a table number was typed, for one undo step. */
	const labelFrom = useRef<Draft | null>(null);

	const dirty = JSON.stringify(draft) !== saved;
	const bad = useMemo(() => problems(draft), [draft]);
	const area = draft.areas.find((a) => a.id === areaId) ?? draft.areas[0];
	const here = draft.tables.filter((x) => x.areaId === area?.id);
	const wrong = draft.tables.filter((x) => misplaced(draft, x)).length;

	useEffect(() => {
		if (!dirty) return;
		const warn = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	// The print menu closes on a tap anywhere else, or Escape.
	useEffect(() => {
		if (!printMenu) return;
		const away = (e: Event) => {
			if (e instanceof KeyboardEvent && e.key !== "Escape") return;
			if (
				e instanceof PointerEvent &&
				(e.target as Element | null)?.closest(".floor-print-pick")
			)
				return;
			setPrintMenu(false);
		};
		window.addEventListener("pointerdown", away);
		window.addEventListener("keydown", away);
		return () => {
			window.removeEventListener("pointerdown", away);
			window.removeEventListener("keydown", away);
		};
	}, [printMenu]);

	useEffect(() => {
		if (!undoNote) return;
		const id = setTimeout(() => setUndoNote(null), 6000);
		return () => clearTimeout(id);
	}, [undoNote]);

	/** One undo step: remember `before`, show `next`. */
	const commit = useCallback((before: Draft, next: Draft) => {
		setPast((p) => [...p.slice(-HISTORY + 1), before]);
		setFuture([]);
		setDraft(next);
	}, []);
	const change = (fn: (d: Draft) => Draft) =>
		commit(live.current, fn(live.current));

	const undo = useCallback(() => {
		setPast((p) => {
			const prev = p.at(-1);
			if (!prev) return p;
			setFuture((f) => [live.current, ...f]);
			setDraft(prev);
			return p.slice(0, -1);
		});
		setUndoNote(null);
	}, []);
	const redo = useCallback(() => {
		setFuture((f) => {
			const next = f[0];
			if (!next) return f;
			setPast((p) => [...p, live.current]);
			setDraft(next);
			return f.slice(1);
		});
	}, []);

	useEffect(() => {
		const onKey = (e: globalThis.KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			if (el?.closest("input, textarea, select, dialog")) return;
			if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
			e.preventDefault();
			e.shiftKey ? redo() : undo();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [undo, redo]);

	const patchTable = (next: DraftTable) =>
		change((d) => ({
			...d,
			tables: d.tables.map((x) => (x.id === next.id ? next : x)),
		}));

	const addTable = (seats: number) => {
		setSeatMenu(false);
		if (!area) return;
		const d = live.current;
		const tb = newTable(d, area.id, seats);
		if (!fitsAt(d, tb, tb.x, tb.y)) {
			toast(t("floor_no_room"), "warning");
			return;
		}
		commit(d, { ...d, tables: [...d.tables, tb] });
		setSelected(tb.id);
	};

	const removeTable = (id: string) => {
		const tb = live.current.tables.find((x) => x.id === id);
		change((d) => ({ ...d, tables: d.tables.filter((x) => x.id !== id) }));
		setSelected(null);
		setUndoNote(t("floor_deleted", { label: tb?.label || "?" }));
	};

	const onDone: BoardProps["onDone"] = (before, kind) => {
		const d = live.current;
		if (kind === "room" && area) {
			const { draft: next, stuck } = settleArea(d, area.id);
			commit(before, next);
			if (stuck > 0) toast(t("floor_stuck", { count: stuck }), "warning");
			return;
		}
		// A table dropped on a neighbour or a wall slides to the nearest free spot.
		commit(before, {
			...d,
			tables: d.tables.map((x) => (x.id === selected ? settle(d, x) : x)),
		});
	};

	const addArea = () => {
		const a = {
			id: uuidv7(),
			name:
				draft.areas.length === 0
					? t("floor_default_area")
					: t("floor_new_area", { n: draft.areas.length + 1 }),
			sortOrder: draft.areas.length,
			outline: ROOM_SHAPES.box.map((p) => ({ ...p })),
		};
		change((d) => ({ ...d, areas: [...d.areas, a] }));
		setAreaId(a.id);
		setSelected(null);
		setSetup({ areaId: a.id, fresh: true });
	};

	const removeArea = (id: string) => {
		const n = draft.tables.filter((x) => x.areaId === id).length;
		if (n > 0 && !window.confirm(t("floor_delete_area_confirm", { count: n })))
			return;
		change((d) => ({
			areas: d.areas.filter((a) => a.id !== id),
			tables: d.tables.filter((x) => x.areaId !== id),
		}));
		setAreaId(draft.areas.find((a) => a.id !== id)?.id ?? "");
		setSelected(null);
		setAreaEdit(false);
	};

	/** The setup dialog's answer: a room shape, and tables for a fresh area. */
	const applySetup = (shape: RoomShape, count: number | null) => {
		if (!setup) return;
		const d = live.current;
		const outline = ROOM_SHAPES[shape].map((p) => ({ ...p }));
		const walled: Draft = {
			...d,
			areas: d.areas.map((a) =>
				a.id === setup.areaId ? { ...a, outline } : a,
			),
		};
		if (count !== null) {
			const r = layOut(walled, setup.areaId, count);
			commit(d, r.draft);
			if (r.placed < count)
				toast(t("floor_fit_some", { placed: r.placed, count }), "warning");
		} else {
			const r = settleArea(walled, setup.areaId);
			commit(d, r.draft);
			if (r.stuck > 0) toast(t("floor_stuck", { count: r.stuck }), "warning");
		}
		setSelected(null);
		setSetup(null);
	};

	const save = async () => {
		if (bad.size > 0) return toast(t("floor_fix_labels"), "danger");
		if (wrong > 0) return toast(t("floor_fix_spots"), "danger");
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

	const menuUrl =
		guestMenuUrl(location.slug) ??
		(isDemo() ? `https://menu.example/${location.slug}` : null);
	const print = (label: string | null) => {
		setPrintOnly(label);
		// Let the cards render before the print dialog takes a snapshot.
		setTimeout(() => window.print(), 50);
	};
	const sortedTables = [...draft.tables].sort((a, b) =>
		a.label.localeCompare(b.label, "en", { numeric: true }),
	);
	const cards = sortedTables.filter(
		(x) => printOnly === null || x.label === printOnly,
	);

	const setupDialog = setup && (
		<SetupDialog
			fresh={setup.fresh}
			onClose={() => setSetup(null)}
			onDone={applySetup}
		/>
	);

	if (draft.areas.length === 0 || !area) {
		return (
			<>
				<div className="page-head">
					<h1>{t("floor_title", { location: location.name })}</h1>
				</div>
				<section className="card floor-empty">
					<Icon name="layout" size={32} />
					<h2>{t("floor_empty_title")}</h2>
					<p className="muted">{t("floor_empty_hint")}</p>
					<button type="button" className="btn btn--primary" onClick={addArea}>
						{t("floor_start")}
					</button>
				</section>
				{setupDialog}
			</>
		);
	}

	const board: BoardProps = {
		draft,
		areaId: area.id,
		selected,
		bad,
		onSelect: setSelected,
		onLive: setDraft,
		onDone,
		onDelete: removeTable,
		tableLabel: (x) =>
			t("floor_table_aria", { label: x.label || "?", seats: x.seats }),
		labels: {
			zoomIn: t("floor_zoom_in"),
			zoomOut: t("floor_zoom_out"),
			fit: t("floor_fit"),
			size: t("floor_size"),
		},
		popover: (x) => (
			<TableEdit
				key={x.id}
				table={x}
				problem={bad.get(x.id)}
				canPrint={!!menuUrl}
				onLabel={(label) =>
					setDraft((d) => ({
						...d,
						tables: d.tables.map((o) => (o.id === x.id ? { ...o, label } : o)),
					}))
				}
				onLabelStart={() => {
					labelFrom.current = live.current;
				}}
				onLabelDone={() => {
					const from = labelFrom.current;
					labelFrom.current = null;
					if (from && from !== live.current) commit(from, live.current);
				}}
				onShape={(shape, seats) => patchTable(reshape(draft, x, shape, seats))}
				onPrint={() => print(x.label)}
				onDelete={() => removeTable(x.id)}
				onClose={() => setSelected(null)}
			/>
		),
	};

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("floor_title", { location: location.name })}</h1>
					<p className="muted small floor-summary">
						{t("floor_summary", {
							tables: draft.tables.length,
							seats: totalSeats(draft),
						})}
					</p>
				</div>
				<div className="floor-print-pick">
					<button
						type="button"
						className="btn"
						disabled={!menuUrl || draft.tables.length === 0}
						aria-expanded={printMenu}
						onClick={() => setPrintMenu((v) => !v)}
						title={menuUrl ? undefined : t("guest_qr_unset")}
					>
						<Icon name="qr" size={16} /> {t("floor_print_all")}
					</button>
					{printMenu && (
						<div className="floor-print-menu" role="menu">
							<button
								type="button"
								role="menuitem"
								className="floor-print-menu__all"
								onClick={() => {
									setPrintMenu(false);
									print(null);
								}}
							>
								<Icon name="qr" size={16} />
								{t("floor_print_every", { count: draft.tables.length })}
							</button>
							{draft.areas.map((a) => {
								const list = sortedTables.filter((x) => x.areaId === a.id);
								if (list.length === 0) return null;
								return (
									<div key={a.id} className="floor-print-menu__group">
										{draft.areas.length > 1 && (
											<span className="small muted">{a.name}</span>
										)}
										<div className="floor-print-menu__list">
											{list.map((x) => (
												<button
													key={x.id}
													type="button"
													role="menuitem"
													className="chip"
													disabled={!x.label.trim()}
													onClick={() => {
														setPrintMenu(false);
														print(x.label);
													}}
												>
													{x.label || "?"}
												</button>
											))}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>

			<section className="card floor-main">
				<div className="floor-areas" role="tablist">
					{draft.areas.map((a) => (
						<button
							key={a.id}
							type="button"
							role="tab"
							aria-selected={a.id === area.id}
							className={`chip ${a.id === area.id ? "chip--on" : ""}`}
							onClick={() => {
								// Tapping the open area again edits it.
								if (a.id === area.id) setAreaEdit(true);
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

				{three ? (
					<Suspense
						fallback={<div className="floor-board floor-board--wait" />}
					>
						<Floor3D
							{...board}
							failed={t("floor_3d_failed")}
							reset={t("floor_reset_view")}
						/>
					</Suspense>
				) : (
					<FloorBoard {...board} />
				)}
				<p className="muted small floor-hint">
					{three ? t("floor_hint_3d") : t("floor_hint_2d")}
				</p>

				<div className="floor-bar">
					<div className="floor-bar__add">
						<button
							type="button"
							className="btn btn--primary"
							aria-expanded={seatMenu}
							onClick={() => setSeatMenu((v) => !v)}
						>
							<Icon name="plus" size={16} /> {t("floor_table")}
						</button>
						{seatMenu && (
							<div className="floor-seat-menu" role="menu">
								<span className="small muted">{t("floor_add_seats")}</span>
								<div className="choice-chips">
									{SEAT_CHOICES.map((n) => (
										<button
											key={n}
											type="button"
											role="menuitem"
											className="chip"
											onClick={() => addTable(n)}
										>
											{n}
										</button>
									))}
								</div>
							</div>
						)}
					</div>
					<button
						type="button"
						className="btn"
						onClick={() => setSetup({ areaId: area.id, fresh: false })}
					>
						<Icon name="layout" size={16} /> {t("floor_change_room")}
					</button>
					<button
						type="button"
						className="btn"
						onClick={() => {
							setThree((v) => !v);
							setSelected(null);
						}}
					>
						<span className="floor-bar__long">
							{three ? t("floor_view_plan") : t("floor_view_3d")}
						</span>
						<span className="floor-bar__short">{three ? "2D" : "3D"}</span>
					</button>
					<span className="floor-bar__gap" />
					{undoNote ? (
						<span className="floor-bar__note">
							{undoNote}
							<button
								type="button"
								className="btn floor-bar__undo"
								onClick={undo}
							>
								{t("floor_undo")}
							</button>
						</span>
					) : (
						<button
							type="button"
							className="btn"
							disabled={past.length === 0}
							onClick={undo}
							title="Ctrl+Z"
						>
							{t("floor_undo")}
						</button>
					)}
					<span className="floor-bar__stats muted small">
						{t("floor_area_stats", {
							tables: here.length,
							seats: totalSeats(draft, area.id),
						})}
					</span>
					<span
						className="floor-bar__pill"
						data-tone={
							wrong > 0 || bad.size > 0 ? "bad" : dirty ? "warn" : "ok"
						}
					>
						{wrong > 0
							? t("floor_misplaced", { count: wrong })
							: dirty
								? t("floor_unsaved")
								: t("floor_all_saved")}
					</span>
					<button
						type="button"
						className="btn btn--primary"
						disabled={!dirty || saving}
						onClick={save}
					>
						{saving ? (
							t("saving")
						) : (
							<>
								<span className="floor-bar__long">{t("floor_save")}</span>
								<span className="floor-bar__short">{t("save")}</span>
							</>
						)}
					</button>
				</div>
			</section>

			{setupDialog}
			<Dialog
				open={areaEdit}
				onClose={() => setAreaEdit(false)}
				title={t("floor_area")}
				footer={
					<button
						type="button"
						className="btn btn--primary"
						onClick={() => setAreaEdit(false)}
					>
						{t("close")}
					</button>
				}
			>
				<div className="form">
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
					<button
						type="button"
						className="btn btn--danger"
						onClick={() => removeArea(area.id)}
					>
						<Icon name="trash" size={16} /> {t("floor_delete_area")}
					</button>
				</div>
			</Dialog>

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

/** Pick a room shape; a new area also picks how many tables to start with. */
function SetupDialog({
	fresh,
	onClose,
	onDone,
}: {
	fresh: boolean;
	onClose: () => void;
	onDone: (shape: RoomShape, count: number | null) => void;
}) {
	const { t } = useShell();
	const [shape, setShape] = useState<RoomShape>("l");
	const [count, setCount] = useState(8);
	return (
		<Dialog
			open
			onClose={onClose}
			title={t("floor_room_title")}
			footer={
				<button
					type="button"
					className="btn btn--primary"
					onClick={() => onDone(shape, fresh ? count : null)}
				>
					{fresh ? t("floor_make") : t("floor_keep")}
				</button>
			}
		>
			<div className="form">
				<p className="muted small">{t("floor_room_hint")}</p>
				<div className="floor-shapes">
					{ROOMS.map((s) => (
						<button
							key={s}
							type="button"
							aria-pressed={shape === s}
							className="floor-shape"
							onClick={() => setShape(s)}
						>
							<RoomGlyph shape={s} />
							<span>{t(`floor_room_${s}`)}</span>
						</button>
					))}
				</div>
				{fresh && (
					<div className="fieldset">
						<span>{t("floor_how_many")}</span>
						<div className="floor-stepper">
							<button
								type="button"
								className="icon-btn"
								aria-label={t("floor_fewer")}
								disabled={count <= 1}
								onClick={() => setCount((n) => n - 1)}
							>
								<Icon name="minus" size={16} />
							</button>
							<strong>{count}</strong>
							<button
								type="button"
								className="icon-btn"
								aria-label={t("floor_more")}
								disabled={count >= 40}
								onClick={() => setCount((n) => n + 1)}
							>
								<Icon name="plus" size={16} />
							</button>
						</div>
					</div>
				)}
			</div>
		</Dialog>
	);
}

function RoomGlyph({ shape }: { shape: RoomShape }) {
	const pts = ROOM_SHAPES[shape].map((p) => `${p.x},${p.y}`).join(" ");
	return (
		<svg viewBox="-2 -2 44 32" aria-hidden="true" className="floor-shape__art">
			<polygon points={pts} />
		</svg>
	);
}

/** The little edit box over a tapped table. */
function TableEdit({
	table,
	problem,
	canPrint,
	onLabel,
	onLabelStart,
	onLabelDone,
	onShape,
	onPrint,
	onDelete,
	onClose,
}: {
	table: DraftTable;
	problem: "label_empty" | "label_dup" | undefined;
	canPrint: boolean;
	onLabel: (label: string) => void;
	onLabelStart: () => void;
	onLabelDone: () => void;
	onShape: (shape: TableShape, seats: number) => void;
	onPrint: () => void;
	onDelete: () => void;
	onClose: () => void;
}) {
	const { t } = useShell();
	const seats: number[] = (SEAT_CHOICES as readonly number[]).includes(
		table.seats,
	)
		? [...SEAT_CHOICES]
		: [...SEAT_CHOICES, table.seats].sort((a, b) => a - b);
	const row = (label: string, kids: ReactNode) => (
		<div className="floor-pop__row">
			<span className="small muted">{label}</span>
			<div className="choice-chips">{kids}</div>
		</div>
	);
	return (
		<div className="floor-pop__box">
			<div className="floor-pop__head">
				<label className="floor-pop__name">
					<span className="small muted">{t("floor_table_label")}</span>
					<input
						className={`input input--short ${problem ? "input--bad" : ""}`}
						value={table.label}
						maxLength={20}
						onChange={(e) => onLabel(e.target.value)}
						onFocus={onLabelStart}
						onBlur={onLabelDone}
						aria-invalid={!!problem}
					/>
				</label>
				<button
					type="button"
					className="icon-btn"
					onClick={onClose}
					aria-label={t("close")}
				>
					<Icon name="close" size={16} />
				</button>
			</div>
			{problem && <span className="error small">{t(`floor_${problem}`)}</span>}
			{row(
				t("floor_shape"),
				SHAPES.map((s) => (
					<button
						key={s}
						type="button"
						className={`chip ${table.shape === s ? "chip--on" : ""}`}
						aria-pressed={table.shape === s}
						onClick={() => onShape(s, table.seats)}
					>
						{t(`floor_shape_${s}`)}
					</button>
				)),
			)}
			{row(
				t("floor_seats"),
				seats.map((n) => (
					<button
						key={n}
						type="button"
						className={`chip ${table.seats === n ? "chip--on" : ""}`}
						aria-pressed={table.seats === n}
						onClick={() => onShape(table.shape, n)}
					>
						{n}
					</button>
				)),
			)}
			<div className="floor-pop__actions">
				<button
					type="button"
					className="btn"
					onClick={onPrint}
					disabled={!canPrint || !table.label.trim()}
				>
					<Icon name="qr" size={16} /> {t("floor_print_one")}
				</button>
				<button type="button" className="btn btn--danger" onClick={onDelete}>
					<Icon name="trash" size={16} /> {t("floor_delete_table")}
				</button>
			</div>
		</div>
	);
}
