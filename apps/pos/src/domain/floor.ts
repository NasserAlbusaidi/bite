import type {
	AssignTable,
	Floor,
	FloorTable,
	Order,
	OrderAtTable,
	SetOrderTable,
} from "@bite/contracts";
import { type AtTableError, checkAtTable, isTab, type Minor } from "@bite/core";
import type { SqlDriver, SqlExecutor } from "../db/driver.js";
import { kvGet, kvSet } from "../db/kv.js";
import { enqueue } from "../sync/outbox.js";
import { loadOrder } from "./orders.js";

const KEY = "floor.plan";

/** Store the plan the server sent with a pull. */
export async function saveFloor(db: SqlExecutor, floor: Floor) {
	await kvSet(db, KEY, JSON.stringify(floor));
}

/**
 * The floor as this tablet should show it: the server's last copy, with
 * server assignments made here and not yet sent laid on top, so a tap shows
 * at once and survives a pull that raced it.
 */
export async function loadFloor(db: SqlExecutor): Promise<Floor | null> {
	const raw = await kvGet(db, KEY);
	if (!raw) return null;
	const floor = JSON.parse(raw) as Floor;
	const pending = await db.all<{ payload: string }>(
		"SELECT payload FROM outbox WHERE kind = 'table.assign' AND status = 'pending' ORDER BY seq",
	);
	for (const p of pending) {
		const a = JSON.parse(p.payload) as AssignTable;
		const t = floor.tables.find((x) => x.id === a.tableId);
		if (t) t.serverMemberId = a.memberId;
	}
	return floor;
}

/**
 * What a table is doing, most urgent first:
 * - ready: food is waiting at the pass to be taken out
 * - to_pay: a guest QR order waiting to be paid before the kitchen starts
 * - cooking: the kitchen is on it
 * - ordered: in, the kitchen hasn't started
 * - eating: everything served, the bill is still open
 * - paid: everything served and paid, guests still seated
 * - free: nobody there (staff cleared it)
 *
 * A table only goes back to free when staff tap "Clear table". Serving or
 * paying never frees it: the guests are still sitting there.
 */
export type TableStatus =
	| "ready"
	| "to_pay"
	| "cooking"
	| "ordered"
	| "eating"
	| "paid"
	| "free";

/** After this long a served table that nobody cleared frees itself. */
export const HOLD_HOURS = 6;
/** Minutes after the food went out before the floor nudges "check on them". */
export const CHECK_AFTER_MIN = 20;

export type TableState = {
	table: FloorTable;
	status: TableStatus;
	orders: TableOrder[];
	/** Still owed across the table's orders. */
	due: Minor;
	total: Minor;
	/** When the first open order came in (ISO), for "seated 25 min". */
	since: string | null;
	/** When the last food went out, once everything is served (ISO). */
	servedAt: string | null;
};

export type TableOrder = { order: Order; due: Minor; served: boolean };

/** Food is at the table: completed, or a tab marked served before paying. */
export const isServed = (o: Order) =>
	o.fulfillmentStatus === "completed" || !!o.servedAt;

/**
 * Orders holding a table: dine-in with a table, not cancelled, and not
 * cleared. A settled, completed order nobody cleared lets go after
 * HOLD_HOURS so yesterday's tables don't haunt the floor.
 */
async function openOrders(db: SqlExecutor, now: number): Promise<TableOrder[]> {
	const cutoff = new Date(now - HOLD_HOURS * 3_600_000).toISOString();
	const rows = await db.all<{ id: string }>(
		`SELECT id FROM orders
		 WHERE fulfillment_status != 'cancelled'
		   AND (fulfillment_status != 'completed'
		        OR payment_status IN ('unpaid', 'partially_paid')
		        OR placed_at >= ?)
		 ORDER BY placed_at`,
		[cutoff],
	);
	const out: TableOrder[] = [];
	for (const r of rows) {
		const d = await loadOrder(db, r.id);
		const o = d?.order;
		if (!d || !o?.tableLabel || o.type !== "dine_in" || o.tableClearedAt)
			continue;
		out.push({ order: o, due: d.summary.balanceDue, served: isServed(o) });
	}
	return out;
}

