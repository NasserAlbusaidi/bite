/**
 * The smallest SQL surface the POS needs. Two implementations:
 * - sql.js (WASM) for the browser dev build and for tests
 * - @capacitor-community/sqlite on the tablet (Android and iOS both)
 *
 * Everything above this file is platform agnostic.
 */
export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, SqlValue>;

export interface SqlExecutor {
	run(sql: string, params?: readonly SqlValue[]): Promise<void>;
	all<T extends Row = Row>(
		sql: string,
		params?: readonly SqlValue[],
	): Promise<T[]>;
}

export interface SqlDriver extends SqlExecutor {
	/** Multi-statement DDL, no params. */
	execScript(sql: string): Promise<void>;
	/**
	 * Run fn atomically. Transactions are serialized: SQLite has one writer and
	 * a single connection, so concurrent callers queue instead of nesting.
	 */
	transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

/** FIFO async lock so overlapping transactions never interleave on one connection. */
export class Mutex {
	private tail: Promise<void> = Promise.resolve();

	async lock<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.tail;
		let release!: () => void;
		this.tail = new Promise((r) => {
			release = r;
		});
		await prev;
		try {
			return await fn();
		} finally {
			release();
		}
	}
}
