import type { Floor } from "@bite/contracts";
import { FLOOR_GRID } from "@bite/contracts";
import { isTab } from "@bite/core";
import { Money } from "@bite/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listCachedStaff, type StaffMember } from "../auth/staff.js";
import {
	assignServer,
	atTable,
	loadFloor,
	moveTable,
	needsCheck,
	type TableState,
	type TableStatus,
	tableStates,
} from "../domain/floor.js";
import { useI18n } from "../i18n/I18nProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { OMR } from "./money.js";
import { OrdersSheet } from "./OrdersSheet.js";
import { useServiceRequests } from "./ServiceCalls.js";
import { useServices } from "./services.js";

const STATUSES: TableStatus[] = [
	"free",
	"ordered",
	"cooking",
	"ready",
	"to_pay",
	"eating",
	"paid",
];

/**
 * The live floor: every table on the plan coloured by what is happening at
 * it, from this tablet's own copy of the orders (works offline). Tap a table
 * for its orders, to take a new order there, pay, move or merge it, or put a
 * server on it.
 */
export function FloorSheet(props: {
	onClose: () => void;
	/** Start a new order for this table on the till. */
	onNewOrder: (tableLabel: string) => void;
}) {
	const { db, sync, member } = useServices();
	const { t, lang } = useI18n();
	const [floor, setFloor] = useState<Floor | null | undefined>(undefined);
	const [states, setStates] = useState<TableState[]>([]);
	const [unplaced, setUnplaced] = useState(0);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [areaId, setAreaId] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [moving, setMoving] = useState(false);
	const [onlyMine, setOnlyMine] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [openOrder, setOpenOrder] = useState<string | null>(null);
	const [now, setNow] = useState(Date.now());
	const calls = useServiceRequests();
	const callsAt = (label: string) =>
		calls.requests.filter(
			(r) => r.tableLabel?.trim().toLowerCase() === label.trim().toLowerCase(),
		);

	const reload = useCallback(async () => {
		const f = await loadFloor(db);
		setFloor(f);
		if (!f) return;
		const s = await tableStates(db, f);
		setStates(s.tables);
		setUnplaced(s.unplaced.length);
		setNow(Date.now());
	}, [db]);

	useEffect(() => {
		void reload();
		void listCachedStaff(db).then((s) =>
			setStaff(s.filter((m) => m.role !== "kitchen")),
		);
		const offO = sync.onOrdersChanged(() => void reload());
		const offF = sync.onFloorChanged(() => void reload());
		const tick = setInterval(() => setNow(Date.now()), 30_000);
		return () => {
			offO();
			offF();
			clearInterval(tick);
		};
	}, [db, sync, reload]);

	const areas = useMemo(
		() => [...(floor?.areas ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
		[floor],
	);
	const area = areas.find((a) => a.id === areaId) ?? areas[0];
	const here = states.filter((s) => s.table.areaId === area?.id);
	const sel = states.find((s) => s.table.id === selected) ?? null;
	const nameOf = (id: string | null) =>
		staff.find((s) => s.memberId === id)?.displayName ?? null;
	const counts = STATUSES.map(
		(st) => [st, states.filter((s) => s.status === st).length] as const,
	);
	const busyIn = (id: string) =>
		states.filter((s) => s.table.areaId === id && s.status !== "free").length;

	async function pickTarget(target: TableState) {
		if (!sel || target.table.id === sel.table.id) return;
		const merge = target.orders.length > 0;
		const res = await moveTable(db, {
			orderIds: sel.orders.map((o) => o.order.id),
			to: target.table.label,
			memberId: member.memberId,
		});
		setMoving(false);
		if (!res.ok) return setNotice(t("floor.moveFailed"));
		sync.kick();
		setNotice(
			t(merge ? "floor.merged" : "floor.moved", {
				from: sel.table.label,
				to: target.table.label,
			}),
		);
		setSelected(target.table.id);
		await reload();
	}

	async function assign(serverId: string | null) {
		if (!sel) return;
		await assignServer(db, {
			tableId: sel.table.id,
			serverId,
			memberId: member.memberId,
		});
		sync.kick();
		await reload();
	}

	async function served(orderId: string) {
		const res = await atTable(db, {
			orderIds: [orderId],
			step: "served",
			memberId: member.memberId,
		});
		if (!res.ok) return setNotice(t("floor.moveFailed"));
		sync.kick();
		await reload();
	}

	async function clearTable() {
		if (!sel) return;
		const res = await atTable(db, {
			orderIds: sel.orders.map((o) => o.order.id),
			step: "cleared",
			memberId: member.memberId,
		});
		if (!res.ok)
			return setNotice(
				t(
					res.error === "unpaid" ? "floor.clearPayFirst" : "floor.clearCooking",
				),
			);
		sync.kick();
		setNotice(t("floor.cleared", { label: sel.table.label }));
		await reload();
	}

	// Show the part of the room that has tables, with a cell of margin, so
	// the tables fill the screen instead of a corner of the full grid.
	const box = useMemo(() => {
		if (here.length === 0)
			return { x: 0, y: 0, w: FLOOR_GRID.cols, h: FLOOR_GRID.rows };
		const x = Math.max(0, Math.min(...here.map((s) => s.table.x)) - 1);
		const y = Math.max(0, Math.min(...here.map((s) => s.table.y)) - 1);
		const r = Math.min(
			FLOOR_GRID.cols,
			Math.max(...here.map((s) => s.table.x + s.table.w)) + 1,
		);
		const b = Math.min(
			FLOOR_GRID.rows,
			Math.max(...here.map((s) => s.table.y + s.table.h)) + 1,
		);
		// Never narrower than 4:3 tall, so a single row of tables isn't a strip.
		return { x, y, w: r - x, h: Math.max(b - y, Math.ceil((r - x) / 2.2)) };
	}, [here]);
	const busy = states.filter((s) => s.status !== "free");
	const guests = busy.reduce((n, s) => n + s.table.seats, 0);

	const since = (iso: string | null) => {
		const n = iso
			? Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
			: 0;
		return n < 1 ? t("floor.justNow") : t("floor.minutes", { n });
	};

	return (
		<div className="sheet-backdrop">
			<div className="sheet full floor">
				<div className="row floor-head">
					<div>
						<h2>{t("floor.title")}</h2>
						{floor && (
							<p className="muted small">
								{t("floor.summary", {
									busy: busy.length,
									tables: states.length,
									seats: guests,
								})}
							</p>
						)}
					</div>
					<span className="spacer" />
					<label className="check">
						<input
							type="checkbox"
							checked={onlyMine}
							onChange={(e) => setOnlyMine(e.target.checked)}
						/>
						{t("floor.onlyMine")}
					</label>
					<button type="button" onClick={props.onClose}>
						{t("floor.close")}
					</button>
				</div>

				{floor === null && <p className="muted">{t("floor.none")}</p>}

				{floor && (
					<>
						<div className="row floor-bar">
							<div className="chips">
								{areas.map((a) => (
									<button
										type="button"
										key={a.id}
										className={a.id === area?.id ? "chip active" : "chip"}
										onClick={() => {
											setAreaId(a.id);
											setSelected(null);
											setMoving(false);
										}}
									>
										{a.name}
										{busyIn(a.id) > 0 && (
											<span className="floor-count">{busyIn(a.id)}</span>
										)}
									</button>
								))}
							</div>
							<span className="spacer" />
							<div className="floor-legend">
								{counts.map(([st, n]) => (
									<span
										key={st}
										className="floor-key"
										data-status={st}
										data-zero={n === 0 || undefined}
									>
										<i />
										{t(`floor.status.${st}` as MessageKey)}
										<b>{n}</b>
									</span>
								))}
							</div>
						</div>
						{notice && (
							<p className="notice" role="status">
								{notice}
							</p>
						)}
						{unplaced > 0 && (
							<p className="muted small">
								{t("floor.unplaced", { count: unplaced })}
							</p>
						)}
						{moving && sel && (
							<p className="floor-moving" role="status">
								{t("floor.pickTarget", { label: sel.table.label })}
								<button
									type="button"
									className="floor-moving__cancel"
									onClick={() => setMoving(false)}
								>
									{t("floor.cancel")}
								</button>
							</p>
						)}

						<div className="floor-body">
							<div className="floor-stage">
								<div
									className="floor-canvas"
									dir="ltr"
									style={{
										aspectRatio: `${box.w} / ${box.h}`,
										inlineSize: `min(100cqw, calc(100cqh * ${box.w} / ${box.h}))`,
									}}
								>
									{here.map((s) => {
										const mine = s.table.serverMemberId === member.memberId;
										const dim = onlyMine && !mine;
										const server = nameOf(s.table.serverMemberId);
										return (
											<button
												type="button"
												key={s.table.id}
												className="floor-table"
												data-status={s.status}
												data-shape={s.table.shape}
												data-selected={s.table.id === selected || undefined}
												data-dim={dim || undefined}
												data-target={
													(moving && s.table.id !== selected) || undefined
												}
												style={{
													left: `${((s.table.x - box.x) / box.w) * 100}%`,
													top: `${((s.table.y - box.y) / box.h) * 100}%`,
													width: `${(s.table.w / box.w) * 100}%`,
													height: `${(s.table.h / box.h) * 100}%`,
												}}
												aria-label={t("floor.tableAria", {
													label: s.table.label,
													status: t(`floor.status.${s.status}` as MessageKey),
												})}
												onClick={() =>
													moving
														? void pickTarget(s)
														: setSelected(
																s.table.id === selected ? null : s.table.id,
															)
												}
											>
												<Chairs seats={s.table.seats} shape={s.table.shape} />
												<strong className="floor-table__label">
													{s.table.label}
												</strong>
												{s.status !== "free" ? (
													<span className="floor-table__meta">
														{t(`floor.status.${s.status}` as MessageKey)}
														<span className="floor-table__time">
															{since(s.since)}
														</span>
													</span>
												) : (
													<span className="floor-table__meta floor-table__meta--free">
														{t("floor.seats", { n: s.table.seats })}
													</span>
												)}
												{s.due > 0 && (
													<span className="floor-table__due">
														<Money amount={s.due} currency={OMR} />
													</span>
												)}
												{needsCheck(s, now) && (
													<span className="floor-table__check">
														{t("floor.checkOn")}
													</span>
												)}
												{callsAt(s.table.label).length > 0 && (
													<span className="floor-table__call">
														{callsAt(s.table.label).some(
															(r) => r.kind === "bill",
														)
															? t("floor.callBill")
															: t("floor.callWaiter")}
													</span>
												)}
												{server && (
													<span className="floor-table__server">
														{server.slice(0, 1)}
													</span>
												)}
											</button>
										);
									})}
								</div>
							</div>
							<aside className="floor-panel">
								{!sel ? (
									<div className="floor-pick">
										<span className="floor-pick__icon" aria-hidden="true" />
										<p>{t("floor.pick")}</p>
									</div>
								) : (
									<>
										<div className="row">
											<h3>{t("floor.table", { label: sel.table.label })}</h3>
											<span className="spacer" />
											<span className="floor-status" data-status={sel.status}>
												{t(`floor.status.${sel.status}` as MessageKey)}
											</span>
										</div>
										<p className="muted small">
											{t("floor.seats", { n: sel.table.seats })}
											{sel.since &&
												` · ${t("floor.seatedFor", { time: since(sel.since) })}`}
											{sel.servedAt &&
												` · ${t("floor.servedAgo", { time: since(sel.servedAt) })}`}
										</p>
										{needsCheck(sel, now) && (
											<p className="floor-callrow">
												<span>{t("floor.checkOnHint")}</span>
											</p>
										)}

										{callsAt(sel.table.label).map((r) => (
											<div key={r.id} className="floor-callrow">
												<span>
													{r.kind === "bill"
														? t("floor.callBill")
														: t("floor.callWaiter")}
												</span>

												<button
													type="button"
													onClick={() => void calls.close(r.id)}
												>
													{t("floor.callDone")}
												</button>
											</div>
										))}

										<label className="floor-server">
											<span>{t("floor.server")}</span>
											<select
												className="input"
												value={sel.table.serverMemberId ?? ""}
												onChange={(e) => void assign(e.target.value || null)}
											>
												<option value="">{t("floor.noServer")}</option>
												{staff.map((s) => (
													<option key={s.memberId} value={s.memberId}>
														{s.displayName}
													</option>
												))}
											</select>
										</label>

										<div className="floor-orders">
											{sel.orders.length === 0 && (
												<p className="muted">{t("floor.empty")}</p>
											)}
											{sel.orders.map(({ order, due }) => (
												<div key={order.id} className="floor-order">
													<button
														type="button"
														className="floor-order__main"
														onClick={() => setOpenOrder(order.id)}
													>
														<strong>{order.ticketNumber}</strong>
														<span className="muted small">
															{order.lines
																.filter((l) => !l.voidedAt)
																.map(
																	(l) =>
																		`${l.quantity}× ${lang === "ar" && l.name.ar ? l.name.ar : l.name.en}`,
																)
																.join(", ")}
														</span>
														<span className="row small">
															<span
																className="pill"
																data-fs={
																	order.servedAt
																		? "completed"
																		: order.fulfillmentStatus
																}
															>
																{t(
																	`floor.fs.${order.servedAt ? "completed" : order.fulfillmentStatus}` as MessageKey,
																)}
															</span>
															{isTab(order) && (
																<span className="pill">{t("floor.tab")}</span>
															)}
															<span className="spacer" />
															{due > 0 ? (
																<strong className="warn-text">
																	<Money amount={due} currency={OMR} />
																</strong>
															) : (
																<span className="muted">{t("floor.paid")}</span>
															)}
														</span>
													</button>
													{order.fulfillmentStatus === "ready" &&
														!order.servedAt && (
															<button
																type="button"
																onClick={() => void served(order.id)}
															>
																{t("floor.served")}
															</button>
														)}
												</div>
											))}
										</div>

										{sel.due > 0 && (
											<div className="row strong floor-due">
												<span>{t("floor.due")}</span>
												<span className="spacer" />
												<Money amount={sel.due} currency={OMR} />
											</div>
										)}
										{sel.status === "paid" && (
											<div className="floor-clear">
												<strong>{t("floor.allPaid")}</strong>
												<span className="muted small">
													{t("floor.clearHint")}
												</span>
												<button
													type="button"
													className="primary big"
													onClick={() => void clearTable()}
												>
													{t("floor.clear")}
												</button>
											</div>
										)}
										<div className="floor-actions">
											<button
												type="button"
												className="primary big"
												onClick={() => props.onNewOrder(sel.table.label)}
											>
												{sel.orders.length
													? t("floor.addOrder")
													: t("floor.seat")}
											</button>
											<div className="floor-actions__pair">
												{sel.due > 0 && (
													<button
														type="button"
														className="big"
														onClick={() => {
															const first = sel.orders.find((o) => o.due > 0);
															if (first) setOpenOrder(first.order.id);
														}}
													>
														{t("floor.pay")}
													</button>
												)}
												{sel.orders.length > 0 && (
													<button
														type="button"
														className="big"
														onClick={() => {
															setNotice(null);
															setMoving(true);
														}}
													>
														{t("floor.moveMerge")}
													</button>
												)}
											</div>
										</div>
									</>
								)}
							</aside>
						</div>
					</>
				)}
			</div>
			{openOrder && (
				<OrdersSheet
					initialView="today"
					initialOrderId={openOrder}
					onClose={() => {
						setOpenOrder(null);
						void reload();
					}}
				/>
			)}
		</div>
	);
}

/** Chairs around a table, so the plan reads like the room. Decoration only. */
function Chairs({ seats, shape }: { seats: number; shape: string }) {
	const n = Math.min(seats, 12);
	if (shape === "round") {
		return (
			<span className="floor-chairs" aria-hidden="true">
				{Array.from({ length: n }, (_, i) => {
					const a = (i / n) * 2 * Math.PI - Math.PI / 2;
					return (
						<i
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration
							key={i}
							style={{
								left: `${50 + 58 * Math.cos(a)}%`,
								top: `${50 + 58 * Math.sin(a)}%`,
							}}
						/>
					);
				})}
			</span>
		);
	}
	const top = Math.ceil(n / 2);
	const side = (count: number, y: string) =>
		Array.from({ length: count }, (_, i) => (
			<i
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration
				key={`${y}${i}`}
				style={{ left: `${((i + 1) / (count + 1)) * 100}%`, top: y }}
			/>
		));
	return (
		<span className="floor-chairs" aria-hidden="true">
			{side(top, "-10%")}
			{side(n - top, "110%")}
		</span>
	);
}
