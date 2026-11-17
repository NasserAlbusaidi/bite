import type { Order } from "@bite/contracts";
import { businessDate, formatDecimal, type Minor } from "@bite/core";
import { useCallback, useEffect, useState } from "react";
import { openSession } from "../domain/cash.js";
import { loadMenu } from "../domain/menu.js";
import {
	lineGross,
	listOrders,
	loadOrder,
	type OrderDetail,
	type OrderListItem,
	type Place,
	refund,
	voidUnpaidLine,
} from "../domain/orders.js";
import { useI18n } from "../i18n/I18nProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { useManagerGate } from "./ManagerApproval.js";
import { fmt, parseAmount } from "./money.js";
import { loc, methodLabel, receiptFor } from "./receipts.js";
import { useServices } from "./services.js";

const DAY_MS = 86_400_000;

type Ask =
	| { kind: "refund"; lineId?: string; amount: number; max: number }
	| { kind: "void"; lineId: string };

/** Today's and yesterday's orders, with refunds, voids and reprints. */
export function OrdersSheet(props: { onClose: () => void }) {
	const { db, sync, member, print, device } = useServices();
	const { t, lang, dir } = useI18n();
	const [place, setPlace] = useState<Place | null>(null);
	const [dayOffset, setDayOffset] = useState(0);
	const [search, setSearch] = useState("");
	const [items, setItems] = useState<OrderListItem[]>([]);
	const [selected, setSelected] = useState<string | null>(null);
	const [detail, setDetail] = useState<OrderDetail | null>(null);
	const [ask, setAsk] = useState<Ask | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const { gate, sheet } = useManagerGate();

	useEffect(() => {
		void loadMenu(db).then((m) =>
			setPlace(
				m
					? {
							timeZone: m.location.timezone,
							dayCutoffMinutes: m.location.dayCutoffMinutes,
						}
					: null,
			),
		);
	}, [db]);

	const day = place
		? businessDate(
				Date.now() - dayOffset * DAY_MS,
				place.timeZone,
				place.dayCutoffMinutes,
			)
		: null;

	const reload = useCallback(async () => {
		if (!day) return;
		setItems(await listOrders(db, day, search));
		if (selected) setDetail(await loadOrder(db, selected));
	}, [db, day, search, selected]);

	useEffect(() => {
		void reload();
		const off = sync.onOrdersChanged(() => void reload());
		return () => {
			off();
		};
	}, [reload, sync]);

	const o = detail?.order;
	const open =
		o &&
		o.fulfillmentStatus !== "completed" &&
		o.fulfillmentStatus !== "cancelled";
	const net = detail?.summary?.net ?? o?.paidTotal ?? 0;

	async function doRefund(
		managerId: string,
		a: Extract<Ask, { kind: "refund" }>,
		reason: string,
	) {
		if (!o || !place) return;
		const drawer = await openSession(db);
		const res = await refund(db, {
			orderId: o.id,
			amount: a.amount as Minor,
			reason,
			managerId,
			cashSessionId: drawer?.id ?? null,
			...(a.lineId && open && { voidLineId: a.lineId }),
			place,
		});
		if (!res.ok) return setNotice(t(`orders.error.${res.error}` as MessageKey));
		sync.kick();
		setNotice(t("orders.refunded", { amount: fmt(a.amount, lang) }));
		const after = await loadOrder(db, o.id);
		if (after && place) {
			void print.print(
				"receipt",
				receiptFor(after.order, {
					timeZone: place.timeZone,
					lang,
					dir,
					locationName: device.name,
					payments: after.payments ?? [],
					openDrawer: (after.payments ?? []).some(
						(p) => p.amount < 0 && p.method === "cash",
					),
					reprint: true,
				}),
			);
		}
		await reload();
	}

	async function doVoid(lineId: string, reason: string) {
		if (!o) return;
		const res = await voidUnpaidLine(db, {
			orderId: o.id,
			lineId,
			reason,
			memberId: member.memberId,
		});
		if (!res.ok) return setNotice(t(`orders.error.${res.error}` as MessageKey));
		sync.kick();
		await reload();
	}

	function reprint() {
		if (!o || !place) return;
		void print
			.print(
				"receipt",
				receiptFor(o, {
					timeZone: place.timeZone,
					lang,
					dir,
					locationName: device.name,
					payments: detail?.payments ?? [],
					reprint: true,
				}),
			)
			.then((r) => {
				const bad = r.find((x) => !x.ok);
				if (bad && !bad.ok)
					setNotice(t("pay.printFailed", { error: bad.error }));
			});
	}

	return (
		<div className="sheet-backdrop">
			<div className="sheet full orders">
				<div className="row">
					<h2>{t("orders.title")}</h2>
					<span className="spacer" />
					<div className="seg">
						<button
							type="button"
							className={dayOffset === 0 ? "active" : ""}
							onClick={() => setDayOffset(0)}
						>
							{t("orders.today")}
						</button>
						<button
							type="button"
							className={dayOffset === 1 ? "active" : ""}
							onClick={() => setDayOffset(1)}
						>
							{t("orders.yesterday")}
						</button>
					</div>
					<button type="button" onClick={props.onClose}>
						{t("settings.close")}
					</button>
				</div>
				<div className="orders-body">
					<div className="orders-list">
						<input
							className="field"
							type="search"
							placeholder={t("orders.search")}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
						{items.length === 0 && <p className="muted">{t("orders.none")}</p>}
						{items.map(({ order, problem, pending }) => (
							<button
								type="button"
								key={order.id}
								className={
									order.id === selected ? "order-row active" : "order-row"
								}
								onClick={() => {
									setSelected(order.id);
									setNotice(null);
									void loadOrder(db, order.id).then(setDetail);
								}}
							>
								<strong dir="ltr">{order.ticketNumber}</strong>
								<span className="muted small">
									{timeOf(order, place?.timeZone)}
								</span>
								<span className="spacer" />
								{problem && <span className="pill bad">!</span>}
								{pending && <span className="pill">⟳</span>}
								<StatusTag order={order} />
								<span className="amount">{fmt(order.total, lang)}</span>
							</button>
						))}
					</div>
					<div className="orders-detail">
						{!o && <p className="muted">{t("orders.pick")}</p>}
						{o && (
							<>
								<div className="row">
									<h3 dir="ltr">{o.ticketNumber}</h3>
									<StatusTag order={o} />
									<span className="muted small">
										{t(
											o.type === "dine_in" ? "order.dineIn" : "order.takeaway",
										)}
										{o.source === "guest" ? ` · ${t("orders.qr")}` : ""}
									</span>
									<span className="spacer" />
									<button type="button" onClick={reprint}>
										{t("orders.reprint")}
									</button>
								</div>
								{notice && <p className="notice">{notice}</p>}
								<div className="detail-lines">
									{o.lines.map((l) => {
										const voided = l.voidedAt !== null;
										const gross = lineGross(o, l.id);
										const paidFor = net > o.total - gross;
										return (
											<div
												key={l.id}
												className={voided ? "line voided" : "line"}
											>
												<div className="grow">
													<div>
														{l.quantity}× {loc(l.name, lang)}
													</div>
													{l.modifiers.map((m) => (
														<div key={m.optionId} className="muted small">
															+ {loc(m.name, lang)}
														</div>
													))}
													{voided && (
														<div className="muted small">
															{t("orders.voided")}: {l.voidReason}
														</div>
													)}
												</div>
												<span className="amount">{fmt(gross, lang)}</span>
												{!voided &&
													paidFor &&
													detail?.payments &&
													detail.refundable > 0 && (
														<button
															type="button"
															onClick={() =>
																setAsk({
																	kind: "refund",
																	lineId: l.id,
																	amount: Math.min(gross, detail.refundable),
																	max: detail.refundable,
																})
															}
														>
															{t("orders.refundItem")}
														</button>
													)}
												{!voided &&
													!paidFor &&
													open &&
													member.role !== "server" && (
														<button
															type="button"
															onClick={() =>
																setAsk({ kind: "void", lineId: l.id })
															}
														>
															{t("orders.voidItem")}
														</button>
													)}
											</div>
										);
									})}
								</div>
								<div className="totals">
									<Pair
										label={t("money.total")}
										value={fmt(o.total, lang)}
										bold
									/>
									{(detail?.payments ?? []).map((p) => (
										<Pair
											key={p.id}
											label={`${p.amount < 0 ? `${t("orders.refund")} ` : ""}${methodLabel(lang, p.method)}${p.reason ? ` · ${p.reason}` : ""}`}
											value={fmt(p.amount, lang)}
										/>
									))}
									<Pair label={t("money.paid")} value={fmt(net, lang)} />
								</div>
								{!detail?.payments && net > 0 && (
									<p className="muted small">{t("orders.paidElsewhere")}</p>
								)}
								{detail?.payments && detail.refundable > 0 && (
									<div className="row">
										<span className="spacer" />
										<button
											type="button"
											className="danger"
											onClick={() =>
												setAsk({
													kind: "refund",
													amount: detail.refundable,
													max: detail.refundable,
												})
											}
										>
											{t("orders.refundAmount")}
										</button>
									</div>
								)}
							</>
						)}
					</div>
				</div>
			</div>
			{ask && (
				<ReasonSheet
					ask={ask}
					onCancel={() => setAsk(null)}
					onConfirm={(reason, amount) => {
						const a = ask;
						setAsk(null);
						if (a.kind === "void") return void doVoid(a.lineId, reason);
						const r = { ...a, amount };
						gate(
							t("orders.approveRefund", { amount: fmt(amount, lang) }),
							(id) => void doRefund(id, r, reason),
						);
					}}
				/>
			)}
			{sheet}
		</div>
	);
}

