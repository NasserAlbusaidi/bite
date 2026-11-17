import type { CloseCashSession, OpenCashSession } from "@bite/contracts";
import { businessDate } from "@bite/core";
import type { SqlDriver } from "../db/driver.js";
import { enqueue } from "../sync/outbox.js";
import { newId } from "./ids.js";

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

export async function closeCashSession(
	db: SqlDriver,
	input: {
		sessionId: string;
		countedCash: number;
		memberId: string;
		at: number;
		notes?: string;
	},
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.run(
			"UPDATE cash_sessions SET closed_at = ? WHERE id = ? AND closed_at IS NULL",
			[new Date(input.at).toISOString(), input.sessionId],
		);
		const payload: CloseCashSession = {
			cashSessionId: input.sessionId,
			countedCash: input.countedCash,
			...(input.notes && { notes: input.notes }),
		};
		await enqueue(tx, {
			kind: "cash.close",
			entityId: input.sessionId,
			memberId: input.memberId,
			payload,
			now: new Date(input.at),
		});
	});
}
