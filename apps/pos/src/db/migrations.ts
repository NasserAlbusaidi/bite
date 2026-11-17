import type { SqlDriver } from "./driver.js";

/**
 * Local schema. Append only: never edit a shipped migration, tablets in the
 * field have already run it. The server schema lives in packages/db; this is
 * a device cache plus the outbox, not a mirror.
 */
export const MIGRATIONS: readonly { version: number; sql: string }[] = [
	{
		version: 1,
		sql: `
CREATE TABLE outbox (
	seq            INTEGER PRIMARY KEY AUTOINCREMENT, -- replay order
	id             TEXT NOT NULL UNIQUE,              -- UUIDv7, doubles as idempotency key
	kind           TEXT NOT NULL,
	entity_id      TEXT NOT NULL,
	base_version   INTEGER,
	member_id      TEXT NOT NULL,                     -- staff logged in when queued
	payload        TEXT NOT NULL,                     -- JSON
	created_at     TEXT NOT NULL,                     -- ISO 8601 UTC
	status         TEXT NOT NULL DEFAULT 'pending'
	               CHECK (status IN ('pending','applied','rejected','blocked')),
	attempts       INTEGER NOT NULL DEFAULT 0,
	next_attempt_at INTEGER NOT NULL DEFAULT 0,       -- epoch ms
	last_error     TEXT,
	result         TEXT                               -- JSON from the server
);
CREATE INDEX outbox_pending ON outbox (status, seq);
CREATE INDEX outbox_entity ON outbox (entity_id, status);

-- One counter per business day. Tickets are "<device prefix>-<seq>", so two
-- offline tablets never hand out the same number.
CREATE TABLE ticket_counters (
	business_date TEXT PRIMARY KEY,
	last_seq      INTEGER NOT NULL
);

CREATE TABLE kv (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`,
	},
	{
		version: 2,
		sql: `
-- Orders this tablet knows about: its own (written at sale time) and pulled
-- ones (QR, other tablets). The DTO is stored whole, as @bite/contracts Order.
CREATE TABLE orders (
	id                 TEXT PRIMARY KEY,
	ticket_number      TEXT NOT NULL,
	business_date      TEXT NOT NULL,
	fulfillment_status TEXT NOT NULL,
	payment_status     TEXT NOT NULL,
	placed_at          TEXT NOT NULL,
	version            INTEGER NOT NULL,                -- 0 = local only, not yet confirmed
	doc                TEXT NOT NULL
);
CREATE INDEX orders_day ON orders (business_date, placed_at);
CREATE INDEX orders_kitchen ON orders (fulfillment_status, placed_at);

-- One open drawer session per device, mirrored from what we pushed.
CREATE TABLE cash_sessions (
	id             TEXT PRIMARY KEY,
	business_date  TEXT NOT NULL,
	opening_float  INTEGER NOT NULL,
	opened_by      TEXT NOT NULL,
	opened_at      TEXT NOT NULL,
	closed_at      TEXT
);

-- Staff who logged in here online at least once. The verifier lets them
-- unlock while offline. It is a PBKDF2 hash made on this device, never the
-- server's PIN hash.
CREATE TABLE staff (
	member_id      TEXT PRIMARY KEY,
	display_name   TEXT NOT NULL,
	role           TEXT NOT NULL,
	pin_salt       TEXT,
	pin_verifier   TEXT,
	verified_at    INTEGER                           -- epoch ms of last online login
);
`,
	},
];

export async function migrate(db: SqlDriver): Promise<number> {
	await db.execScript(
		"CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
	);
	const [row] = await db.all<{ v: number | null }>(
		"SELECT MAX(version) AS v FROM schema_version",
	);
	let current = row?.v ?? 0;
	for (const m of MIGRATIONS) {
		if (m.version <= current) continue;
		await db.transaction(async (tx) => {
			for (const stmt of splitStatements(m.sql)) await tx.run(stmt);
			await tx.run("INSERT INTO schema_version (version) VALUES (?)", [
				m.version,
			]);
		});
		current = m.version;
	}
	return current;
}

/** Our migrations have no semicolons inside strings or triggers, so a naive split is enough. */
function splitStatements(sql: string): string[] {
	return sql
		.split(";")
		.map((s) =>
			s
				.split("\n")
				.filter((l) => !l.trim().startsWith("--"))
				.join("\n")
				.trim(),
		)
		.filter(Boolean);
}
