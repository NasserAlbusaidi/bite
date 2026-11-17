import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import {
	Mutex,
	type Row,
	type SqlDriver,
	type SqlExecutor,
	type SqlValue,
} from "./driver.js";

let sqlPromise: Promise<SqlJsStatic> | undefined;

/**
 * sql.js driver: in-memory SQLite in WASM. Used for `vite dev` in a browser
 * and for unit tests in Node. Not durable on its own; persistence on the
 * tablet comes from the Capacitor driver.
 */
export async function openSqlJs(opts?: {
	locateFile?: (file: string) => string;
}): Promise<SqlDriver> {
	sqlPromise ??= initSqlJs(
		opts?.locateFile ? { locateFile: opts.locateFile } : undefined,
	);
	const SQL = await sqlPromise;
	return new SqlJsDriver(new SQL.Database());
}

class SqlJsDriver implements SqlDriver {
	private readonly mutex = new Mutex();
	private inTx = false;

	constructor(private readonly db: Database) {
		db.run("PRAGMA foreign_keys = ON");
	}

	private readonly exec: SqlExecutor = {
		run: async (sql, params = []) => {
			this.db.run(sql, params as SqlValue[]);
		},
		all: async <T extends Row>(
			sql: string,
			params: readonly SqlValue[] = [],
		) => {
			const stmt = this.db.prepare(sql);
			try {
				stmt.bind(params as SqlValue[]);
				const rows: T[] = [];
				while (stmt.step()) rows.push(stmt.getAsObject() as T);
				return rows;
			} finally {
				stmt.free();
			}
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
			this.db.exec(sql);
		});
	}

	transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
		return this.mutex.lock(async () => {
			if (this.inTx) throw new Error("Nested transactions are not supported");
			this.inTx = true;
			this.db.run("BEGIN IMMEDIATE");
			try {
				const out = await fn(this.exec);
				this.db.run("COMMIT");
				return out;
			} catch (err) {
				this.db.run("ROLLBACK");
				throw err;
			} finally {
				this.inTx = false;
			}
		});
	}

	async close() {
		this.db.close();
	}
}
