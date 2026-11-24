import {
	type AdminCashSession,
	type AdminOrderDetail,
	type AdminOrderRow,
	AdminOrdersQuery,
	CashSessionsQuery,
	type SalesReport,
	SalesReportQuery,
	type TrendsReport,
} from "@bite/contracts";
import { addDays, formatDecimal, type Minor } from "@bite/core";
import { schema, type Tx } from "@bite/db";
import {
	and,
	asc,
	between,
	desc,
	eq,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	or,
	sql,
} from "@bite/db/orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { requireHistory } from "../lib/entitlements.js";
import { ApiError } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { adminTx, requireLocation } from "../middleware/admin-auth.js";

const {
	orders,
	orderLines,
	payments,
	locations,
	products,
	categories,
	members,
	devices,
	cashSessions,
	cashMovements,
} = schema;

const MAX_DAYS = 366;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CSV_MAX_ROWS = 20_000;
const n = (v: unknown) => Number(v ?? 0);

async function checkRange(
	c: Context<AppEnv>,
	q: { locationId: string; from: string; to: string },
) {
	requireLocation(c, q.locationId);
	const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
	if (days < 0) throw new ApiError("bad_request", "from is after to");
	if (days >= MAX_DAYS)
		throw new ApiError("bad_request", `at most ${MAX_DAYS} days`);
	// The plan's history window (free: the last 31 days).
	if (c.var.deps.planEnforcement) {
		await adminTx(c, (tx) =>
			requireHistory(tx, c.var.deps, c.var.admin.orgId, q.from),
		);
	}
}

// ---------------------------------------------------------------- orders list

type OrdersFilter = {
	locationId: string;
	from: string;
	to: string;
	paymentStatus?: AdminOrderRow["paymentStatus"] | undefined;
	fulfillmentStatus?: AdminOrderRow["fulfillmentStatus"] | undefined;
	search?: string | undefined;
};

/** LIKE pattern for "contains", with the user's own % _ \\ taken literally. */
const contains = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function ordersWhere(q: OrdersFilter) {
	return and(
		eq(orders.locationId, q.locationId),
		between(orders.businessDate, q.from, q.to),
		q.paymentStatus ? eq(orders.paymentStatus, q.paymentStatus) : undefined,
		q.fulfillmentStatus
			? eq(orders.fulfillmentStatus, q.fulfillmentStatus)
			: undefined,
		q.search
			? or(
					ilike(orders.ticketNumber, contains(q.search)),
					ilike(orders.customerName, contains(q.search)),
					ilike(orders.customerPhone, contains(q.search)),
					ilike(orders.tableLabel, contains(q.search)),
				)
			: undefined,
	);
}

type Keyset = { p: string; i: string };
const encodeCursor = (k: Keyset) =>
	Buffer.from(JSON.stringify(k)).toString("base64url");
function decodeCursor(cursor: string): Keyset {
	try {
		const k = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Keyset;
		if (
			typeof k.p !== "string" ||
			typeof k.i !== "string" ||
			Number.isNaN(Date.parse(k.p))
		) {
			throw new Error();
		}
		return k;
	} catch {
		throw new ApiError("bad_request", "bad cursor");
	}
}

type OrderRow = typeof orders.$inferSelect;
const orderRow = (o: OrderRow): AdminOrderRow => ({
	id: o.id,
	ticketNumber: o.ticketNumber,
	businessDate: o.businessDate,
	placedAt: o.placedAt.toISOString(),
	source: o.source,
	type: o.type,
	paymentStatus: o.paymentStatus,
	fulfillmentStatus: o.fulfillmentStatus,
	total: o.total,
	paidTotal: o.paidTotal,
	customerName: o.customerName,
	tableLabel: o.tableLabel,
});

