import type { SqlDriver, SqlExecutor } from "../db/driver.js";
import type { MutationResult } from "./contracts-stub.js";
import { fromRow, type OutboxRow, toMutation } from "./outbox.js";
import type { SyncTransport } from "./transport.js";

export type FlushSummary = {
	applied: number;
	rejected: number;
	blocked: number;
	/** Pending rows left after this flush. */
	remaining: number;
	/** Set when the transport failed; the queue is untouched apart from backoff. */
	error: unknown;
};

export type ReplayerOptions = {
	db: SqlDriver;
	transport: SyncTransport;
	deviceId: string;
	batchSize?: number;
	now?: () => number;
	/** Delay before retry number `attempt` (1-based). */
	backoffMs?: (attempt: number) => number;
};

export const defaultBackoff = (attempt: number) =>
	Math.min(2_000 * 2 ** (attempt - 1), 60_000);

/**
 * Replays the outbox to the server.
 *
 * Guarantees:
 * - Strict FIFO. A transient failure stops the whole queue, so a payment can
 *   never land before the order (or cash session) it belongs to.
 * - Idempotent. The mutation id is the idempotency key; replaying after a
 *   lost response gets "duplicate" back, which counts as success.
 * - Nothing is ever dropped silently. A rejected or conflicting mutation is
 *   parked with its error, and every later mutation for the same entity is
 *   parked as "blocked" so it can't apply on top of a state that never existed.
 *   Other entities keep flowing.
 * - Network and auth failures never reject anything; rows just back off.
 */
export class Replayer {
	private readonly batchSize: number;
	private readonly now: () => number;
	private readonly backoffMs: (attempt: number) => number;
	private inflight: Promise<FlushSummary> | null = null;

	constructor(private readonly opts: ReplayerOptions) {
		this.batchSize = opts.batchSize ?? 50;
		this.now = opts.now ?? Date.now;
		this.backoffMs = opts.backoffMs ?? defaultBackoff;
	}

	/** Single flight: concurrent callers share one run. */
	flush(): Promise<FlushSummary> {
		this.inflight ??= this.run().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	private async run(): Promise<FlushSummary> {
		const { db } = this.opts;
		const summary: FlushSummary = {
			applied: 0,
			rejected: 0,
			blocked: 0,
			remaining: 0,
			error: null,
		};

		for (;;) {
			summary.blocked += await db.transaction(blockOrphans);

			const batch = (
				await db.all<OutboxRow>(
					"SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?",
					[this.batchSize],
				)
			).map(fromRow);
			const head = batch[0];
			if (!head || head.nextAttemptAt > this.now()) break;

			let results: MutationResult[];
			try {
				const res = await this.opts.transport.push({
					deviceId: this.opts.deviceId,
					mutations: batch.map(toMutation),
				});
				results = res.results;
			} catch (err) {
				summary.error = err;
				await this.backOff(head.attempts + 1, errorText(err));
				break;
			}

			const byId = new Map(results.map((r) => [r.id, r]));
			let missing = false;
			await db.transaction(async (tx) => {
				// The server answered, so the link is healthy again: reset backoff.
				await tx.run(
					"UPDATE outbox SET attempts = 0, next_attempt_at = 0 WHERE status = 'pending'",
				);
				for (const item of batch) {
					const r = byId.get(item.id);
					if (!r) {
						missing = true;
						continue;
					}
					if (r.status === "applied" || r.status === "duplicate") {
						await tx.run(
							"UPDATE outbox SET status = 'applied', result = ?, last_error = NULL WHERE id = ?",
							[JSON.stringify(r), item.id],
						);
						summary.applied++;
					} else if (r.status === "blocked") {
						// Not recorded server side; same id can be re-pushed once the blocker is resolved.
						await tx.run(
							"UPDATE outbox SET status = 'blocked', last_error = ? WHERE id = ?",
							[describe(r), item.id],
						);
						summary.blocked++;
					} else {
						await tx.run(
							"UPDATE outbox SET status = 'rejected', result = ?, last_error = ? WHERE id = ?",
							[JSON.stringify(r), describe(r), item.id],
						);
						summary.rejected++;
					}
				}
			});

			if (missing) {
				// Server skipped some ids (partial processing). Treat as transient.
				const err = new Error("Server returned no result for some mutations");
				summary.error = err;
				await this.backOff(head.attempts + 1, err.message);
				break;
			}
			if (batch.length < this.batchSize) break;
		}

		summary.blocked += await db.transaction(blockOrphans);
		const [left] = await db.all<{ n: number }>(
			"SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'",
		);
		summary.remaining = left?.n ?? 0;
		return summary;
	}

	private async backOff(attempt: number, error: string) {
		const until = this.now() + this.backoffMs(attempt);
		// Bump the whole pending queue, not only the head: FIFO means none of it can go first anyway.
		await this.opts.db.run(
			"UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE status = 'pending'",
			[until, error],
		);
	}
}

/** Park pending rows that sit behind a rejected/blocked row of the same entity. */
async function blockOrphans(tx: SqlExecutor): Promise<number> {
	const rows = await tx.all<{ seq: number }>(
		`SELECT p.seq FROM outbox p
		 WHERE p.status = 'pending' AND EXISTS (
			SELECT 1 FROM outbox r
			WHERE r.entity_id = p.entity_id AND r.seq < p.seq
			  AND r.status IN ('rejected', 'blocked'))`,
	);
	for (const { seq } of rows) {
		await tx.run(
			"UPDATE outbox SET status = 'blocked', last_error = 'blocked by an earlier rejected change to the same record' WHERE seq = ?",
			[seq],
		);
	}
	return rows.length;
}

function describe(r: MutationResult): string {
	return `${r.status}: ${r.error ? `${r.error.code} ${r.error.message}` : "no detail"}`;
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
