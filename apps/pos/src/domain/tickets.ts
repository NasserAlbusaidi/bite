import type { SqlExecutor } from "../db/driver.js";

/**
 * Next ticket for this device and business day: "<prefix>-<seq>", e.g. "A-007".
 * The prefix is unique per location (devices.ticket_prefix), so offline
 * tablets can't collide. Call inside the same transaction as the order insert.
 */
export async function nextTicketNumber(
	tx: SqlExecutor,
	prefix: string,
	businessDate: string,
): Promise<string> {
	if (!/^[A-Z]{1,2}$/.test(prefix)) {
		throw new RangeError(
			`Ticket prefix must be 1-2 uppercase letters, got "${prefix}"`,
		);
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
		throw new RangeError(
			`Business date must be YYYY-MM-DD, got "${businessDate}"`,
		);
	}
	await tx.run(
		`INSERT INTO ticket_counters (business_date, last_seq) VALUES (?, 1)
		 ON CONFLICT (business_date) DO UPDATE SET last_seq = last_seq + 1`,
		[businessDate],
	);
	const [row] = await tx.all<{ last_seq: number }>(
		"SELECT last_seq FROM ticket_counters WHERE business_date = ?",
		[businessDate],
	);
	if (!row) throw new Error("ticket counter vanished");
	return `${prefix}-${String(row.last_seq).padStart(3, "0")}`;
}
