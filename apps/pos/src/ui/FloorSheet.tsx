import type { Floor } from "@bite/contracts";
import { FLOOR_GRID } from "@bite/contracts";
import { isTab } from "@bite/core";
import { Money } from "@bite/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listCachedStaff, type StaffMember } from "../auth/staff.js";
import {
	assignServer,
	loadFloor,
	moveTable,
	type TableState,
	type TableStatus,
	tableStates,
} from "../domain/floor.js";
import { moveTicket } from "../domain/kitchen.js";
import { useI18n } from "../i18n/I18nProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { OMR } from "./money.js";
import { OrdersSheet } from "./OrdersSheet.js";
import { useServices } from "./services.js";

const STATUSES: TableStatus[] = [
	"free",
	"ordered",
	"cooking",
	"ready",
	"to_pay",
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
		const res = await moveTicket(db, {
			orderId,
			to: "completed",
			memberId: member.memberId,
		});
		if (!res.ok) return setNotice(t("floor.payFirst"));
		sync.kick();
		await reload();
	}

	const minutes = (iso: string | null) =>
		iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000)) : 0;

	return (
		<div className="sheet-backdrop">
			<div className="sheet full floor">
				<div className="row">
					<h2>{t("floor.title")}</h2>
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
									<span key={st} className="floor-key" data-status={st}>
										<i />
										{t(`floor.status.${st}` as MessageKey)} {n}
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
								<button type="button" onClick={() => setMoving(false)}>
									{t("floor.cancel")}
								</button>
							</p>
						)}

						<div className="floor-body">
							<div
								className="floor-canvas"
								dir="ltr"
								style={{
									aspectRatio: `${FLOOR_GRID.cols} / ${FLOOR_GRID.rows}`,
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
												left: `${(s.table.x / FLOOR_GRID.cols) * 100}%`,
												top: `${(s.table.y / FLOOR_GRID.rows) * 100}%`,
												width: `${(s.table.w / FLOOR_GRID.cols) * 100}%`,
												height: `${(s.table.h / FLOOR_GRID.rows) * 100}%`,
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
											<strong className="floor-table__label">
												{s.table.label}
											</strong>
											{s.status !== "free" && (
												<span className="floor-table__meta">
													{t("floor.minutes", { n: minutes(s.since) })}
												</span>
											)}
											{s.due > 0 && (
												<span className="floor-table__due">
													<Money amount={s.due} currency={OMR} />
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

							<aside className="floor-panel">
								{!sel ? (
									<p className="muted">{t("floor.pick")}</p>
								) : (
									<>
										<div className="row">
											<h3>{t("floor.table", { label: sel.table.label })}</h3>
											<span className="spacer" />
											<span className="floor-key" data-status={sel.status}>
												<i />
												{t(`floor.status.${sel.status}` as MessageKey)}
											</span>
										</div>
										<p className="muted small">
											{t("floor.seats", { n: sel.table.seats })}
											{sel.since &&
												` · ${t("floor.minutes", { n: minutes(sel.since) })}`}
										</p>

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
																data-fs={order.fulfillmentStatus}
															>
																{t(
																	`floor.fs.${order.fulfillmentStatus}` as MessageKey,
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
													{order.fulfillmentStatus === "ready" && due === 0 && (
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
											<div className="row strong">
												<span>{t("floor.due")}</span>
												<span className="spacer" />
												<Money amount={sel.due} currency={OMR} />
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
