import type { LocationRole, StaffListItem } from "@bite/contracts";
import type { SqlExecutor } from "../db/driver.js";
import { checkVerifier, makeVerifier, OFFLINE_PIN_MAX_AGE_MS } from "./pin.js";

export type StaffMember = {
	memberId: string;
	displayName: string;
	role: LocationRole;
};

export type LoginResult =
	| { ok: true; member: StaffMember; offline: boolean }
	| {
			ok: false;
			reason:
				| "wrong_pin"
				| "offline_unknown"
				| "offline_expired"
				| "rate_limited"
				| "error";
			message?: string;
	  };

type StaffRow = {
	member_id: string;
	display_name: string;
	role: string;
	pin_salt: string | null;
	pin_verifier: string | null;
	verified_at: number | null;
};

export async function cacheStaffList(db: SqlExecutor, staff: StaffListItem[]) {
	for (const s of staff) {
		await db.run(
			`INSERT INTO staff (member_id, display_name, role) VALUES (?, ?, ?)
			 ON CONFLICT (member_id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role`,
			[s.memberId, s.displayName, s.role],
		);
	}
	// Removed from the location: forget them, including their offline verifier.
	const keep = staff.map((s) => s.memberId);
	await db.run(
		`DELETE FROM staff WHERE member_id NOT IN (${keep.map(() => "?").join(",") || "''"})`,
		keep,
	);
}

export async function listCachedStaff(db: SqlExecutor): Promise<StaffMember[]> {
	const rows = await db.all<StaffRow>(
		"SELECT * FROM staff ORDER BY display_name",
	);
	return rows.map((r) => ({
		memberId: r.member_id,
		displayName: r.display_name,
		role: r.role as LocationRole,
	}));
}

/** Offline has no server-side limiter, so throttle locally: 5 misses = 5 minute lock. */
const offlineMisses = new Map<string, { count: number; until: number }>();
const MAX_MISSES = 5;
const LOCK_MS = 5 * 60 * 1000;

/**
 * Online first; if the server can't be reached, fall back to the verifier
 * from this person's last online login on this tablet.
 */
export async function pinLogin(
	db: SqlExecutor,
	online: (memberId: string, pin: string) => Promise<StaffMember>,
	memberId: string,
	pin: string,
	now = Date.now(),
): Promise<LoginResult> {
	try {
		const member = await online(memberId, pin);
		const { salt, verifier } = await makeVerifier(pin);
		await db.run(
			`INSERT INTO staff (member_id, display_name, role, pin_salt, pin_verifier, verified_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (member_id) DO UPDATE SET display_name = excluded.display_name,
			   role = excluded.role, pin_salt = excluded.pin_salt,
			   pin_verifier = excluded.pin_verifier, verified_at = excluded.verified_at`,
			[member.memberId, member.displayName, member.role, salt, verifier, now],
		);
		return { ok: true, member, offline: false };
	} catch (err) {
		const status = (err as { status?: number }).status;
		if (status === 401) {
			// The server said no. A stale local verifier must not override that.
			await db.run(
				"UPDATE staff SET pin_verifier = NULL, pin_salt = NULL WHERE member_id = ?",
				[memberId],
			);
			return { ok: false, reason: "wrong_pin" };
		}
		if (status === 429) return { ok: false, reason: "rate_limited" };
		if (status !== undefined && status !== 0 && status < 500) {
			return { ok: false, reason: "error", message: (err as Error).message };
		}
	}
	// Network failure or 5xx: offline unlock.
	const miss = offlineMisses.get(memberId);
	if (miss && miss.count >= MAX_MISSES && now < miss.until) {
		return { ok: false, reason: "rate_limited" };
	}
	const [row] = await db.all<StaffRow>(
		"SELECT * FROM staff WHERE member_id = ?",
		[memberId],
	);
	if (!row?.pin_salt || !row.pin_verifier || row.verified_at === null) {
		return { ok: false, reason: "offline_unknown" };
	}
	if (now - row.verified_at > OFFLINE_PIN_MAX_AGE_MS)
		return { ok: false, reason: "offline_expired" };
	if (!(await checkVerifier(pin, row.pin_salt, row.pin_verifier))) {
		const count = (miss && now < miss.until ? miss.count : 0) + 1;
		offlineMisses.set(memberId, { count, until: now + LOCK_MS });
		return { ok: false, reason: "wrong_pin" };
	}
	offlineMisses.delete(memberId);
	return {
		ok: true,
		offline: true,
		member: {
			memberId: row.member_id,
			displayName: row.display_name,
			role: row.role as LocationRole,
		},
	};
}