const csvCell = (v: string | number | null) => {
	const s = v === null ? "" : String(v);
	// Quote everything that could break a row; neutralise spreadsheet formulas.
	const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
	return /[",\n\r]/.test(safe) || safe !== s
		? `"${safe.replaceAll('"', '""')}"`
		: safe;
};

// ---------------------------------------------------------------- sales report

async function salesReport(
	tx: Tx,
	q: { locationId: string; from: string; to: string },
) {
	const live = and(
		eq(orders.locationId, q.locationId),
		between(orders.businessDate, q.from, q.to),
		ne(orders.fulfillmentStatus, "cancelled"),
	);
	const [totals] = await tx
		.select({
			orderCount: sql<number>`count(*)::int`,
			subtotal: sql<string>`coalesce(sum(${orders.subtotal}), 0)`,
			discounts: sql<string>`coalesce(sum(${orders.discountTotal}), 0)`,
			tax: sql<string>`coalesce(sum(${orders.taxTotal}), 0)`,
			total: sql<string>`coalesce(sum(${orders.total}), 0)`,
		})
		.from(orders)
		.where(live);
	// Money actually taken that day, by the payment's own business date:
	// a refund on Tuesday for Monday's order lands on Tuesday.
	const methods = await tx
		.select({
			method: payments.method,
			amount: sql<string>`sum(${payments.amount})`,
			count: sql<number>`count(*)::int`,
			tips: sql<string>`coalesce(sum(${payments.tip}), 0)`,
		})
		.from(payments)
		.where(
			and(
				eq(payments.locationId, q.locationId),
				between(payments.businessDate, q.from, q.to),
				eq(payments.state, "succeeded"),
			),
		)
		.groupBy(payments.method)
		.orderBy(payments.method);
	const [refunds] = await tx
		.select({
			amount: sql<string>`coalesce(-sum(${payments.amount}), 0)`,
			count: sql<number>`count(*)::int`,
		})
		.from(payments)
		.where(
			and(
				eq(payments.locationId, q.locationId),
				between(payments.businessDate, q.from, q.to),
				eq(payments.state, "succeeded"),
				lt(payments.amount, 0),
			),
		);
	const top = await tx
		.select({
			productId: orderLines.productId,
			name: sql<{
				en: string;
				ar?: string;
			}>`(array_agg(${orderLines.name} order by ${orders.placedAt} desc))[1]`,
			quantity: sql<number>`sum(${orderLines.quantity})::int`,
			revenue: sql<string>`sum(${orderLines.lineTotal})`,
		})
		.from(orderLines)
		.innerJoin(orders, eq(orders.id, orderLines.orderId))
		.where(and(live, isNull(orderLines.voidedAt)))
		.groupBy(orderLines.productId)
		.orderBy(sql`sum(${orderLines.lineTotal}) desc`)
		.limit(10);

	const subtotal = n(totals?.subtotal);
	const discounts = n(totals?.discounts);
	const tax = n(totals?.tax);
	const total = n(totals?.total);
	const report: SalesReport = {
		...q,
		orderCount: totals?.orderCount ?? 0,
		gross: subtotal + discounts,
		discounts,
		tax,
		total,
		net: total - tax,
		byMethod: methods.map((m) => ({
			method: m.method,
			amount: n(m.amount),
			count: m.count,
		})),
		tips: methods.reduce((s, m) => s + n(m.tips), 0),
		refunds: n(refunds?.amount),
		refundCount: refunds?.count ?? 0,
		topProducts: top.map((t) => ({
			productId: t.productId,
			name: t.name,
			quantity: t.quantity,
			revenue: n(t.revenue),
		})),
	};
	return report;
}

// ---------------------------------------------------------------- trends

async function trendsReport(
	tx: Tx,
	q: { locationId: string; from: string; to: string },
): Promise<TrendsReport> {
	const live = and(
		eq(orders.locationId, q.locationId),
		between(orders.businessDate, q.from, q.to),
		ne(orders.fulfillmentStatus, "cancelled"),
	);
	const netSum = sql<string>`coalesce(sum(${orders.total} - ${orders.taxTotal}), 0)`;
	const count = sql<number>`count(*)::int`;
	const daily = await tx
		.select({
			date: orders.businessDate,
			orders: count,
			net: netSum,
			total: sql<string>`coalesce(sum(${orders.total}), 0)`,
		})
		.from(orders)
		.where(live)
		.groupBy(orders.businessDate);
	// Column, not a bound parameter: Postgres only matches GROUP BY
	// expressions that are textually the same.
	const local = sql`(${orders.placedAt} at time zone ${locations.timezone})`;
	const weekday = sql<number>`(extract(isodow from ${local})::int - 1)`;
	const hour = sql<number>`extract(hour from ${local})::int`;
	const heat = await tx
		.select({ weekday, hour, orders: count, net: netSum })
		.from(orders)
		.innerJoin(locations, eq(locations.id, orders.locationId))
		.where(live)
		.groupBy(weekday, hour);
	const bySource = await tx
		.select({ source: orders.source, orders: count, net: netSum })
		.from(orders)
		.where(live)
		.groupBy(orders.source);
	const byType = await tx
		.select({ type: orders.type, orders: count, net: netSum })
		.from(orders)
		.where(live)
		.groupBy(orders.type);
	const byCategory = await tx
		.select({
			categoryId: products.categoryId,
			name: sql<{
				en: string;
				ar?: string;
			} | null>`(array_agg(${categories.name}))[1]`,
			quantity: sql<number>`sum(${orderLines.quantity})::int`,
			revenue: sql<string>`sum(${orderLines.lineTotal})`,
		})
		.from(orderLines)
		.innerJoin(orders, eq(orders.id, orderLines.orderId))
		.leftJoin(products, eq(products.id, orderLines.productId))
		.leftJoin(categories, eq(categories.id, products.categoryId))
		.where(and(live, isNull(orderLines.voidedAt)))
		.groupBy(products.categoryId)
		.orderBy(sql`sum(${orderLines.lineTotal}) desc`);
	const minutes = sql`extract(epoch from (${orders.readyAt} - ${orders.placedAt})) / 60`;
	const [prep] = await tx
		.select({
			count,
			median: sql<
				string | null
			>`round((percentile_cont(0.5) within group (order by ${minutes}))::numeric, 1)`,
			p90: sql<
				string | null
			>`round((percentile_cont(0.9) within group (order by ${minutes}))::numeric, 1)`,
		})
		.from(orders)
		.where(and(live, isNotNull(orders.readyAt)));

	const byDate = new Map(daily.map((d) => [d.date, d]));
	const days: TrendsReport["days"] = [];
	for (
		let d = q.from, guard = 0;
		d <= q.to && guard < MAX_DAYS;
		d = addDays(d, 1), guard++
	) {
		const r = byDate.get(d);
		days.push({
			date: d,
			orders: r?.orders ?? 0,
			net: n(r?.net),
			total: n(r?.total),
		});
	}
	const mins = (v: string | null | undefined) =>
		v === null || v === undefined ? null : Number(v);
	return {
		...q,
		days,
		heat: heat.map((h) => ({
			weekday: Number(h.weekday),
			hour: Number(h.hour),
			orders: h.orders,
			net: n(h.net),
		})),
		bySource: bySource.map((r) => ({
			source: r.source,
			orders: r.orders,
			net: n(r.net),
		})),
		byType: byType.map((r) => ({
			type: r.type,
			orders: r.orders,
			net: n(r.net),
		})),
		byCategory: byCategory.map((r) => ({
			categoryId: r.categoryId,
			name: r.name ?? { en: "Other", ar: "أخرى" },
			quantity: r.quantity,
			revenue: n(r.revenue),
		})),
		prep: {
			count: prep?.count ?? 0,
			medianMinutes: mins(prep?.median),
			p90Minutes: mins(prep?.p90),
		},
	};
}

// ---------------------------------------------------------------- order detail

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function orderDetail(
	tx: Tx,
	id: string,
): Promise<AdminOrderDetail | undefined> {
	const [o] = await tx.select().from(orders).where(eq(orders.id, id));
	if (!o) return undefined;
	const lines = await tx
		.select()
		.from(orderLines)
		.where(eq(orderLines.orderId, id))
		.orderBy(asc(orderLines.sortOrder), asc(orderLines.createdAt));
	const pays = await tx
		.select({ p: payments, by: members.displayName })
		.from(payments)
		.leftJoin(members, eq(members.id, payments.createdBy))
		.where(eq(payments.orderId, id))
		.orderBy(asc(payments.createdAt));
	const [who] = o.createdBy
		? await tx
				.select({ name: members.displayName })
				.from(members)
				.where(eq(members.id, o.createdBy))
		: [];
	const [dev] = o.deviceId
		? await tx
				.select({ name: devices.name })
				.from(devices)
				.where(eq(devices.id, o.deviceId))
		: [];
	return {
		...orderRow(o),
		locationId: o.locationId,
		subtotal: o.subtotal,
		discountTotal: o.discountTotal,
		taxTotal: o.taxTotal,
		pricesIncludeTax: o.pricesIncludeTax,
		note: o.note,
		customerPhone: o.customerPhone,
		readyAt: iso(o.readyAt),
		completedAt: iso(o.completedAt),
		cancelledAt: iso(o.cancelledAt),
		cancelReason: o.cancelReason,
		deviceName: dev?.name ?? null,
		createdByName: who?.name ?? null,
		lines: lines.map((l) => ({
			id: l.id,
			name: l.name,
			quantity: l.quantity,
			unitPrice: l.unitPrice,
			listUnitPrice: l.listUnitPrice,
			modifiers: l.modifiers.map((m) => ({
				name: m.name,
				priceDelta: m.priceDelta,
			})),
			lineTotal: l.lineTotal,
			lineDiscount: l.lineDiscount,
			lineTax: l.lineTax,
			note: l.note,
			voidedAt: iso(l.voidedAt),
			voidReason: l.voidReason,
		})),
		payments: pays.map(({ p, by }) => ({
			id: p.id,
			method: p.method,
			state: p.state,
			amount: p.amount,
			tip: p.tip,
			tendered: p.tendered,
			reason: p.reason,
			businessDate: p.businessDate,
			createdAt: p.createdAt.toISOString(),
			createdByName: by,
		})),
	};
}

// ---------------------------------------------------------------- cash sessions

async function cashSessionList(
	tx: Tx,
	q: { locationId: string; from: string; to: string },
): Promise<AdminCashSession[]> {
	const sessions = await tx
		.select({ s: cashSessions, device: devices.name })
		.from(cashSessions)
		.innerJoin(devices, eq(devices.id, cashSessions.deviceId))
		.where(
			and(
				eq(cashSessions.locationId, q.locationId),
				between(cashSessions.businessDate, q.from, q.to),
			),
		)
		.orderBy(desc(cashSessions.openedAt))
		.limit(500);
	if (sessions.length === 0) return [];
	const ids = sessions.map((r) => r.s.id);
	const memberIds = [
		...new Set(
			sessions.flatMap((r) => [r.s.openedBy, r.s.closedBy ?? r.s.openedBy]),
		),
	];
	const cash = await tx
		.select({
			id: payments.cashSessionId,
			sales: sql<string>`coalesce(sum(case when ${payments.amount} > 0 then ${payments.amount} + ${payments.tip} else 0 end), 0)`,
			refunds: sql<string>`coalesce(-sum(case when ${payments.amount} < 0 then ${payments.amount} + ${payments.tip} else 0 end), 0)`,
		})
		.from(payments)
		.where(
			and(
				inArray(payments.cashSessionId, ids),
				eq(payments.method, "cash"),
				eq(payments.state, "succeeded"),
			),
		)
		.groupBy(payments.cashSessionId);
	const moves = await tx
		.select({ m: cashMovements, by: members.displayName })
		.from(cashMovements)
		.innerJoin(members, eq(members.id, cashMovements.createdBy))
		.where(inArray(cashMovements.cashSessionId, ids))
		.orderBy(asc(cashMovements.createdAt));
	const people = await tx
		.select({ id: members.id, name: members.displayName })
		.from(members)
		.where(inArray(members.id, memberIds));
	const nameOf = new Map(people.map((p) => [p.id, p.name]));
	const cashOf = new Map(cash.map((c) => [c.id, c]));
	return sessions.map(({ s, device }) => {
		const mine = moves.filter((m) => m.m.cashSessionId === s.id);
		const sum = (k: "pay_in" | "pay_out" | "drop") =>
			mine.filter((m) => m.m.kind === k).reduce((t, m) => t + m.m.amount, 0);
		const c = cashOf.get(s.id);
		const cashSales = n(c?.sales);
		const cashRefunds = n(c?.refunds);
		const payIns = sum("pay_in");
		const payOuts = sum("pay_out");
		const drops = sum("drop");
		const expected =
			s.expectedCash ??
			s.openingFloat + cashSales - cashRefunds + payIns - payOuts - drops;
		return {
			id: s.id,
			businessDate: s.businessDate,
			deviceName: device,
			status: s.status,
			openedAt: s.openedAt.toISOString(),
			openedByName: nameOf.get(s.openedBy) ?? "",
			closedAt: iso(s.closedAt),
			closedByName: s.closedBy ? (nameOf.get(s.closedBy) ?? null) : null,
			openingFloat: s.openingFloat,
			cashSales,
			cashRefunds,
			payIns,
			payOuts,
			drops,
			expectedCash: expected,
			countedCash: s.countedCash,
			variance:
				s.status === "closed" && s.countedCash !== null
					? s.countedCash - expected
					: null,
			notes: s.notes,
			movements: mine.map(({ m, by }) => ({
				kind: m.kind,
				amount: m.amount,
				reason: m.reason,
				createdAt: m.createdAt.toISOString(),
				byName: by,
			})),
		};
	});
}

// ---------------------------------------------------------------- routes

/** Reports and order history. Managers: their locations; owners/admins: all. */
export const adminReportRoutes = new Hono<AppEnv>()
	.get("/reports/sales", validate("query", SalesReportQuery), async (c) => {
		const q = c.req.valid("query");
		await checkRange(c, q);
		const report = await adminTx(c, (tx) => salesReport(tx, q));
		return c.json(report);
	})
	.get("/reports/trends", validate("query", SalesReportQuery), async (c) => {
		const q = c.req.valid("query");
		await checkRange(c, q);
		return c.json(await adminTx(c, (tx) => trendsReport(tx, q)));
	})
	.get("/cash-sessions", validate("query", CashSessionsQuery), async (c) => {
		const q = c.req.valid("query");
		await checkRange(c, q);
		return c.json(await adminTx(c, (tx) => cashSessionList(tx, q)));
	})
	.get("/orders", validate("query", AdminOrdersQuery), async (c) => {
		const q = c.req.valid("query");
		await checkRange(c, q);
		const after = q.cursor ? decodeCursor(q.cursor) : undefined;
		const rows = await adminTx(c, (tx) =>
			tx
				.select()
				.from(orders)
				.where(
					and(
						ordersWhere(q),
						after
							? or(
									lt(orders.placedAt, new Date(after.p)),
									and(
										eq(orders.placedAt, new Date(after.p)),
										lt(orders.id, after.i),
									),
								)
							: undefined,
					),
				)
				.orderBy(desc(orders.placedAt), desc(orders.id))
				.limit(q.limit + 1),
		);
		const page = rows.slice(0, q.limit);
		const last = page.at(-1);
		return c.json({
			items: page.map(orderRow),
			...(rows.length > q.limit && last
				? {
						nextCursor: encodeCursor({
							p: last.placedAt.toISOString(),
							i: last.id,
						}),
					}
				: {}),
		});
	})
	.get(
		"/orders.csv",
		validate("query", AdminOrdersQuery.omit({ cursor: true, limit: true })),
		async (c) => {
			const q = c.req.valid("query");
			await checkRange(c, q);
			const { rows, decimals, currency } = await adminTx(c, async (tx) => {
				const [loc] = await tx
					.select({
						d: locations.currencyDecimals,
						cur: locations.currencyCode,
					})
					.from(locations)
					.where(eq(locations.id, q.locationId));
				const rows = await tx
					.select()
					.from(orders)
					.where(ordersWhere(q))
					.orderBy(desc(orders.placedAt), desc(orders.id))
					.limit(CSV_MAX_ROWS + 1);
				return { rows, decimals: loc?.d ?? 3, currency: loc?.cur ?? "" };
			});
			if (rows.length > CSV_MAX_ROWS) {
				throw new ApiError(
					"bad_request",
					`more than ${CSV_MAX_ROWS} orders; narrow the range`,
				);
			}
			const money = (v: number) => formatDecimal(v as Minor, decimals);
			const header = [
				"ticket",
				"business_date",
				"placed_at",
				"source",
				"type",
				"payment_status",
				"fulfillment_status",
				"customer",
				"table",
				`subtotal_${currency}`,
				`discount_${currency}`,
				`tax_${currency}`,
				`total_${currency}`,
				`paid_${currency}`,
				"order_id",
			];
			const lines = rows.map((o) =>
				[
					o.ticketNumber,
					o.businessDate,
					o.placedAt.toISOString(),
					o.source,
					o.type,
					o.paymentStatus,
					o.fulfillmentStatus,
					o.customerName,
					o.tableLabel,
					money(o.subtotal),
					money(o.discountTotal),
					money(o.taxTotal),
					money(o.total),
					money(o.paidTotal),
					o.id,
				]
					.map(csvCell)
					.join(","),
			);
			const body = `${[header.join(","), ...lines].join("\r\n")}\r\n`;
			c.header("content-type", "text/csv; charset=utf-8");
			c.header(
				"content-disposition",
				`attachment; filename="orders-${q.from}-to-${q.to}.csv"`,
			);
			// UTF-8 BOM so Excel shows Arabic names correctly.
			return c.body(`﻿${body}`);
		},
	)
	.get("/orders/:id", async (c) => {
		const id = c.req.param("id");
		if (!UUID.test(id)) throw new ApiError("not_found", "order not found");
		const o = await adminTx(c, (tx) => orderDetail(tx, id));
		// A manager asking about another branch's order gets the same 404.
		if (!o || !c.var.admin.manages.has(o.locationId)) {
			throw new ApiError("not_found", "order not found");
		}
		return c.json(o);
	});
