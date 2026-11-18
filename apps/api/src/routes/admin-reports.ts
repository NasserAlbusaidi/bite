import {
	type AdminOrderRow,
	AdminOrdersQuery,
	type SalesReport,
	SalesReportQuery,
} from "@bite/contracts";
import { formatDecimal, type Minor } from "@bite/core";
import { schema, type Tx } from "@bite/db";
import { and, between, desc, eq, isNull, lt, ne, or, sql } from "@bite/db/orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { requireHistory } from "../lib/entitlements.js";
import { ApiError } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { adminTx, requireLocation } from "../middleware/admin-auth.js";

const { orders, orderLines, payments, locations } = schema;

const MAX_DAYS = 366;
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
};

function ordersWhere(q: OrdersFilter) {
	return and(
		eq(orders.locationId, q.locationId),
		between(orders.businessDate, q.from, q.to),
		q.paymentStatus ? eq(orders.paymentStatus, q.paymentStatus) : undefined,
		q.fulfillmentStatus
			? eq(orders.fulfillmentStatus, q.fulfillmentStatus)
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

// ---------------------------------------------------------------- routes

/** Reports and order history. Managers: their locations; owners/admins: all. */
export const adminReportRoutes = new Hono<AppEnv>()
	.get("/reports/sales", validate("query", SalesReportQuery), async (c) => {
		const q = c.req.valid("query");
		await checkRange(c, q);
		const report = await adminTx(c, (tx) => salesReport(tx, q));
		return c.json(report);
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
	);
