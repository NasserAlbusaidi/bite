import type {
	AssignTable,
	Floor,
	FloorTable,
	Order,
	SetOrderTable,
} from "@bite/contracts";
import { isTab, type Minor } from "@bite/core";
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
 * - to_pay: a guest QR order waiting to be paid before the kitchen starts,
 *   or everything served and money still due
 * - cooking: the kitchen is on it
 * - ordered: in, the kitchen hasn't started
 * - free: nothing open
 */
export type TableStatus = "ready" | "to_pay" | "cooking" | "ordered" | "free";

export type TableState = {
	table: FloorTable;
	status: TableStatus;
	orders: TableOrder[];
	/** Still owed across the table's orders. */
	due: Minor;
	total: Minor;
	/** When the first open order came in (ISO), for "seated 25 min". */
	since: string | null;
};

export type TableOrder = { order: Order; due: Minor };

/** Orders still in play: not cancelled, and not both served and settled. */
async function openOrders(db: SqlExecutor): Promise<TableOrder[]> {
	const rows = await db.all<{ id: string }>(
		`SELECT id FROM orders
		 WHERE fulfillment_status != 'cancelled'
		   AND (fulfillment_status != 'completed' OR payment_status IN ('unpaid', 'partially_paid'))
		 ORDER BY placed_at`,
	);
	const out: TableOrder[] = [];
	for (const r of rows) {
		const d = await loadOrder(db, r.id);
		if (!d?.order.tableLabel || d.order.type !== "dine_in") continue;
		const done = d.order.fulfillmentStatus === "completed";
		if (done && d.summary.balanceDue <= 0) continue;
		out.push({ order: d.order, due: d.summary.balanceDue });
	}
	return out;
}

const keyOf = (label: string) => label.trim().toLowerCase();

export function statusOf(orders: readonly TableOrder[]): TableStatus {
	if (orders.length === 0) return "free";
	const f = (s: Order["fulfillmentStatus"]) =>
		orders.some((o) => o.order.fulfillmentStatus === s);
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
	return orders.some((o) => o.due > 0) ? "to_pay" : "free";
}

/** Every table on the plan with what is happening at it right now. */
export async function tableStates(
	db: SqlExecutor,
	floor: Floor,
): Promise<{ tables: TableState[]; unplaced: TableOrder[] }> {
	const open = await openOrders(db);
	const byLabel = new Map<string, TableOrder[]>();
	for (const o of open) {
		const k = keyOf(o.order.tableLabel ?? "");
		byLabel.set(k, [...(byLabel.get(k) ?? []), o]);
	}
	const tables = floor.tables.map((table) => {
		const orders = byLabel.get(keyOf(table.label)) ?? [];
		byLabel.delete(keyOf(table.label));
		return {
			table,
			status: statusOf(orders),
			orders,
			due: orders.reduce((s, o) => s + o.due, 0) as Minor,
			total: orders.reduce((s, o) => s + o.order.total, 0) as Minor,
			since: orders[0]?.order.placedAt ?? null,
		};
	});
	// Orders for a table number that isn't on the plan (typed by hand).
	return { tables, unplaced: [...byLabel.values()].flat() };
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