function timeOf(order: Order, timeZone: string | undefined) {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(new Date(order.placedAt));
}

function Pair(props: { label: string; value: string; bold?: boolean }) {
	return (
		<div className={props.bold ? "row strong" : "row"}>
			<span>{props.label}</span>
			<span className="spacer" />
			<span>{props.value}</span>
		</div>
	);
}

function StatusTag({ order }: { order: Order }) {
	const { t } = useI18n();
	const bad =
		order.paymentStatus === "refunded" ||
		order.fulfillmentStatus === "cancelled";
	return (
		<span className={bad ? "pill bad" : "pill"}>
			{t(`orders.pay.${order.paymentStatus}` as MessageKey)}
		</span>
	);
}

const REASONS = [
	"orders.reason.changedMind",
	"orders.reason.wrongItem",
	"orders.reason.quality",
] as const;

function ReasonSheet(props: {
	ask: Ask;
	onCancel: () => void;
	onConfirm: (reason: string, amount: number) => void;
}) {
	const { t, lang } = useI18n();
	const { ask } = props;
	const [reason, setReason] = useState("");
	const [amountText, setAmountText] = useState(
		ask.kind === "refund" ? formatDecimal(ask.amount as Minor) : "",
	);
	const amount = ask.kind === "refund" ? parseAmount(amountText) : 0;
	const amountOk =
		ask.kind === "void" || (amount !== null && amount > 0 && amount <= ask.max);
	return (
		<div className="sheet-backdrop">
			<div className="sheet narrow">
				<h2>{t(ask.kind === "void" ? "orders.voidItem" : "orders.refund")}</h2>
				{ask.kind === "refund" && (
					<label className="stack">
						<span>{t("orders.amountMax", { amount: fmt(ask.max, lang) })}</span>
						<input
							className="field"
							inputMode="decimal"
							dir="ltr"
							value={amountText}
							disabled={ask.lineId !== undefined}
							onChange={(e) => setAmountText(e.target.value)}
						/>
					</label>
				)}
				<div className="chips">
					{REASONS.map((k) => (
						<button
							type="button"
							key={k}
							className={reason === t(k) ? "chip active" : "chip"}
							onClick={() => setReason(t(k))}
						>
							{t(k)}
						</button>
					))}
				</div>
				<input
					className="field"
					placeholder={t("orders.reason")}
					value={reason}
					maxLength={200}
					onChange={(e) => setReason(e.target.value)}
				/>
				<div className="row">
					<button type="button" onClick={props.onCancel}>
						{t("till.cancel")}
					</button>
					<span className="spacer" />
					<button
						type="button"
						className="primary"
						disabled={!reason.trim() || !amountOk}
						onClick={() => props.onConfirm(reason.trim(), amount ?? 0)}
					>
						{t("pay.confirm")}
					</button>
				</div>
			</div>
		</div>
	);
}
