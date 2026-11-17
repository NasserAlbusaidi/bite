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
	{
		version: 3,
		sql: `
-- Payments and refunds this tablet recorded, so it can refund them later and
-- add up its own drawer. The pulled Order carries no payments, so this is the
-- only ledger the tablet has. outbox_id ties a row to the mutation that sent
-- it: a row whose mutation was rejected never happened on the server.
CREATE TABLE payments (
	id                  TEXT PRIMARY KEY,
	order_id            TEXT NOT NULL,
	outbox_id           TEXT NOT NULL,
	amount              INTEGER NOT NULL,                -- negative = refund
	tip                 INTEGER NOT NULL DEFAULT 0,
	tendered            INTEGER,
	method              TEXT NOT NULL,
	session_id          TEXT,                            -- drawer open on this tablet at the time, any method
	reverses_payment_id TEXT,
	reason              TEXT,
	member_id           TEXT NOT NULL,
	business_date       TEXT NOT NULL,
	created_at          TEXT NOT NULL
);
CREATE INDEX payments_order ON payments (order_id);
CREATE INDEX payments_session ON payments (session_id);

CREATE TABLE cash_movements (
	id          TEXT PRIMARY KEY,
	session_id  TEXT NOT NULL,
	outbox_id   TEXT NOT NULL,
	kind        TEXT NOT NULL CHECK (kind IN ('pay_in','pay_out','drop')),
	amount      INTEGER NOT NULL,
	reason      TEXT NOT NULL,
	member_id   TEXT NOT NULL,
	created_at  TEXT NOT NULL
);
CREATE INDEX cash_movements_session ON cash_movements (session_id);

ALTER TABLE cash_sessions ADD COLUMN closed_by TEXT;
ALTER TABLE cash_sessions ADD COLUMN counted_cash INTEGER;
ALTER TABLE cash_sessions ADD COLUMN expected_cash INTEGER;

-- A rejected change a manager has looked at and set aside. It stays in the
-- outbox (and keeps blocking later changes to the same record) but stops
-- nagging in the sync badge.
ALTER TABLE outbox ADD COLUMN dismissed_at TEXT;
`,
	},
	{
		version: 4,
		sql: `
-- A drawer adopted from the server (the tablet was re-paired or reset while
-- it was open) arrives with cash this tablet never saw: sales, tips and
-- movements rung before. It counts toward expected cash like the float.
ALTER TABLE cash_sessions ADD COLUMN carried_cash INTEGER NOT NULL DEFAULT 0;
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
