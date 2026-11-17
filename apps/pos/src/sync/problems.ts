import type { SqlDriver, SqlExecutor } from "../db/driver.js";
import { newId } from "../domain/ids.js";
import { fromRow, type OutboxItem, type OutboxRow } from "./outbox.js";
import type { MutationResult } from "./wire.js";

/**
 * Everything the server refused, grouped by the record it was about (an
 * order, a drawer session, a product). One group = one thing a human has to
 * decide on.
 */
export type ProblemGroup = {
	entityId: string;
	/** Ticket number when the record is an order this tablet knows. */
	ticketNumber: string | null;
	items: (OutboxItem & {
		result: MutationResult | null;
		/** "conflict" means someone else changed it first: safe to re-send on top. */
		reason: "rejected" | "conflict" | "blocked";
	})[];
	/** True when every refusal in the group was a conflict, so re-sending can work. */
	retryable: boolean;
};

type Row = OutboxRow & { result: string | null; ticket_number: string | null };

export async function listProblems(db: SqlExecutor): Promise<ProblemGroup[]> {
	const rows = await db.all<Row>(
		`SELECT x.*, o.ticket_number FROM outbox x
		 LEFT JOIN orders o ON o.id = x.entity_id
		 WHERE x.status IN ('rejected', 'blocked') AND x.dismissed_at IS NULL
		 ORDER BY x.seq`,
	);
	const groups = new Map<string, ProblemGroup>();
	for (const r of rows) {
		const result = r.result ? (JSON.parse(r.result) as MutationResult) : null;
		const reason =
			r.status === "blocked"
				? "blocked"
				: result?.status === "conflict"
					? "conflict"
					: "rejected";
		let g = groups.get(r.entity_id);
		if (!g) {
			g = {
				entityId: r.entity_id,
				ticketNumber: r.ticket_number,
				items: [],
				retryable: true,
			};
			groups.set(r.entity_id, g);
		}
		g.items.push({ ...fromRow(r), result, reason });
		if (reason === "rejected") g.retryable = false;
	}
	return [...groups.values()];
}

/**
 * Re-send a group whose refusals were all conflicts (or blocks behind one).
 * A conflict was recorded server side under its id, so it goes again under a
 * NEW id and without baseVersion: the cashier has seen the newer state by
 * now. Blocked rows were never recorded and keep their ids.
 */
export async function retryProblem(
	db: SqlDriver,
	entityId: string,
): Promise<{ ok: true; requeued: number } | { ok: false; error: string }> {
	return db.transaction(async (tx) => {
		const rows = await tx.all<{
			seq: number;
			status: string;
			result: string | null;
		}>(
			`SELECT seq, status, result FROM outbox
			 WHERE entity_id = ? AND status IN ('rejected', 'blocked') AND dismissed_at IS NULL
			 ORDER BY seq`,
			[entityId],
		);
		for (const r of rows) {
			const status = r.result
				? (JSON.parse(r.result) as MutationResult).status
				: null;
			if (r.status === "rejected" && status !== "conflict")
				return { ok: false as const, error: "rejected_cannot_retry" };
		}
		for (const r of rows) {
			if (r.status === "rejected") {
				await tx.run(
					`UPDATE outbox SET id = ?, status = 'pending', base_version = NULL, attempts = 0,
					   next_attempt_at = 0, last_error = NULL, result = NULL WHERE seq = ?`,
					[newId(), r.seq],
				);
			} else {
				await tx.run(
					`UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = 0,
					   last_error = NULL WHERE seq = ?`,
					[r.seq],
				);
			}
		}
		return { ok: true as const, requeued: rows.length };
	});
}

/**
 * A manager has read the problem and dealt with it by hand (re-rang the
 * sale, recounted). The refused rows stay for the record but stop alerting
 * and stop blocking. Rows that were only waiting behind them go out again
 * under their own ids (the server never recorded them), so a drawer close
 * stuck behind a refused pay-out still reaches the server. If one of those
 * makes no sense without the refused change, the server refuses it too and
 * it shows up here on its own.
 */
export async function dismissProblem(
	db: SqlDriver,
	entityId: string,
	at = Date.now(),
): Promise<{ dismissed: number; resent: number }> {
	return db.transaction(async (tx) => {
		const [d] = await tx.all<{ n: number }>(
			"SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ? AND status = 'rejected' AND dismissed_at IS NULL",
			[entityId],
		);
		const [b] = await tx.all<{ n: number }>(
			"SELECT COUNT(*) AS n FROM outbox WHERE entity_id = ? AND status = 'blocked'",
			[entityId],
		);
		await tx.run(
			"UPDATE outbox SET dismissed_at = ? WHERE entity_id = ? AND status = 'rejected' AND dismissed_at IS NULL",
			[new Date(at).toISOString(), entityId],
		);
		await tx.run(
			`UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL
			 WHERE entity_id = ? AND status = 'blocked'`,
			[entityId],
		);
		return { dismissed: d?.n ?? 0, resent: b?.n ?? 0 };
	});
}
