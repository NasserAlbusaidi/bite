import { describe, expect, it } from "vitest";
import type { SalesReport } from "./contracts";
import {
	attention,
	averageOrder,
	type BranchDay,
	share,
	taken,
	totals,
} from "./dashboard";
import { demoState, fixtureAdminApi } from "./fixtures";
import type { Place } from "./places";

const report = (over: Partial<SalesReport> = {}): SalesReport => ({
	locationId: "l",
	from: "2026-11-18",
	to: "2026-11-18",
	orderCount: 0,
	gross: 0,
	discounts: 0,
	tax: 0,
	total: 0,
	net: 0,
	byMethod: [],
	tips: 0,
	refunds: 0,
	refundCount: 0,
	topProducts: [],
	...over,
});
const place = (id: string, currencyCode = "OMR"): Place => ({
	id,
	name: id,
	slug: id,
	currencyCode,
	decimals: currencyCode === "OMR" ? 3 : 2,
});
const day = (p: Place, net: number, orders: number): BranchDay => ({
	place: p,
	date: "2026-11-18",
	today: report({ net, orderCount: orders, total: net }),
	yesterday: report({ net: net * 2 }),
	week: report({ net: net * 7 }),
});

describe("overview numbers", () => {
	it("adds branches up in one currency", () => {
		const rows = [day(place("a"), 10_500, 4), day(place("b"), 2_250, 1)];
		expect(totals(rows)).toEqual({
			currencyCode: "OMR",
			decimals: 3,
			net: 12_750,
			orders: 5,
			yesterday: 25_500,
			week: 89_250,
		});
	});
	it("refuses to add different currencies", () => {
		expect(
			totals([day(place("a"), 1, 1), day(place("b", "AED"), 1, 1)]),
		).toBeNull();
		expect(totals([])).toBeNull();
	});
	it("averages and counts money in without floats", () => {
		const r = report({
			orderCount: 3,
			total: 10_000,
			byMethod: [
				{ method: "cash", amount: 6_000, count: 2 },
				{ method: "card", amount: 3_500, count: 1 },
			],
		});
		expect(averageOrder(r)).toBe(3_333);
		expect(averageOrder(report())).toBe(0);
		expect(taken(r)).toBe(9_500);
	});
	it("sizes the bar against the best branch", () => {
		expect(share(50, 100)).toBe(50);
		expect(share(100, 100)).toBe(100);
		expect(share(1, 1000)).toBe(2);
		expect(share(0, 100)).toBe(0);
		expect(share(5, 0)).toBe(0);
	});
});

describe("needs a look", () => {
	it("lists what is wrong at the branch, worst first", async () => {
		const state = demoState();
		const api = fixtureAdminApi(state);
		const locationId = state.locations[0]?.id ?? "";
		const [milk] = state.menu.modifierGroups;
		if (!milk) throw new Error("no demo group");
		// Milk is required: with every choice sold out, Flat white can't be ordered.
		for (const o of milk.options)
			await api.updateModifierOption(milk.id, o.id, { isAvailable: false });
		const row = {
			id: "o",
			ticketNumber: "Q-1",
			businessDate: "2026-11-18",
			placedAt: "2026-11-18T08:00:00Z",
			source: "qr",
			type: "dine_in",
			paymentStatus: "unpaid" as const,
			total: 1000,
			paidTotal: 0,
			customerName: null,
		};
		const list = attention({
			locationId,
			date: "2026-11-18",
			unpaid: {
				items: [
					{ ...row, fulfillmentStatus: "pending" },
					{ ...row, id: "c", fulfillmentStatus: "cancelled" },
				],
			},
			products: await api.locationProducts(locationId),
			menu: await api.menu(),
		});
		expect(list.map((a) => [a.kind, a.count])).toEqual([
			["blocked", 1],
			["unpaid", 1],
			["sold_out", 1],
			["choices_out", 2],
		]);
		expect(list[1]?.to).toBe(
			"/reports?from=2026-11-18&to=2026-11-18&payment=unpaid",
		);
	});
	it("is empty when nothing is wrong", () => {
		expect(
			attention({
				locationId: "l",
				date: "2026-11-18",
				unpaid: { items: [] },
				products: [],
				menu: { categories: [], products: [], modifierGroups: [] },
			}),
		).toEqual([]);
	});
});