const keyOf = (label: string) => label.trim().toLowerCase();

export function statusOf(orders: readonly TableOrder[]): TableStatus {
	if (orders.length === 0) return "free";
	const f = (s: Order["fulfillmentStatus"]) =>
		orders.some((o) => !o.served && o.order.fulfillmentStatus === s);
	if (f("ready")) return "ready";
	// A guest order can't reach the kitchen until it's paid: someone must go.
	if (
		orders.some(
			(o) =>
				o.due > 0 && o.order.fulfillmentStatus === "pending" && !isTab(o.order),
		)
	)
		return "to_pay";
	if (f("preparing")) return "cooking";
	if (f("pending")) return "ordered";
	return orders.some((o) => o.due > 0) ? "eating" : "paid";
}

/** Every table on the plan with what is happening at it right now. */
export async function tableStates(
	db: SqlExecutor,
	floor: Floor,
	now = Date.now(),
): Promise<{ tables: TableState[]; unplaced: TableOrder[] }> {
	const open = await openOrders(db, now);
	const byLabel = new Map<string, TableOrder[]>();
	for (const o of open) {
		const k = keyOf(o.order.tableLabel ?? "");
		byLabel.set(k, [...(byLabel.get(k) ?? []), o]);
	}
	const tables = floor.tables.map((table) => {
		const orders = byLabel.get(keyOf(table.label)) ?? [];
		byLabel.delete(keyOf(table.label));
		const status = statusOf(orders);
		return {
			table,
			status,
			orders,
			due: orders.reduce((s, o) => s + o.due, 0) as Minor,
			total: orders.reduce((s, o) => s + o.order.total, 0) as Minor,
			since: orders[0]?.order.placedAt ?? null,
			servedAt:
				status === "eating" || status === "paid"
					? lastServed(orders.map((o) => o.order))
					: null,
		};
	});
	// Orders for a table number that isn't on the plan (typed by hand).
	return { tables, unplaced: [...byLabel.values()].flat() };
}

/**
 * Open orders already at one table (same match as the floor: trimmed,
 * case-insensitive label). The till shows these while staff ring more for
 * that table, so a guest's QR order isn't rung in a second time.
 */
export async function ordersAtTable(
	db: SqlExecutor,
	label: string,
	now = Date.now(),
): Promise<TableOrder[]> {
	const k = keyOf(label);
	if (!k) return [];
	return (await openOrders(db, now)).filter(
		(o) => keyOf(o.order.tableLabel ?? "") === k,
	);
}

/**
 * Products in the till cart that are already on an open order at the
 * table, with the ticket that has them. A hint to check, not a block: a
 * second hummus can be exactly what the table asked for.
 */
export function alreadyAtTable(
	productIds: readonly string[],
	orders: readonly TableOrder[],
): Map<string, string> {
	const out = new Map<string, string>();
	for (const pid of productIds) {
		if (out.has(pid)) continue;
		for (const { order } of orders) {
			if (order.lines.some((l) => !l.voidedAt && l.productId === pid)) {
				out.set(pid, order.ticketNumber);
				break;
			}
		}
	}
	return out;
}

function lastServed(orders: readonly Order[]): string | null {
	let best: string | null = null;
	for (const o of orders) {
		const at = o.servedAt ?? o.completedAt ?? null;
		if (at && (!best || at > best)) best = at;
	}
	return best;
}

/** Served and nobody has looked in for a while: worth a walk past. */
export function needsCheck(s: TableState, now = Date.now()): boolean {
	if (s.status !== "eating" || !s.servedAt) return false;
	return now - Date.parse(s.servedAt) >= CHECK_AFTER_MIN * 60_000;
}

