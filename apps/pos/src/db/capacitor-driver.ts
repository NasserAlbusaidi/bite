import {
	CapacitorSQLite,
	SQLiteConnection,
	type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import {
	Mutex,
	type Row,
	type SqlDriver,
	type SqlExecutor,
	type SqlValue,
} from "./driver.js";

/**
 * On-device SQLite (Android and iOS). Durable, survives app kills, which is
 * the whole point of the outbox.
 *
 * Not exercised by CI (needs a device). The plugin's own transaction flag is
 * turned off on every call so BEGIN/COMMIT stay under our control.
 */
export async function openCapacitorSqlite(
	name = "bite_pos",
): Promise<SqlDriver> {
	const sqlite = new SQLiteConnection(CapacitorSQLite);
	const existing = (await sqlite.isConnection(name, false)).result;
	const conn = existing
		? await sqlite.retrieveConnection(name, false)
		: await sqlite.createConnection(name, false, "no-encryption", 1, false);
	await conn.open();
	await conn.execute(
		"PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;",
		false,
	);
	return new CapacitorDriver(sqlite, conn, name);
}

class CapacitorDriver implements SqlDriver {
	private readonly mutex = new Mutex();

	constructor(
		private readonly sqlite: SQLiteConnection,
		private readonly conn: SQLiteDBConnection,
		private readonly name: string,
	) {}

	private readonly exec: SqlExecutor = {
		run: async (sql, params = []) => {
			await this.conn.run(sql, [...params], false);
		},
		all: async <T extends Row>(
			sql: string,
			params: readonly SqlValue[] = [],
		) => {
			const res = await this.conn.query(sql, [...params]);
			return (res.values ?? []) as T[];
		},
	};

	run(sql: string, params?: readonly SqlValue[]) {
		return this.mutex.lock(() => this.exec.run(sql, params));
	}

	all<T extends Row = Row>(sql: string, params?: readonly SqlValue[]) {
		return this.mutex.lock(() => this.exec.all<T>(sql, params));
	}

	async execScript(sql: string) {
		await this.mutex.lock(async () => {
			await this.conn.execute(sql, false);
		});
	}

	transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
		return this.mutex.lock(async () => {
			await this.conn.execute("BEGIN IMMEDIATE;", false);
			try {
				const out = await fn(this.exec);
				await this.conn.execute("COMMIT;", false);
				return out;
			} catch (err) {
				await this.conn.execute("ROLLBACK;", false);
				throw err;
			}
		});
	}

	async close() {
		await this.sqlite.closeConnection(this.name, false);
	}
}
