import type { SqlExecutor } from "../db/driver.js";
import { newId } from "../domain/ids.js";
import type { Mutation, MutationKind, PayloadOf } from "./wire.js";

export type OutboxStatus = "pending" | "applied" | "rejected" | "blocked";

/** Wire shape only, without local bookkeeping. */
export function toMutation(item: OutboxItem): Mutation {
	const { seq, status, attempts, nextAttemptAt, lastError, ...m } = item;
	return m;
}

export type OutboxItem = Mutation & {
	seq: number;
	status: OutboxStatus;
	attempts: number;
	nextAttemptAt: number;
	lastError: string | null;
};

type OutboxRow = {
	seq: number;
	id: string;
	kind: string;
	entity_id: string;
	base_version: number | null;
	member_id: string;
	payload: string;
	created_at: string;
	status: string;
	attempts: number;
	next_attempt_at: number;
	last_error: string | null;
};

/**
 * Queue a mutation. Takes the transaction executor on purpose: the local
 * write and its outbox row must commit together, or a crash between them
 * loses a sale (or syncs one that never happened locally).
 */
export async function enqueue<K extends MutationKind>(
	tx: SqlExecutor,
	m: {
		kind: K;
		entityId: string;
		memberId: string;
		payload: PayloadOf<K>;
		baseVersion?: number;
		id?: string;
		now?: Date;
	},
): Promise<Mutation> {
	const mutation = {
		id: m.id ?? newId(),
		kind: m.kind,
		entityId: m.entityId,
		memberId: m.memberId,
		payload: m.payload,
		createdAt: (m.now ?? new Date()).toISOString(),
		...(m.baseVersion !== undefined && { baseVersion: m.baseVersion }),
	} as Mutation;
	await tx.run(
		`INSERT INTO outbox (id, kind, entity_id, base_version, member_id, payload, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			mutation.id,
			mutation.kind,
			mutation.entityId,
			mutation.baseVersion ?? null,
			mutation.memberId,
			JSON.stringify(mutation.payload),
			mutation.createdAt,
		],
	);
	return mutation;
}

export async function listOutbox(
	db: SqlExecutor,
	statuses: readonly OutboxStatus[] = ["pending", "rejected", "blocked"],
): Promise<OutboxItem[]> {
	const rows = await db.all<OutboxRow>(
		`SELECT * FROM outbox WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY seq`,
		statuses,
	);
	return rows.map(fromRow);
}

export function fromRow(r: OutboxRow): OutboxItem {
	return {
		seq: r.seq,
		id: r.id,
		kind: r.kind as MutationKind,
		entityId: r.entity_id,
		memberId: r.member_id,
		...(r.base_version !== null && { baseVersion: r.base_version }),
		payload: JSON.parse(r.payload),
		createdAt: r.created_at,
		status: r.status as OutboxStatus,
		attempts: r.attempts,
		nextAttemptAt: r.next_attempt_at,
		lastError: r.last_error,
	};
}

export type { OutboxRow };
