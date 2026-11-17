import type { SqlExecutor } from "./driver.js";

export async function kvGet(
	db: SqlExecutor,
	key: string,
): Promise<string | null> {
	const [row] = await db.all<{ value: string }>(
		"SELECT value FROM kv WHERE key = ?",
		[key],
	);
	return row?.value ?? null;
}

export async function kvSet(
	db: SqlExecutor,
	key: string,
	value: string,
): Promise<void> {
	await db.run(
		"INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
		[key, value],
	);
}
