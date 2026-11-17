import type { SqlExecutor } from "../db/driver.js";

export type SyncCounts = { pending: number; attention: number };

/** What the sync badge shows: queued rows, and rows a human must look at. */
export async function syncCounts(db: SqlExecutor): Promise<SyncCounts> {
	const rows = await db.all<{ status: string; n: number }>(
		"SELECT status, COUNT(*) AS n FROM outbox WHERE status != 'applied' GROUP BY status",
	);
	let pending = 0;
	let attention = 0;
	for (const r of rows) {
		if (r.status === "pending") pending += r.n;
		else attention += r.n;
	}
	return { pending, attention };
}
