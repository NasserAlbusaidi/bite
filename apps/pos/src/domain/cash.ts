import type {
	CashMovement,
	CashMovementKind,
	CloseCashSession,
	OpenCashSession,
	OpenDrawer,
	PaymentMethod,
} from "@bite/contracts";
import { businessDate } from "@bite/core";
import type { SqlDriver, SqlExecutor } from "../db/driver.js";
import { enqueue } from "../sync/outbox.js";
import { newId } from "./ids.js";
import { sessionPayments } from "./ledger.js";

export type CashSession = {
	id: string;
	businessDate: string;
	openingFloat: number;
	openedBy: string;
	openedAt: string;
};

export async function openSession(db: SqlDriver): Promise<CashSession | null> {
	const [r] = await db.all<{
		id: string;
		business_date: string;
		opening_float: number;
		opened_by: string;
		opened_at: string;
	}>(
		"SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
	);
	return r
		? {
				id: r.id,
				businessDate: r.business_date,
				openingFloat: r.opening_float,
				openedBy: r.opened_by,
				openedAt: r.opened_at,
			}
		: null;
}

/**
 * The server still has a drawer open for this device that this tablet doesn't
 * know about (re-paired, reset, or the app's storage was wiped). Take it over
 * instead of opening a second one, which the server would refuse, and which
 * would then make every cash sale bounce after the customer paid.
 *
 * A local drawer whose cash.open the server rejected (opened before the first
 * pull landed) is set aside for the server's one. A local drawer the server
 * accepted is never touched. Nothing is queued: the session already exists.
 * Returns true when the tablet's open drawer changed.
 */
export async function adoptCashSession(
	db: SqlDriver,
	server: OpenDrawer | null | undefined,
	at: number,
): Promise<boolean> {
	if (!server) return false;
	return db.transaction(async (tx) => {
		const [known] = await tx.all<{ id: string }>(
			"SELECT id FROM cash_sessions WHERE id = ?",
			[server.id],
		);
		// Ours already, open or closed with the close still on its way.
		if (known) return false;
		const local = await tx.all<{ id: string; refused: number }>(
			`SELECT s.id, EXISTS (
			   SELECT 1 FROM outbox o WHERE o.kind = 'cash.open'
			   AND o.entity_id = s.id AND o.status = 'rejected') AS refused
			 FROM cash_sessions s WHERE s.closed_at IS NULL`,
		);
		if (local.some((s) => !s.refused)) return false;
		for (const s of local)
			await tx.run(
				"UPDATE cash_sessions SET closed_at = ?, expected_cash = 0, counted_cash = 0 WHERE id = ?",
				[new Date(at).toISOString(), s.id],
			);
		await tx.run(
			`INSERT INTO cash_sessions (id, business_date, opening_float, opened_by, opened_at, carried_cash)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[
				server.id,
				server.businessDate,
				server.openingFloat,
				server.openedBy,
				server.openedAt,
				server.cashSoFar,
			],
		);
		return true;
	});
}

/** Open the drawer with a float. One open session per device (the server enforces it too). */
export async function openCashSession(
	db: SqlDriver,
	input: {
		openingFloat: number;
		memberId: string;
		at: number;
		timeZone: string;
		dayCutoffMinutes: number;
	},
): Promise<CashSession> {
	if (await openSession(db))
		throw new Error("A cash session is already open on this tablet");
	const s: CashSession = {
		id: newId(),
		businessDate: businessDate(
			input.at,
			input.timeZone,
			input.dayCutoffMinutes,
		),
		openingFloat: input.openingFloat,
		openedBy: input.memberId,
		openedAt: new Date(input.at).toISOString(),
	};
	await db.transaction(async (tx) => {
		await tx.run(
			"INSERT INTO cash_sessions (id, business_date, opening_float, opened_by, opened_at) VALUES (?, ?, ?, ?, ?)",
			[s.id, s.businessDate, s.openingFloat, s.openedBy, s.openedAt],
		);
		const payload: OpenCashSession = {
			id: s.id,
			businessDate: s.businessDate,
			openingFloat: s.openingFloat,
		};
		await enqueue(tx, {
			kind: "cash.open",
			entityId: s.id,
			memberId: input.memberId,
			payload,
			now: new Date(input.at),
		});
	});
	return s;
}

export type MovementInput = {
	sessionId: string;
	kind: CashMovementKind;
	/** Positive. */
	amount: number;
	reason: string;
	memberId: string;
	at?: number;
};

/** Pay in, pay out or a safe drop. Recorded locally for the report and queued as cash.movement. */
export async function addCashMovement(
	db: SqlDriver,
	input: MovementInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
		return { ok: false, error: "amount_not_positive" };
	if (!input.reason.trim()) return { ok: false, error: "reason_required" };
	const at = new Date(input.at ?? Date.now());
	return db.transaction(async (tx) => {
		const [open] = await tx.all<{ id: string }>(
			"SELECT id FROM cash_sessions WHERE id = ? AND closed_at IS NULL",
			[input.sessionId],
		);
		if (!open) return { ok: false as const, error: "session_closed" };
		const payload: CashMovement = {
			id: newId(),
			cashSessionId: input.sessionId,
			kind: input.kind,
			amount: input.amount,
			reason: input.reason.trim(),
		};
		const m = await enqueue(tx, {
			kind: "cash.movement",
			entityId: input.sessionId,
			memberId: input.memberId,
			payload,
			now: at,
		});
		await tx.run(
			`INSERT INTO cash_movements (id, session_id, outbox_id, kind, amount, reason, member_id, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				payload.id,
				input.sessionId,
				m.id,
				payload.kind,
				payload.amount,
				payload.reason,
				input.memberId,
				at.toISOString(),
			],
		);
		return { ok: true as const };
	});
}

