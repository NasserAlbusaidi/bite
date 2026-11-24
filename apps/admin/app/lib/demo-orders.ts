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
import type {
	AdminCashSession,
	AdminMenu,
	AdminOrderDetail,
	AdminOrderRow,
	SalesReport,
	TrendsReport,
} from "./contracts";

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

/** Monday 0 ... Sunday 6, for a YYYY-MM-DD date. */
export const weekdayOf = (date: string) =>
	(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Same shapes /reports/trends returns, over the demo orders. */
export function demoTrends(
	locationId: string,
	from: string,
	to: string,
	orders: readonly DemoOrder[],
	menu: AdminMenu,
): TrendsReport {
	const live = orders.filter((o) => o.row.fulfillmentStatus !== "cancelled");
	const net = (o: DemoOrder) => o.row.total - o.tax;
	const days: TrendsReport["days"] = [];
	for (let d = from, g = 0; d <= to && g < 400; d = addDays(d, 1), g++) {
		const mine = live.filter((o) => o.row.businessDate === d);
		days.push({
			date: d,
			orders: mine.length,
			net: mine.reduce((s, o) => s + net(o), 0),
			total: mine.reduce((s, o) => s + o.row.total, 0),
		});
	}
	const bucket = <K extends string>(key: (o: DemoOrder) => K) => {
		const m = new Map<K, { orders: number; net: number }>();
		for (const o of live) {
			const v = m.get(key(o)) ?? { orders: 0, net: 0 };
			v.orders += 1;
			v.net += net(o);
			m.set(key(o), v);
		}
		return m;
	};
	const heat = bucket(
		(o) =>
			`${weekdayOf(o.row.businessDate)}:${Number(o.row.placedAt.slice(11, 13))}`,
	);
	const cat = new Map<string, { quantity: number; revenue: number }>();
	for (const o of live)
		for (const l of o.lines) {
			const c =
				menu.products.find((p) => p.id === l.productId)?.categoryId ?? "";
			const v = cat.get(c) ?? { quantity: 0, revenue: 0 };
			v.quantity += l.quantity;
			v.revenue += l.net;
			cat.set(c, v);
		}
	return {
		locationId,
		from,
		to,
		days,
		heat: [...heat].map(([k, v]) => {
			const [w, h] = k.split(":");
			return { weekday: Number(w), hour: Number(h), ...v };
		}),
		bySource: [...bucket((o) => o.row.source as "counter")].map(
			([source, v]) => ({ source, ...v }),
		),
		byType: [...bucket((o) => o.row.type)].map(([type, v]) => ({ type, ...v })),
		byCategory: [...cat]
			.sort((a, b) => b[1].revenue - a[1].revenue)
			.map(([id, v]) => ({
				categoryId: id || null,
				name: menu.categories.find((c) => c.id === id)?.name ?? {
					en: "Other",
					ar: "أخرى",
				},
				...v,
			})),
		prep: live.length
			? { count: live.length, medianMinutes: 7.5, p90Minutes: 14 }
			: { count: 0, medianMinutes: null, p90Minutes: null },
	};
}

/** One demo order with lines and its payment, the shape /orders/:id returns. */
export function demoOrderDetail(
	locationId: string,
	o: DemoOrder,
	menu: AdminMenu,
): AdminOrderDetail {
	const placed = Date.parse(o.row.placedAt);
	const at = (min: number) => new Date(placed + min * 60_000).toISOString();
	const cancelled = o.row.fulfillmentStatus === "cancelled";
	return {
		...o.row,
		locationId,
		subtotal: o.row.total,
		discountTotal: o.discount,
		taxTotal: o.tax,
		pricesIncludeTax: true,
		note: null,
		customerPhone: null,
		readyAt: cancelled ? null : at(8),
		completedAt: cancelled ? null : at(12),
		cancelledAt: cancelled ? at(3) : null,
		cancelReason: cancelled ? "Guest left" : null,
		deviceName: o.row.source === "counter" ? "Front till" : null,
		createdByName: o.row.source === "counter" ? "Aisha" : null,
		lines: o.lines.map((l, i) => {
			const p = menu.products.find((x) => x.id === l.productId);
			return {
				id: `${o.row.id.slice(0, 24)}${String(i).padStart(12, "0")}`,
				name: p?.name ?? { en: "?" },
				quantity: l.quantity,
				unitPrice: Math.trunc(l.net / l.quantity),
				listUnitPrice: Math.trunc(l.gross / l.quantity),
				modifiers: [],
				lineTotal: l.net,
				lineDiscount: l.gross - l.net,
				lineTax: taxFromInclusive(l.net as Minor, RATE),
				note: null,
				voidedAt: null,
				voidReason: null,
			};
		}),
		payments: cancelled
			? []
			: [
					{
						id: `${o.row.id.slice(0, 24)}9999${o.row.id.slice(-8)}`,
						method: o.method,
						state: "succeeded",
						amount: o.row.total,
						tip: o.tip,
						tendered: null,
						reason: null,
						businessDate: o.row.businessDate,
						createdAt: at(1),
						createdByName: "Aisha",
					},
				],
	};
}

/** A drawer per day at the front till, shaped like /cash-sessions. */
export function demoCashSessions(
	locationId: string,
	from: string,
	to: string,
	today: string,
	orders: readonly DemoOrder[],
): AdminCashSession[] {
	const out: AdminCashSession[] = [];
	for (let d = to, g = 0; d >= from && g < 400; d = addDays(d, -1), g++) {
		if (d > today) continue;
		const r = rng(hash(`${locationId}:cash:${d}`));
		const cashSales = orders
			.filter(
				(o) =>
					o.row.businessDate === d &&
					o.method === "cash" &&
					o.row.fulfillmentStatus !== "cancelled",
			)
			.reduce((s, o) => s + o.row.paidTotal, 0);
		const openingFloat = 20_000;
		const payOuts = r(3) === 0 ? 3_500 : 0;
		const drops = cashSales > 30_000 ? 20_000 : 0;
		const expected = openingFloat + cashSales - payOuts - drops;
		const open = d === today;
		const variance = open ? null : ([0, 0, 0, -100, 250, -500][r(6)] ?? 0);
		const id = `0193a1b2-cccc-7000-8000-${String(
			hash(`${locationId}${d}`) >>> 0,
		)
			.padStart(12, "0")
			.slice(-12)}`;
		out.push({
			id,
			businessDate: d,
			deviceName: "Front till",
			status: open ? "open" : "closed",
			openedAt: `${d}T06:45:00+04:00`,
			openedByName: "Aisha",
			closedAt: open ? null : `${d}T23:10:00+04:00`,
			closedByName: open ? null : "Khalid",
			openingFloat,
			cashSales,
			cashRefunds: 0,
			payIns: 0,
			payOuts,
			drops,
			expectedCash: expected,
			countedCash: variance === null ? null : expected + variance,
			variance,
			notes: variance && variance < 0 ? "Short, checked with Aisha" : null,
			movements: [
				...(payOuts
					? [
							{
								kind: "pay_out" as const,
								amount: payOuts,
								reason: "Milk delivery",
								createdAt: `${d}T10:20:00+04:00`,
								byName: "Aisha",
							},
						]
					: []),
				...(drops
					? [
							{
								kind: "drop" as const,
								amount: drops,
								reason: "To the safe",
								createdAt: `${d}T16:00:00+04:00`,
								byName: "Khalid",
							},
						]
					: []),
			],
		});
	}
	return out;
}
