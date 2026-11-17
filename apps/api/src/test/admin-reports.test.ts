import { schema as s } from "@bite/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, ownerUrl, setupHarness, uuidv7 } from "./harness.js";

const DAY = "2026-03-02";

describe.runIf(ownerUrl)("admin reports", () => {
	let h: Harness;
	const ids = {
		o1: uuidv7(),
		o2: uuidv7(),
		cancelled: uuidv7(),
		pay1: uuidv7(),
	};

	beforeAll(async () => {
		h = await setupHarness();
		const base = {
			orgId: h.A.org,
			locationId: h.A.loc,
			businessDate: DAY,
			source: "counter" as const,
			pricesIncludeTax: true,
		};
		// o1: 2 x 1500 latte, 300 promo off -> 2700 incl. 129 tax, paid by card + tip.
		// o2: 1 x 1500, "=cmd" customer name to test CSV escaping, unpaid.
		await h.ownerDb.insert(s.orders).values([
			{
				...base,
				id: ids.o1,
				ticketNumber: "A-1",
				subtotal: 2700,
				discountTotal: 300,
				taxTotal: 129,
				total: 2700,
				paidTotal: 2700,
				paymentStatus: "paid",
				placedAt: new Date("2026-03-02T08:00:00Z"),
			},
			{
				...base,
				id: ids.o2,
				ticketNumber: "A-2",
				subtotal: 1500,
				taxTotal: 71,
				total: 1500,
				customerName: '=HYPERLINK("x"), "Sara"',
				placedAt: new Date("2026-03-02T09:00:00Z"),
			},
			{
				...base,
				id: ids.cancelled,
				ticketNumber: "A-3",
				subtotal: 9000,
				taxTotal: 429,
				total: 9000,
				fulfillmentStatus: "cancelled",
				placedAt: new Date("2026-03-02T10:00:00Z"),
			},
		]);
		const line = {
			orgId: h.A.org,
			productId: h.A.prod,
			name: { en: "Latte a" },
			taxBps: 500,
			listUnitPrice: 1500,
		};
		await h.ownerDb.insert(s.orderLines).values([
			{
				...line,
				orderId: ids.o1,
				quantity: 2,
				unitPrice: 1350,
				lineTotal: 2700,
				lineDiscount: 300,
				lineTax: 129,
			},
			{
				...line,
				orderId: ids.o2,
				quantity: 1,
				unitPrice: 1500,
				lineTotal: 1500,
				lineTax: 71,
			},
			{
				...line,
				orderId: ids.cancelled,
				quantity: 6,
				unitPrice: 1500,
				lineTotal: 9000,
				lineTax: 429,
			},
		]);
		await h.ownerDb.insert(s.payments).values([
			{
				id: ids.pay1,
				orgId: h.A.org,
				locationId: h.A.loc,
				orderId: ids.o1,
				amount: 2700,
				tip: 200,
				method: "card",
				businessDate: DAY,
			},
			{
				orgId: h.A.org,
				locationId: h.A.loc,
				orderId: ids.o1,
				amount: -500,
				method: "card",
				reversesPaymentId: ids.pay1,
				businessDate: DAY,
			},
		]);
	});
	afterAll(() => h?.close());

	const get = (who: "owner" | "manager", path: string) =>
		h.app.request(`/v1/admin${path}`, { headers: h.logins.A[who] });

	it("sums the day, skipping cancelled orders, netting refunds", async () => {
		const res = await get(
			"manager",
			`/reports/sales?locationId=${h.A.loc}&from=${DAY}&to=${DAY}`,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			locationId: h.A.loc,
			from: DAY,
			to: DAY,
			orderCount: 2,
			gross: 4500,
			discounts: 300,
			tax: 200,
			total: 4200,
			net: 4000,
			byMethod: [{ method: "card", amount: 2200, count: 2 }],
			tips: 200,
			refunds: 500,
			refundCount: 1,
			topProducts: [
				{
					productId: h.A.prod,
					name: { en: "Latte a" },
					quantity: 3,
					revenue: 4200,
				},
			],
		});
	});

	it("managers can't report on locations they don't manage", async () => {
		const res = await get(
			"manager",
			`/reports/sales?locationId=${h.A.otherLoc}&from=${DAY}&to=${DAY}`,
		);
		expect(res.status).toBe(404);
	});

	it("rejects backwards or over-long ranges", async () => {
		expect(
			(
				await get(
					"owner",
					`/reports/sales?locationId=${h.A.loc}&from=2026-03-02&to=2026-03-01`,
				)
			).status,
		).toBe(400);
		expect(
			(
				await get(
					"owner",
					`/reports/sales?locationId=${h.A.loc}&from=2025-01-01&to=2026-03-01`,
				)
			).status,
		).toBe(400);
	});

	it("pages orders newest first with a keyset cursor", async () => {
		const q = `locationId=${h.A.loc}&from=${DAY}&to=${DAY}`;
		const p1 = (await (await get("owner", `/orders?${q}&limit=2`)).json()) as {
			items: { id: string }[];
			nextCursor?: string;
		};
		expect(p1.items.map((o) => o.id)).toEqual([ids.cancelled, ids.o2]);
		const p2 = (await (
			await get("owner", `/orders?${q}&limit=2&cursor=${p1.nextCursor}`)
		).json()) as { items: { id: string }[]; nextCursor?: string };
		expect(p2.items.map((o) => o.id)).toEqual([ids.o1]);
		expect(p2.nextCursor).toBeUndefined();

		const paid = (await (
			await get("owner", `/orders?${q}&paymentStatus=paid`)
		).json()) as {
			items: { id: string }[];
		};
		expect(paid.items.map((o) => o.id)).toEqual([ids.o1]);
		expect((await get("owner", `/orders?${q}&cursor=garbage`)).status).toBe(
			400,
		);
	});

	it("exports CSV in decimal money, with formula injection neutralised", async () => {
		const res = await get(
			"owner",
			`/orders.csv?locationId=${h.A.loc}&from=${DAY}&to=${DAY}`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/csv");
		const text = await res.text();
		const rows = text.replace(/^﻿/, "").trimEnd().split("\r\n");
		expect(rows[0]).toContain("total_OMR");
		expect(rows).toHaveLength(4);
		const o1 = rows.find((r) => r.startsWith("A-1,"));
		expect(o1).toContain(",2.700,");
		const o2 = rows.find((r) => r.startsWith("A-2,"));
		expect(o2).toContain(`"'=HYPERLINK(""x""), ""Sara"""`);
	});
});