export type MethodTotals = { sales: number; refunds: number; count: number };

/**
 * X report (drawer still open) or Z report (closed). Built from this tablet's
 * own ledger with the server's formula for expected cash:
 * float + cash payments and tips - cash refunds + pay ins - pay outs - drops.
 */
export type SessionReport = {
	session: CashSession & {
		closedAt: string | null;
		closedBy: string | null;
		countedCash: number | null;
	};
	byMethod: Partial<Record<PaymentMethod, MethodTotals>>;
	tips: number;
	orders: number;
	payIns: number;
	payOuts: number;
	drops: number;
	/** Cash already in an adopted drawer before this tablet took it over. */
	carried: number;
	expectedCash: number;
	/** counted - expected, once counted. */
	variance: number | null;
	/** Rows still waiting to sync. The server's own figure may differ until they land. */
	unsynced: number;
};

export async function sessionReport(
	db: SqlExecutor,
	sessionId: string,
): Promise<SessionReport | null> {
	const [s] = await db.all<{
		id: string;
		business_date: string;
		opening_float: number;
		opened_by: string;
		opened_at: string;
		closed_at: string | null;
		closed_by: string | null;
		counted_cash: number | null;
		carried_cash: number;
	}>("SELECT * FROM cash_sessions WHERE id = ?", [sessionId]);
	if (!s) return null;
	const payments = await sessionPayments(db, sessionId);
	const byMethod: Partial<Record<PaymentMethod, MethodTotals>> = {};
	let tips = 0;
	let cashIn = 0;
	const orders = new Set<string>();
	for (const p of payments) {
		const t = byMethod[p.method] ?? { sales: 0, refunds: 0, count: 0 };
		byMethod[p.method] = t;
		if (p.amount > 0) {
			t.sales += p.amount;
			t.count++;
			orders.add(p.orderId);
		} else {
			t.refunds -= p.amount;
		}
		tips += p.tip;
		if (p.method === "cash") cashIn += p.amount + p.tip;
	}
	const moves = await db.all<{ kind: CashMovementKind; total: number }>(
		`SELECT m.kind, SUM(m.amount) AS total FROM cash_movements m
		 LEFT JOIN outbox o ON o.id = m.outbox_id
		 WHERE m.session_id = ? AND (o.status IS NULL OR o.status != 'rejected')
		 GROUP BY m.kind`,
		[sessionId],
	);
	const mv = (k: CashMovementKind) =>
		moves.find((m) => m.kind === k)?.total ?? 0;
	const expectedCash =
		s.opening_float +
		s.carried_cash +
		cashIn +
		mv("pay_in") -
		mv("pay_out") -
		mv("drop");
	const [u] = await db.all<{ n: number }>(
		`SELECT COUNT(*) AS n FROM outbox WHERE status != 'applied' AND (
		   entity_id = ? OR id IN (SELECT outbox_id FROM payments WHERE session_id = ?))`,
		[sessionId, sessionId],
	);
	return {
		session: {
			id: s.id,
			businessDate: s.business_date,
			openingFloat: s.opening_float,
			openedBy: s.opened_by,
			openedAt: s.opened_at,
			closedAt: s.closed_at,
			closedBy: s.closed_by,
			countedCash: s.counted_cash,
		},
		byMethod,
		tips,
		orders: orders.size,
		payIns: mv("pay_in"),
		payOuts: mv("pay_out"),
		drops: mv("drop"),
		carried: s.carried_cash,
		expectedCash,
		variance: s.counted_cash === null ? null : s.counted_cash - expectedCash,
		unsynced: u?.n ?? 0,
	};
}

