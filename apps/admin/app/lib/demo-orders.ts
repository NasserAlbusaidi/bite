/**
 * Made-up order history for the demo back office, so reports have something
 * to show. Deterministic per location and day; integer money via @bite/core.
 */
import {
	addDays,
	applyRate,
	type BasisPoints,
	formatDecimal,
	type Minor,
	taxFromInclusive,
} from "@bite/core";
import type { AdminMenu, AdminOrderRow, SalesReport } from "./contracts";

type Method = SalesReport["byMethod"][number]["method"];
export type DemoOrder = {
	row: AdminOrderRow;
	lines: { productId: string; quantity: number; gross: number; net: number }[];
	gross: number;
	discount: number;
	tax: number;
	tip: number;
	method: Method;
};

/** Tiny seeded PRNG (mulberry32). Demo data only, never for anything secret. */
function rng(seed: number) {
	let a = seed >>> 0;
	return (n: number) => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) % n;
	};
}
const hash = (s: string) =>
	[...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

const METHODS: Method[] = ["card", "card", "softpos", "cash", "thawani"];
const RATE = 500 as BasisPoints;

export function demoOrders(
	locationId: string,
	menu: AdminMenu,
	from: string,
	to: string,
): DemoOrder[] {
	const products = menu.products.filter((p) => !p.archivedAt);
	if (products.length === 0) return [];
	const out: DemoOrder[] = [];
	for (
		let day = from, guard = 0;
		day <= to && guard < 400;
		day = addDays(day, 1), guard++
	) {
		const r = rng(hash(`${locationId}:${day}`));
		const count = 18 + r(25);
		for (let i = 0; i < count; i++) {
			const lines = Array.from({ length: 1 + r(3) }, () => {
				const p = products[r(products.length)];
				if (!p) throw new Error("unreachable");
				const quantity = 1 + r(2);
				const gross = p.price * quantity;
				return { productId: p.id, quantity, gross, net: gross };
			});
			const gross = lines.reduce((s, l) => s + l.gross, 0);
			const discount =
				r(5) === 0 ? applyRate(gross as Minor, 1000 as BasisPoints) : 0;
			for (const l of lines)
				l.net =
					l.gross -
					(discount === 0
						? 0
						: applyRate(l.gross as Minor, 1000 as BasisPoints));
			const total = gross - discount;
			const tax = taxFromInclusive(total as Minor, RATE);
			const cancelled = r(40) === 0;
			const minute = 7 * 60 + r(15 * 60);
			const hh = String(Math.floor(minute / 60)).padStart(2, "0");
			const mm = String(minute % 60).padStart(2, "0");
			const method = METHODS[r(METHODS.length)] ?? "card";
			const tip = method === "card" && r(6) === 0 ? 500 : 0;
			out.push({
				row: {
					id: `0193a1b2-dddd-7000-8000-${String(
						hash(`${locationId}${day}${i}`) >>> 0,
					)
						.padStart(12, "0")
						.slice(-12)}`,
					ticketNumber: `${["A", "Q", "G"][r(3)]}-${i + 1}`,
					businessDate: day,
					placedAt: `${day}T${hh}:${mm}:00+04:00`,
					source: ["counter", "guest", "group"][r(3)] ?? "counter",
					type: r(3) === 0 ? "takeaway" : "dine_in",
					paymentStatus: cancelled ? "unpaid" : "paid",
					fulfillmentStatus: cancelled ? "cancelled" : "completed",
					total,
					paidTotal: cancelled ? 0 : total + tip,
					customerName:
						r(4) === 0
							? (["Layla", "Salim", "Maryam", "Yousef"][r(4)] ?? null)
							: null,
				},
				lines,
				gross,
				discount,
				tax,
				tip,
				method,
			});
		}
	}
	return out;
}

/** Same sums the API's /reports/sales returns, over the demo orders. */
export function demoReport(
	locationId: string,
	from: string,
	to: string,
	orders: readonly DemoOrder[],
	menu: AdminMenu,
): SalesReport {
	const live = orders.filter((o) => o.row.fulfillmentStatus !== "cancelled");
	const add = (f: (o: DemoOrder) => number) =>
		live.reduce((s, o) => s + f(o), 0);
	const byMethod = new Map<Method, { amount: number; count: number }>();
	for (const o of live) {
		const m = byMethod.get(o.method) ?? { amount: 0, count: 0 };
		m.amount += o.row.paidTotal;
		m.count += 1;
		byMethod.set(o.method, m);
	}
	const top = new Map<string, { quantity: number; revenue: number }>();
	for (const o of live)
		for (const l of o.lines) {
			const t = top.get(l.productId) ?? { quantity: 0, revenue: 0 };
			t.quantity += l.quantity;
			t.revenue += l.net;
			top.set(l.productId, t);
		}
	const total = add((o) => o.row.total);
	const tax = add((o) => o.tax);
	return {
		locationId,
		from,
		to,
		orderCount: live.length,
		gross: add((o) => o.gross),
		discounts: add((o) => o.discount),
		tax,
		total,
		net: total - tax,
		tips: add((o) => o.tip),
		// Demo orders are never refunded.
		refunds: 0,
		refundCount: 0,
		byMethod: [...byMethod].map(([method, v]) => ({ method, ...v })),
		topProducts: [...top]
			.sort((a, b) => b[1].revenue - a[1].revenue)
			.slice(0, 10)
			.map(([productId, v]) => ({
				productId,
				name: menu.products.find((p) => p.id === productId)?.name ?? {
					en: "?",
				},
				...v,
			})),
	};
}

/** RFC 4180-ish CSV of order rows, the shape /orders.csv returns. */
export function ordersCsv(
	rows: readonly AdminOrderRow[],
	decimals: number,
): string {
	const head = [
		"ticket",
		"business_date",
		"placed_at",
		"source",
		"type",
		"payment_status",
		"fulfillment_status",
		"total",
		"paid_total",
		"customer",
	];
	// Guest-typed text must not run as a spreadsheet formula.
	const esc = (raw: string) => {
		const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
		return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
	};
	const amount = (n: number) => formatDecimal(n as Minor, decimals);
	const lines = rows.map((r) =>
		[
			r.ticketNumber,
			r.businessDate,
			r.placedAt,
			r.source,
			r.type,
			r.paymentStatus,
			r.fulfillmentStatus,
			amount(r.total),
			amount(r.paidTotal),
			r.customerName ?? "",
		]
			.map(esc)
			.join(","),
	);
	return [head.join(","), ...lines].join("\n");
}