/**
 * Record "served" or "cleared" for orders at a table, here and in the
 * outbox in one transaction. Clearing is all or nothing: if any order still
 * owes money or is still in the kitchen, nothing changes.
 */
export async function atTable(
	db: SqlDriver,
	input: {
		orderIds: readonly string[];
		step: OrderAtTable["step"];
		memberId: string;
		at?: number;
	},
): Promise<{ ok: true } | { ok: false; error: AtTableError }> {
	const now = new Date(input.at ?? Date.now());
	const at = now.toISOString();
	return db.transaction(async (tx) => {
		const docs: Order[] = [];
		for (const id of input.orderIds) {
			const [row] = await tx.all<{ doc: string }>(
				"SELECT doc FROM orders WHERE id = ?",
				[id],
			);
			if (row) docs.push(JSON.parse(row.doc) as Order);
		}
		const todo: { order: Order; complete: boolean }[] = [];
		for (const order of docs) {
			const done =
				input.step === "served" ? order.servedAt : order.tableClearedAt;
			if (done) continue;
			const check = checkAtTable(order, input.step);
			if (!check.ok) return { ok: false as const, error: check.error };
			todo.push({ order, complete: check.complete });
		}
		for (const { order, complete } of todo) {
			const next: Order = {
				...order,
				servedAt: order.servedAt ?? at,
				...(input.step === "cleared" && { tableClearedAt: at }),
				...(complete && {
					fulfillmentStatus: "completed" as const,
					completedAt: at,
				}),
			};
			const payload: OrderAtTable = { orderId: order.id, step: input.step };
			await enqueue(tx, {
				kind: "order.atTable",
				entityId: order.id,
				memberId: input.memberId,
				payload,
				now,
			});
			await tx.run(
				"UPDATE orders SET fulfillment_status = ?, doc = ? WHERE id = ?",
				[next.fulfillmentStatus, JSON.stringify(next), order.id],
			);
		}
		return { ok: true as const };
	});
}

/**
 * Move every open order at one table to another. When the other table is
 * busy this merges the two: one table, one set of orders. Each order gets
 * its own order.setTable, queued with the local change in one transaction.
 */
export async function moveTable(
	db: SqlDriver,
	input: {
		orderIds: readonly string[];
		to: string;
		memberId: string;
		at?: number;
	},
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
	const to = input.to.trim();
	if (!to || to.length > 20) return { ok: false, error: "bad_table" };
	const now = new Date(input.at ?? Date.now());
	return db.transaction(async (tx) => {
		let moved = 0;
		for (const id of input.orderIds) {
			const [row] = await tx.all<{ doc: string }>(
				"SELECT doc FROM orders WHERE id = ?",
				[id],
			);
			if (!row) continue;
			const order = JSON.parse(row.doc) as Order;
			if (
				order.fulfillmentStatus === "cancelled" ||
				order.type !== "dine_in" ||
				order.tableLabel === to
			)
				continue;
			const payload: SetOrderTable = { orderId: id, tableLabel: to };
			await enqueue(tx, {
				kind: "order.setTable",
				entityId: id,
				memberId: input.memberId,
				payload,
				now,
			});
			await tx.run("UPDATE orders SET doc = ? WHERE id = ?", [
				JSON.stringify({ ...order, tableLabel: to }),
				id,
			]);
			moved += 1;
		}
		return { ok: true as const, moved };
	});
}

/** Put a server on a table, or take them off (null). */
export async function assignServer(
	db: SqlDriver,
	input: {
		tableId: string;
		serverId: string | null;
		memberId: string;
		at?: number;
	},
): Promise<void> {
	await db.transaction(async (tx) => {
		const payload: AssignTable = {
			tableId: input.tableId,
			memberId: input.serverId,
		};
		await enqueue(tx, {
			kind: "table.assign",
			entityId: input.tableId,
			memberId: input.memberId,
			payload,
			now: new Date(input.at ?? Date.now()),
		});
	});
}