/** Close the drawer with the counted cash. Returns the Z report. */
export async function closeCashSession(
	db: SqlDriver,
	input: {
		sessionId: string;
		countedCash: number;
		memberId: string;
		at: number;
		notes?: string;
		countDetail?: Record<string, number>;
	},
): Promise<SessionReport> {
	if (!Number.isSafeInteger(input.countedCash) || input.countedCash < 0)
		throw new RangeError("Counted cash must be a whole amount >= 0");
	await db.transaction(async (tx) => {
		const before = await sessionReport(tx, input.sessionId);
		if (!before || before.session.closedAt)
			throw new Error("This drawer is not open");
		await tx.run(
			`UPDATE cash_sessions SET closed_at = ?, closed_by = ?, counted_cash = ?, expected_cash = ?
			 WHERE id = ? AND closed_at IS NULL`,
			[
				new Date(input.at).toISOString(),
				input.memberId,
				input.countedCash,
				before.expectedCash,
				input.sessionId,
			],
		);
		const payload: CloseCashSession = {
			cashSessionId: input.sessionId,
			countedCash: input.countedCash,
			...(input.notes && { notes: input.notes }),
			...(input.countDetail && { countDetail: input.countDetail }),
		};
		await enqueue(tx, {
			kind: "cash.close",
			entityId: input.sessionId,
			memberId: input.memberId,
			payload,
			now: new Date(input.at),
		});
	});
	const z = await sessionReport(db, input.sessionId);
	if (!z) throw new Error("Session vanished");
	return z;
}

/** Recent sessions on this tablet, newest first, for reprinting a Z report. */
export async function recentSessions(
	db: SqlExecutor,
	limit = 14,
): Promise<
	{
		id: string;
		businessDate: string;
		openedAt: string;
		closedAt: string | null;
	}[]
> {
	const rows = await db.all<{
		id: string;
		business_date: string;
		opened_at: string;
		closed_at: string | null;
	}>(
		"SELECT id, business_date, opened_at, closed_at FROM cash_sessions ORDER BY opened_at DESC LIMIT ?",
		[limit],
	);
	return rows.map((r) => ({
		id: r.id,
		businessDate: r.business_date,
		openedAt: r.opened_at,
		closedAt: r.closed_at,
	}));
}
