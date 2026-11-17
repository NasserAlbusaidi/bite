import { describe, expect, it } from "vitest";
import { AdminApiError } from "./api-types";
import type { AdminOrderRow } from "./contracts";
import { demoOrders, demoReport, ordersCsv } from "./demo-orders";
import { demoState, fixtureAdminApi } from "./fixtures";

const state = demoState();
const loc = state.locations[0]?.id ?? "";
const range = { locationId: loc, from: "2026-11-01", to: "2026-11-07" };

describe("demo sales report", () => {
	it("is deterministic and adds up in integer baisa", () => {
		const a = demoOrders(loc, state.menu, range.from, range.to);
		const b = demoOrders(loc, state.menu, range.from, range.to);
		expect(a.map((o) => o.row.total)).toEqual(b.map((o) => o.row.total));

		const r = demoReport(loc, range.from, range.to, a, state.menu);
		const live = a.filter((o) => o.row.fulfillmentStatus !== "cancelled");
		expect(r.orderCount).toBe(live.length);
		expect(r.gross - r.discounts).toBe(r.total);
		expect(r.net + r.tax).toBe(r.total);
		expect(r.byMethod.reduce((s, m) => s + m.count, 0)).toBe(r.orderCount);
		expect(r.byMethod.reduce((s, m) => s + m.amount, 0)).toBe(r.total + r.tips);
		for (const n of [r.gross, r.discounts, r.tax, r.total, r.tips])
			expect(Number.isInteger(n)).toBe(true);
		const revenue = r.topProducts.map((p) => p.revenue);
		expect(revenue).toEqual([...revenue].sort((x, y) => y - x));
	});

	it("rejects an unknown location", async () => {
		const api = fixtureAdminApi(demoState());
		await expect(
			api.salesReport({ ...range, locationId: "nope" }),
		).rejects.toBeInstanceOf(AdminApiError);
	});
});

describe("demo orders list", () => {
	it("pages with a cursor and never repeats a row", async () => {
		const api = fixtureAdminApi(demoState());
		const seen = new Set<string>();
		let cursor: string | undefined;
		let pages = 0;
		do {
			const page = await api.orders({
				...range,
				limit: 40,
				...(cursor ? { cursor } : {}),
			});
			for (const o of page.items) {
				expect(seen.has(o.id)).toBe(false);
				seen.add(o.id);
			}
			cursor = page.nextCursor;
			pages++;
		} while (cursor && pages < 100);
		const all = demoOrders(loc, state.menu, range.from, range.to);
		expect(seen.size).toBe(all.length);
		expect(pages).toBeGreaterThan(1);
	});

	it("filters by fulfillment status", async () => {
		const api = fixtureAdminApi(demoState());
		const page = await api.orders({
			...range,
			fulfillmentStatus: "cancelled",
			limit: 500,
		});
		expect(page.items.every((o) => o.fulfillmentStatus === "cancelled")).toBe(
			true,
		);
	});
});

describe("orders CSV", () => {
	const row: AdminOrderRow = {
		id: "0193a1b2-dddd-7000-8000-000000000001",
		ticketNumber: "A-1",
		businessDate: "2026-11-01",
		placedAt: "2026-11-01T08:00:00+04:00",
		source: "counter",
		type: "dine_in",
		paymentStatus: "paid",
		fulfillmentStatus: "completed",
		total: 1250,
		paidTotal: 1750,
		customerName: 'Salim "the, regular"',
	};

	it("formats money from baisa and quotes awkward text", () => {
		const [head, line] = ordersCsv([row], 3).split("\n");
		expect(head?.startsWith("ticket,business_date")).toBe(true);
		expect(line).toContain(",1.250,1.750,");
		expect(line?.endsWith('"Salim ""the, regular"""')).toBe(true);
	});

	it("defuses spreadsheet formulas in guest-typed names", () => {
		const line = ordersCsv(
			[{ ...row, customerName: "=HYPERLINK(1)" }],
			3,
		).split("\n")[1];
		expect(line?.endsWith(",'=HYPERLINK(1)")).toBe(true);
	});
});
