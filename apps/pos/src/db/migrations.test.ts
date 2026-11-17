import { describe, expect, it } from "vitest";
import { nextTicketNumber } from "../domain/tickets.js";
import { kvGet, kvSet } from "./kv.js";
import { MIGRATIONS, migrate } from "./migrations.js";
import { openSqlJs } from "./sqljs-driver.js";

describe("local schema", () => {
	it("migrates once and is idempotent", async () => {
		const db = await openSqlJs();
		const latest = MIGRATIONS.at(-1)?.version;
		expect(await migrate(db)).toBe(latest);
		expect(await migrate(db)).toBe(latest);
		const rows = await db.all("SELECT version FROM schema_version");
		expect(rows).toHaveLength(MIGRATIONS.length);
	});

	it("migration versions are strictly increasing and comments carry no semicolons", () => {
		MIGRATIONS.forEach((m, i) => {
			if (i > 0)
				expect(m.version).toBeGreaterThan(MIGRATIONS[i - 1]?.version ?? 0);
			for (const line of m.sql.split("\n")) {
				const comment = line.split("--")[1];
				if (comment) expect(comment).not.toContain(";");
			}
		});
	});

	it("kv round-trips and overwrites", async () => {
		const db = await openSqlJs();
		await migrate(db);
		expect(await kvGet(db, "x")).toBeNull();
		await kvSet(db, "x", "1");
		await kvSet(db, "x", "2");
		expect(await kvGet(db, "x")).toBe("2");
	});
});

describe("ticket numbers", () => {
	it("counts per business day with the device prefix", async () => {
		const db = await openSqlJs();
		await migrate(db);
		const next = (d: string) =>
			db.transaction((tx) => nextTicketNumber(tx, "A", d));
		expect(await next("2026-11-17")).toBe("A-001");
		expect(await next("2026-11-17")).toBe("A-002");
		expect(await next("2026-11-18")).toBe("A-001");
		expect(await next("2026-11-17")).toBe("A-003");
	});

	it("never reuses a ticket the server already has (re-pair, wiped database)", async () => {
		const db = await openSqlJs();
		await migrate(db);
		const put = (ticket: string, day = "2026-11-17") =>
			db.run(
				`INSERT INTO orders (id, ticket_number, business_date, fulfillment_status, payment_status, placed_at, version, doc)
				 VALUES (?, ?, ?, 'completed', 'paid', '2026-11-17T08:00:00Z', 1, '{}')`,
				[`${ticket}-${day}`, ticket, day],
			);
		// What the first pull brings back after re-pairing: this device's
		// tickets, another device's, a QR order, and yesterday's.
		await put("A-007");
		await put("A-012");
		await put("AB-099");
		await put("Q-050");
		await put("A-040", "2026-11-16");
		const next = (d: string) =>
			db.transaction((tx) => nextTicketNumber(tx, "A", d));
		expect(await next("2026-11-17")).toBe("A-013");
		expect(await next("2026-11-17")).toBe("A-014");
		expect(await next("2026-11-18")).toBe("A-001");
		// A counter already ahead of the pulled orders keeps going.
		await put("A-005", "2026-11-18");
		expect(await next("2026-11-18")).toBe("A-006");
		expect(await next("2026-11-18")).toBe("A-007");
	});

	it("rolls back the counter with the order", async () => {
		const db = await openSqlJs();
		await migrate(db);
		await expect(
			db.transaction(async (tx) => {
				await nextTicketNumber(tx, "B", "2026-11-17");
				throw new Error("order insert failed");
			}),
		).rejects.toThrow();
		expect(
			await db.transaction((tx) => nextTicketNumber(tx, "B", "2026-11-17")),
		).toBe("B-001");
	});

	it("rejects bad prefixes and dates", async () => {
		const db = await openSqlJs();
		await migrate(db);
		await expect(
			db.transaction((tx) => nextTicketNumber(tx, "a", "2026-11-17")),
		).rejects.toThrow(RangeError);
		await expect(
			db.transaction((tx) => nextTicketNumber(tx, "A", "17/11/2026")),
		).rejects.toThrow(RangeError);
	});
});
