import type { MenuProduct, PaymentMethod } from "@bite/contracts";
import type { PricedOrder } from "@bite/core";
import { Money, QuantityStepper } from "@bite/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type CashSession,
	openCashSession,
	openSession,
} from "../domain/cash.js";
import { newId } from "../domain/ids.js";
import { pointsFor, rewardOff, type TillGuest } from "../domain/loyalty.js";
import {
	loadMenu,
	type PricedMenu,
	prepareMenu,
	tilePrice,
} from "../domain/menu.js";
import { listToPay } from "../domain/orders.js";
import {
	commitSale,
	quote,
	type TenderInput,
	type TillLine,
} from "../domain/sale.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { DrawerSheet } from "./DrawerSheet.js";
import { FloorSheet } from "./FloorSheet.js";
import { GuestSheet } from "./GuestSheet.js";
import { ModifierSheet } from "./ModifierSheet.js";
import { fmt, OMR } from "./money.js";
import { OrdersSheet, type OrdersView } from "./OrdersSheet.js";
import { PaySheet } from "./PaySheet.js";
import { kitchenFor, loc, receiptFor } from "./receipts.js";
import { useServices } from "./services.js";

export function TillScreen() {
	const { db, api, sync, device, member, print } = useServices();
	const { t, lang, dir } = useI18n();
	const [menu, setMenu] = useState<PricedMenu | null>(null);
	const [category, setCategory] = useState<string | null>(null);
	const [lines, setLines] = useState<TillLine[]>([]);
	const [picking, setPicking] = useState<MenuProduct | null>(null);
	const [paying, setPaying] = useState<{
		priced: PricedOrder;
		at: number;
	} | null>(null);
	const [drawer, setDrawer] = useState<CashSession | null>(null);
	// Mirrors the API's cash.* role rules.
	const canDrawer = member.role === "manager" || member.role === "cashier";
	const [done, setDone] = useState<{
		ticket: string;
		change: number;
		printError: string | null;
		/** Sent to a table unpaid (a tab). */
		table?: string;
		/** Loyalty: reward taken off, points this bill earns, or why the reward failed. */
		rewardAmount?: number;
		points?: number;
		rewardError?: { error: string; left: number };
	} | null>(null);
	const [guest, setGuest] = useState<TillGuest | null>(null);
	const [type, setType] = useState<"dine_in" | "takeaway">("takeaway");
	const [table, setTable] = useState("");
	const [sheet, setSheet] = useState<
		"orders" | "drawer" | "floor" | "guest" | null
	>(null);
	const [ordersView, setOrdersView] = useState<OrdersView>("today");
	/** Orders waiting to be paid at this counter (QR and group orders). */
	const [waiting, setWaiting] = useState(0);

	const reloadMenu = useCallback(async () => {
		const snap = await loadMenu(db);
		setMenu(snap ? prepareMenu(snap) : null);
	}, [db]);

	useEffect(() => {
		void reloadMenu();
		void openSession(db).then(setDrawer);
		const off = sync.onMenuChanged(() => void reloadMenu());
		const offDrawer = sync.onDrawerChanged(
			() => void openSession(db).then(setDrawer),
		);
		const countWaiting = () =>
			void listToPay(db).then((w) => setWaiting(w.length));
		countWaiting();
		const offOrders = sync.onOrdersChanged(countWaiting);
		return () => {
			off();
			offDrawer();
			offOrders();
		};
	}, [db, sync, reloadMenu]);

	const now = Date.now();
	const q = useMemo(
		() => (menu && lines.length ? quote(menu, lines, now) : null),
		[menu, lines, now],
	);

	const total = q?.ok ? q.priced.total : 0;
	const off = rewardOff(guest, total);
	/** What the till collects: the bill less the reward. */
	const due = total - (off?.amount ?? 0);

	if (!menu) return <p className="empty">{t("pos.empty")}</p>;
	const snap = menu.snapshot;
	const cats = [...snap.categories].sort((a, b) => a.sortOrder - b.sortOrder);
	const activeCat = category ?? cats[0]?.id ?? null;
	const products = snap.products
		.filter((p) => p.categoryId === activeCat)
		.sort((a, b) => a.sortOrder - b.sortOrder);

	function addProduct(p: MenuProduct) {
		if (!p.isAvailable) return;
		if (p.modifierGroupIds.length > 0) return setPicking(p);
		// Same plain product: bump quantity instead of a new line.
		const existing = lines.find(
			(l) =>
				l.productId === p.id && l.modifierOptionIds.length === 0 && !l.note,
		);
		if (existing)
			return setLines(
				lines.map((l) =>
					l === existing ? { ...l, quantity: l.quantity + 1 } : l,
				),
			);
		setLines([
			...lines,
			{ lineId: newId(), productId: p.id, quantity: 1, modifierOptionIds: [] },
		]);
	}

	function bump(lineId: string, by: number) {
		setLines((ls) =>
			ls.flatMap((l) =>
				l.lineId !== lineId
					? [l]
					: l.quantity + by <= 0
						? []
						: [{ ...l, quantity: l.quantity + by }],
			),
		);
	}

	async function charge(tenders: TenderInput[], sale = paying) {
		if (!sale || !menu) return;
		const reward = rewardOff(guest, sale.priced.total);
		const res = await commitSale(db, {
			menu,
			lines,
			at: sale.at,
			type,
			...(guest && { customerPhone: guest.phone }),
			...(guest?.name && { customerName: guest.name }),
			...(type === "dine_in" && table.trim()
				? { tableLabel: table.trim().slice(0, 20) }
				: {}),
			ticketPrefix: device.ticketPrefix,
			memberId: member.memberId,
			tenders,
			cashSessionId: drawer?.id ?? null,
		});
		if (!res.ok) return res.error;
		setPaying(null);
		setLines([]);
		setTable("");
		const attached = guest;
		setGuest(null);

		// The reward is spent on the server (points are shared across branches),
		// so the order has to get there first. If that fails the sale still
		// stands, partly paid, and the rest is taken from Orders -> To pay.
		const receiptPayments: { method: PaymentMethod; amount: number }[] = [
			...res.payments,
		];
		let rewardError: { error: string; left: number } | undefined;
		if (reward && attached?.customer) {
			const body = {
				rewardId: reward.rewardId,
				customerId: attached.customer.id,
			};
			try {
				await sync.syncNow();
				const r = await api.redeem(res.order.id, body).catch(async (err) => {
					// A sync already in flight may have started before this sale was
					// queued: push once more, then try again.
					if ((err as { status?: number }).status !== 404) throw err;
					await sync.syncNow();
					return api.redeem(res.order.id, body);
				});
				receiptPayments.push({ method: "loyalty", amount: r.amount });
			} catch (err) {
				rewardError = { error: (err as Error).message, left: reward.amount };
			}
		}
		sync.kick();

		// Print after the sale is safely stored. Failures are shown, never block.
		const tz = snap.location.timezone;
		const results = await Promise.all([
			print.print("kitchen", kitchenFor(res.order, tz, lang, dir)),
			print.print(
				"receipt",
				receiptFor(res.order, {
					timeZone: tz,
					lang,
					dir,
					locationName: device.name,
					payments: receiptPayments,
					change: res.change,
					openDrawer: res.payments.some((p) => p.method === "cash"),
				}),
			),
		]);
		const failed = results.flat().find((r) => !r.ok);
		// On a split bill the earlier guests already got their change in the pay
		// sheet: what's owed now is the last tender's.
		const last = tenders.at(-1);
		setDone({
			ticket: res.order.ticketNumber,
			change: last?.tendered !== undefined ? last.tendered - last.amount : 0,
			printError: failed && !failed.ok ? failed.error : null,
			...(reward && !rewardError && { rewardAmount: reward.amount }),
			...(attached && {
				points: pointsFor(
					attached,
					res.payments.reduce((s, p) => s + p.amount, 0),
				),
			}),
			...(rewardError && { rewardError }),
		});
		return null;
	}

	/** The reward covers the whole bill: nothing to take, store it and spend the points. */
	async function chargeReward() {
		if (!q?.ok) return;
		await charge([], { priced: q.priced, at: q.at });
	}

	/** Dine-in at a table, paid at the end: straight to the kitchen, no tender. */
	async function sendTab() {
		if (!q?.ok || !menu) return;
		const label = table.trim().slice(0, 20);
		if (type !== "dine_in" || !label) return;
		const res = await commitSale(db, {
			menu,
			lines,
			at: q.at,
			type,
			tableLabel: label,
			ticketPrefix: device.ticketPrefix,
			memberId: member.memberId,
			tenders: [],
			cashSessionId: drawer?.id ?? null,
		});
		if (!res.ok) return;
		sync.kick();
		setLines([]);
		setTable("");
		const printed = await print.print(
			"kitchen",
			kitchenFor(res.order, snap.location.timezone, lang, dir),
		);
		const failed = printed.find((r) => !r.ok);
		setDone({
			ticket: res.order.ticketNumber,
			change: 0,
			printError: failed && !failed.ok ? failed.error : null,
			table: label,
		});
	}

	return (
		<div className="till">
			<section className="menu-pane">
				<nav className="cats">
					{cats.map((c) => (
						<button
							type="button"
							key={c.id}
							className={c.id === activeCat ? "chip active" : "chip"}
							onClick={() => setCategory(c.id)}
						>
							{loc(c.name, lang)}
						</button>
					))}
				</nav>
				<div className="grid">
					{products.map((p) => {
						const price = tilePrice(menu, p, now);
						return (
							<button
								type="button"
								key={p.id}
								className={p.isAvailable ? "tile" : "tile soldout"}
								onClick={() => addProduct(p)}
								disabled={!p.isAvailable}
							>
								<span className="tile-title">{loc(p.name, lang)}</span>
								<span className="tile-price">
									<Money amount={price.unitPrice} currency={OMR} />
									{price.promotionId && (
										<s className="muted small">
											<Money amount={price.listUnitPrice} currency={OMR} />
										</s>
									)}
								</span>
								{!p.isAvailable && (
									<span className="tag">{t("till.soldOut")}</span>
								)}
							</button>
						);
					})}
				</div>
			</section>

			<aside className="cart-pane">
				<div className="row tools">
					<button
						type="button"
						onClick={() => {
							setOrdersView("today");
							setSheet("orders");
						}}
					>
						{t("orders.title")}
					</button>
					<button type="button" onClick={() => setSheet("floor")}>
						{t("floor.open")}
					</button>
					{canDrawer && (
						<button type="button" onClick={() => setSheet("drawer")}>
							{drawer ? t("drawer.title") : t("drawer.open")}
						</button>
					)}
				</div>
				{waiting > 0 && (
					<button
						type="button"
						className="waiting"
						onClick={() => {
							setOrdersView("toPay");
							setSheet("orders");
						}}
					>
						<span className="count">{waiting}</span>
						{t("till.waiting")}
					</button>
				)}
				<div className="row">
					<h2>{t("till.cart")}</h2>
					<span className="spacer" />
					<div className="seg">
						<button
							type="button"
							className={type === "takeaway" ? "active" : ""}
							onClick={() => setType("takeaway")}
						>
							{t("order.takeaway")}
						</button>
						<button
							type="button"
							className={type === "dine_in" ? "active" : ""}
							onClick={() => setType("dine_in")}
						>
							{t("order.dineIn")}
						</button>
					</div>
				</div>
				{type === "dine_in" && (
					<label className="row table-field">
						<span>{t("order.table")}</span>
						<input
							className="input"
							value={table}
							maxLength={20}
							inputMode="text"
							placeholder={t("order.tablePlaceholder")}
							onChange={(e) => setTable(e.target.value)}
						/>
					</label>
				)}
				<div className="cart-lines">
					{lines.length === 0 && <p className="muted">{t("till.empty")}</p>}
					{lines.map((l, i) => {
						const p = snap.products.find((x) => x.id === l.productId);
						const priced = q?.ok ? q.priced.lines[i] : undefined;
						return (
							<div key={l.lineId} className="cart-line">
								<div className="grow">
									<div>{p ? loc(p.name, lang) : "?"}</div>
									{priced?.modifiers.map((m) => (
										<div key={m.optionId} className="muted small">
											+ {loc(m.name, lang)}
										</div>
									))}
								</div>
								<QuantityStepper
									size="md"
									value={l.quantity}
									onChange={(next) =>
										bump(l.lineId, next > l.quantity ? 1 : -1)
									}
									onRemove={() => bump(l.lineId, -1)}
								/>
								<div className="amount">
									{priced && <Money amount={priced.lineGross} currency={OMR} />}
								</div>
							</div>
						);
					})}
				</div>
				{q && !q.ok && (
					<p className="error">
						{t("till.cannotPrice", {
							errors: q.errors.map((e) => e.code).join(", "),
						})}
					</p>
				)}
				<button
					type="button"
					className={guest ? "guest-chip attached" : "guest-chip"}
					onClick={() => setSheet("guest")}
				>
					<span aria-hidden="true">★</span>
					{guest ? (
						<span className="grow">
							{guest.name ?? <bdi dir="ltr">{guest.phone}</bdi>}
							{guest.customer && (
								<span className="muted small">
									{" · "}
									{t("guest.points", { points: guest.customer.points })}
								</span>
							)}
						</span>
					) : (
						<span className="grow">{t("guest.add")}</span>
					)}
				</button>
				{q?.ok && (
					<div className="totals">
						{off && guest?.customer && (
							<div className="row guest-off">
								<span>
									{t("guest.reward", {
										name: loc(
											guest.customer.program.rewards.find(
												(r) => r.id === off.rewardId,
											)?.name ?? { en: "" },
											lang,
										),
									})}
								</span>
								<span className="spacer" />
								<Money amount={-off.amount} currency={OMR} />
							</div>
						)}
						{q.priced.discountTotal > 0 && (
							<div className="row">
								<span>{t("money.discount")}</span>
								<span className="spacer" />
								<Money amount={-q.priced.discountTotal} currency={OMR} />
							</div>
						)}
						<div className="row muted">
							<span>{t("money.tax")}</span>
							<span className="spacer" />
							<Money amount={q.priced.taxTotal} currency={OMR} />
						</div>
					</div>
				)}
				{type === "dine_in" && table.trim() && q?.ok && (
					<button
						type="button"
						className="big tab-send"
						onClick={() => void sendTab()}
						title={t("till.tabHint")}
					>
						{t("till.sendTab")}
						<span className="muted small">{t("till.tabHint")}</span>
					</button>
				)}
				<div className="row">
					<button
						type="button"
						onClick={() => {
							setLines([]);
							setGuest(null);
						}}
						disabled={lines.length === 0 && !guest}
					>
						{t("till.clear")}
					</button>
					<button
						type="button"
						className="primary grow big"
						disabled={!q?.ok}
						onClick={() =>
							off && due === 0
								? void chargeReward()
								: q?.ok && setPaying({ priced: q.priced, at: q.at })
						}
					>
						{off && due === 0
							? t("guest.payWithReward")
							: t("till.pay", { amount: q?.ok ? fmt(due, lang) : "" })}
					</button>
				</div>
			</aside>

			{picking && (
				<ModifierSheet
					menu={menu}
					product={picking}
					onCancel={() => setPicking(null)}
					onAdd={(optionIds, note) => {
						// Same product, same choices, same note: one line, qty + 1,
						// so the kitchen reads "2× Karak", not two Karak lines.
						const key = [...optionIds].sort().join(",");
						const same = lines.find(
							(l) =>
								l.productId === picking.id &&
								[...l.modifierOptionIds].sort().join(",") === key &&
								(l.note ?? "") === (note ?? ""),
						);
						if (same) {
							setLines(
								lines.map((l) =>
									l === same ? { ...l, quantity: l.quantity + 1 } : l,
								),
							);
							return setPicking(null);
						}
						setLines([
							...lines,
							{
								lineId: newId(),
								productId: picking.id,
								quantity: 1,
								modifierOptionIds: optionIds,
								...(note && { note }),
							},
						]);
						setPicking(null);
					}}
				/>
			)}
			{paying && (
				<PaySheet
					total={
						paying.priced.total -
						(rewardOff(guest, paying.priced.total)?.amount ?? 0)
					}
					drawer={drawer}
					canOpenDrawer={canDrawer}
					onOpenDrawer={async (float) => {
						const s = await openCashSession(db, {
							openingFloat: float,
							memberId: member.memberId,
							at: Date.now(),
							timeZone: snap.location.timezone,
							dayCutoffMinutes: snap.location.dayCutoffMinutes,
						});
						setDrawer(s);
						sync.kick();
					}}
					onCancel={() => setPaying(null)}
					onCharge={charge}
				/>
			)}
			{sheet === "orders" && (
				<OrdersSheet
					initialView={ordersView}
					onClose={() => {
						setSheet(null);
						// Paying or cancelling in there changes both.
						void listToPay(db).then((w) => setWaiting(w.length));
						void openSession(db).then(setDrawer);
					}}
				/>
			)}
			{sheet === "floor" && (
				<FloorSheet
					onClose={() => {
						setSheet(null);
						void listToPay(db).then((w) => setWaiting(w.length));
					}}
					onNewOrder={(label) => {
						setType("dine_in");
						setTable(label);
						setSheet(null);
					}}
				/>
			)}
			{sheet === "guest" && (
				<GuestSheet
					guest={guest}
					total={total}
					onAttach={(g) => {
						setGuest(g);
						setSheet(null);
					}}
					onRemove={() => {
						setGuest(null);
						setSheet(null);
					}}
					onClose={() => setSheet(null)}
				/>
			)}
			{sheet === "drawer" && (
				<DrawerSheet
					onClose={() => {
						setSheet(null);
						// The drawer may have been opened or closed in there.
						void openSession(db).then(setDrawer);
					}}
				/>
			)}
			{done && (
				<div className="sheet-backdrop">
					<div className="sheet narrow center">
						<h2>
							{done.table
								? t("till.tabSent", { table: done.table })
								: t("pay.done", { ticket: done.ticket })}
						</h2>
						{done.change > 0 && (
							<p className="huge">
								{t("pay.change", { amount: fmt(done.change, lang) })}
							</p>
						)}
						{done.rewardAmount !== undefined && (
							<p className="notice guest-done">
								★{" "}
								{t("guest.rewardApplied", {
									amount: fmt(done.rewardAmount, lang),
								})}
							</p>
						)}
						{done.points !== undefined && done.points > 0 && (
							<p className="muted">
								{t("guest.earned", { points: done.points })}
							</p>
						)}
						{done.rewardError && (
							<p className="error">
								{t("guest.rewardFailed", {
									error: done.rewardError.error,
									amount: fmt(done.rewardError.left, lang),
								})}
							</p>
						)}
						{done.printError && (
							<p className="error">
								{t("pay.printFailed", { error: done.printError })}
							</p>
						)}
						<button
							type="button"
							className="primary big"
							onClick={() => setDone(null)}
						>
							{t("pay.newOrder")}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
