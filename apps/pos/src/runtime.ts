import { Capacitor } from "@capacitor/core";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { SqlDriver } from "./db/driver.js";
import { migrate } from "./db/migrations.js";

/**
 * Opens the local database: durable native SQLite on a tablet, in-memory
 * sql.js in a desktop browser (dev only, data is gone on reload).
 */
export async function openLocalDb(): Promise<SqlDriver> {
	let db: SqlDriver;
	if (Capacitor.isNativePlatform()) {
		const { openCapacitorSqlite } = await import("./db/capacitor-driver.js");
		db = await openCapacitorSqlite();
	} else {
		const { openSqlJs } = await import("./db/sqljs-driver.js");
		db = await openSqlJs({ locateFile: () => wasmUrl });
	}
	await migrate(db);
	return db;
}
