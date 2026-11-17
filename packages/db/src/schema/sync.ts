import {
	foreignKey,
	index,
	jsonb,
	pgTable,
	primaryKey,
	text,
	uuid,
} from "drizzle-orm/pg-core";
import { appendOnlyPolicies, createdAt, orgId } from "./_shared.js";
import { devices, members } from "./tenancy.js";

/**
 * Idempotency ledger for offline outbox replay. One row per APPLIED or
 * REJECTED mutation, written in the same transaction as its effect, so a
 * mutation is recorded iff its outcome is final. Replaying the same id
 * returns `result` verbatim. Conflicts and "blocked" are not recorded:
 * they are retryable. Append-only for the app.
 */
export const syncMutations = pgTable(
	"sync_mutations",
	{
		/** Client UUIDv7 = idempotency key. */
		id: uuid("id").notNull(),
		orgId: orgId(),
		deviceId: uuid("device_id").notNull(),
		memberId: uuid("member_id").notNull(),
		kind: text("kind").notNull(),
		entityId: uuid("entity_id").notNull(),
		/** sha256 of the canonical mutation JSON. Same id + different body = rejected. */
		fingerprint: text("fingerprint").notNull(),
		/** The SyncMutationResult returned the first time. */
		result: jsonb("result").$type<Record<string, unknown>>().notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		// Scoped by org so one tenant's ids can never collide with (or probe) another's.
		primaryKey({ columns: [t.orgId, t.id] }),
		foreignKey({
			columns: [t.orgId, t.deviceId],
			foreignColumns: [devices.orgId, devices.id],
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.orgId, t.memberId],
			foreignColumns: [members.orgId, members.id],
		}).onDelete("restrict"),
		index("sync_mutations_entity_idx").on(t.orgId, t.entityId),
		index("sync_mutations_device_time_idx").on(t.deviceId, t.createdAt),
		...appendOnlyPolicies(),
	],
);
