import { beforeEach, describe, expect, it } from "vitest";
import type { SqlDriver } from "../db/driver.js";
import { migrate } from "../db/migrations.js";
import { openSqlJs } from "../db/sqljs-driver.js";
import { SyncHttpError } from "../sync/transport.js";
import { OFFLINE_PIN_MAX_AGE_MS } from "./pin.js";
import {
	cacheStaffList,
	listCachedStaff,
	pinLogin,
	type StaffMember,
} from "./staff.js";

const ALI: StaffMember = {
	memberId: "0190f000-0000-7000-8000-000000000a11",
	displayName: "Ali",
	role: "cashier",
};
const T0 = 1_800_000_000_000;

let db: SqlDriver;
beforeEach(async () => {
	db = await openSqlJs();
	await migrate(db);
});

const online = (pin: string) => async (_id: string, p: string) => {
	if (p !== pin) throw new SyncHttpError(401, "wrong PIN");
	return ALI;
};
const offline = async (): Promise<StaffMember> => {
	throw new TypeError("Failed to fetch");
};

describe("PIN login", () => {
	it("online login caches a verifier so the same PIN unlocks offline", async () => {
		expect(
			await pinLogin(db, online("1234"), ALI.memberId, "1234", T0),
		).toMatchObject({ ok: true, offline: false });
		expect(
			await pinLogin(db, offline, ALI.memberId, "1234", T0 + 1000),
		).toMatchObject({ ok: true, offline: true, member: ALI });
		expect(
			await pinLogin(db, offline, ALI.memberId, "9999", T0 + 2000),
		).toEqual({ ok: false, reason: "wrong_pin" });
	});

	it("never stores the PIN itself", async () => {
		await pinLogin(db, online("1234"), ALI.memberId, "1234", T0);
		const rows = await db.all("SELECT * FROM staff");
		expect(JSON.stringify(rows)).not.toContain("1234");
	});

	it("offline unlock needs a recent online login", async () => {
		expect(await pinLogin(db, offline, ALI.memberId, "1234", T0)).toEqual({
			ok: false,
			reason: "offline_unknown",
		});
		await pinLogin(db, online("1234"), ALI.memberId, "1234", T0);
		expect(
			await pinLogin(
				db,
				offline,
				ALI.memberId,
				"1234",
				T0 + OFFLINE_PIN_MAX_AGE_MS + 1,
			),
		).toEqual({
			ok: false,
			reason: "offline_expired",
		});
	});

	it("a server 'wrong PIN' wipes the offline verifier (PIN was changed)", async () => {
		await pinLogin(db, online("1234"), ALI.memberId, "1234", T0);
		expect(
			await pinLogin(db, online("5678"), ALI.memberId, "1234", T0 + 1),
		).toEqual({ ok: false, reason: "wrong_pin" });
		expect(await pinLogin(db, offline, ALI.memberId, "1234", T0 + 2)).toEqual({
			ok: false,
			reason: "offline_unknown",
		});
	});

	it("locks offline guessing after 5 misses", async () => {
		await pinLogin(db, online("1234"), ALI.memberId, "1234", T0);
		for (let i = 0; i < 5; i++)
			await pinLogin(db, offline, ALI.memberId, `000${i}`, T0 + i);
		expect(await pinLogin(db, offline, ALI.memberId, "1234", T0 + 10)).toEqual({
			ok: false,
			reason: "rate_limited",
		});
		expect(
			await pinLogin(db, offline, ALI.memberId, "1234", T0 + 10 + 5 * 60_000),
		).toMatchObject({ ok: true });
	});

	it("staff removed from the location are forgotten", async () => {
		await pinLogin(db, online("1234"), ALI.memberId, "1234", T0);
		await cacheStaffList(db, []);
		expect(await listCachedStaff(db)).toEqual([]);
		expect(await pinLogin(db, offline, ALI.memberId, "1234", T0 + 1)).toEqual({
			ok: false,
			reason: "offline_unknown",
		});
	});
});
