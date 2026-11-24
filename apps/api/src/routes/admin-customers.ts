import {
	AdjustPoints,
	type AdminCustomer,
	type AdminCustomerDetail,
	AdminCustomersQuery,
	LoyaltyProgram,
} from "@bite/contracts";
import { schema, type Tx } from "@bite/db";
import { and, desc, eq, ilike, or, sql } from "@bite/db/orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { loadProgram, saveProgram } from "../loyalty/service.js";
import { adminTx, requireOrgWide } from "../middleware/admin-auth.js";

const { customers, loyaltyLedger, orders, orderLines, locations } = schema;

/** Paid money only: what the guest actually spent with us. */
const spentSql = sql<number>`coalesce((
	select sum(o.paid_total) from orders o
	where o.customer_id = "customers"."id" and o.org_id = "customers"."org_id"
), 0)::int8`;

const SORTS = {
	recent: sql`${customers.lastVisitAt} desc nulls last`,
	visits: sql`${customers.visitCount} desc`,
	spent: sql`${spentSql} desc`,
	points: sql`${customers.points} desc`,
};

type Row = typeof customers.$inferSelect & { spent: number };
const toCustomer = (r: Row): AdminCustomer => ({
	id: r.id,
	name: r.name,
	phone: r.phone,
	points: r.points,
	visitCount: r.visitCount,
	totalSpent: Number(r.spent),
	lastVisitAt: r.lastVisitAt?.toISOString() ?? null,
	createdAt: r.createdAt.toISOString(),
});

async function loadDetail(
	tx: Tx,
	id: string,
): Promise<AdminCustomerDetail | null> {
	const [c] = await tx
		.select({ c: customers, spent: spentSql })
		.from(customers)
		.where(eq(customers.id, id));
	if (!c) return null;
	const os = await tx
		.select({
			id: orders.id,
			ticketNumber: orders.ticketNumber,
			businessDate: orders.businessDate,
			locationName: locations.name,
			total: orders.total,
			paymentStatus: orders.paymentStatus,
		})
		.from(orders)
		.innerJoin(locations, eq(locations.id, orders.locationId))
		.where(eq(orders.customerId, id))
		.orderBy(desc(orders.placedAt))
		.limit(20);
	const favorites = await tx
		.select({
			name: orderLines.name,
			count: sql<number>`sum(${orderLines.quantity})::int`,
		})
		.from(orderLines)
		.innerJoin(orders, eq(orders.id, orderLines.orderId))
		.where(and(eq(orders.customerId, id), sql`${orderLines.voidedAt} is null`))
		.groupBy(orderLines.name)
		.orderBy(sql`2 desc`)
		.limit(3);
	const ledger = await tx
		.select({ l: loyaltyLedger, ticketNumber: orders.ticketNumber })
		.from(loyaltyLedger)
		.leftJoin(orders, eq(orders.id, loyaltyLedger.orderId))
		.where(eq(loyaltyLedger.customerId, id))
		.orderBy(desc(loyaltyLedger.createdAt))
		.limit(30);
	return {
		...toCustomer({ ...c.c, spent: c.spent }),
		favorites: favorites.map((f) => ({ name: f.name, count: Number(f.count) })),
		orders: os,
		ledger: ledger.map(({ l, ticketNumber }) => ({
			id: l.id,
			kind: l.kind,
			points: l.points,
			ticketNumber,
			rewardId: l.rewardId,
			reason: l.reason,
			createdAt: l.createdAt.toISOString(),
		})),
	};
}

/** Guests (loyalty customers, per org) and the loyalty program. */
export const adminCustomerRoutes = new Hono<AppEnv>()
	.get("/loyalty", async (c) =>
		c.json(await adminTx(c, (tx) => loadProgram(tx, c.var.admin.orgId))),
	)
	.put("/loyalty", validate("json", LoyaltyProgram), async (c) => {
		requireOrgWide(c);
		const body = c.req.valid("json");
		const out = await adminTx(c, async (tx) => {
			await saveProgram(tx, c.var.admin.orgId, body);
			return loadProgram(tx, c.var.admin.orgId);
		});
		return c.json(out);
	})
	.get("/customers", validate("query", AdminCustomersQuery), async (c) => {
		const q = c.req.valid("query");
		const term = q.q?.trim();
		const digits = term?.replace(/\D/g, "");
		const rows = await adminTx(c, (tx) =>
			tx
				.select({ c: customers, spent: spentSql })
				.from(customers)
				.where(
					term
						? or(
								ilike(customers.name, `%${term.replace(/[%_\\]/g, "")}%`),
								digits && digits.length >= 3
									? ilike(customers.phone, `%${digits}%`)
									: undefined,
							)
						: undefined,
				)
				.orderBy(SORTS[q.sort ?? "recent"], desc(customers.id))
				.limit(q.limit ?? 100),
		);
		return c.json({
			items: rows.map((r) => toCustomer({ ...r.c, spent: r.spent })),
		});
	})
	.get(
		"/customers/:id",
		validate("param", z.object({ id: z.uuid() })),
		async (c) => {
			const d = await adminTx(c, (tx) =>
				loadDetail(tx, c.req.valid("param").id),
			);
			if (!d) throw new ApiError("not_found", "no such guest");
			return c.json(d);
		},
	)
	.post(
		"/customers/:id/points",
		validate("param", z.object({ id: z.uuid() })),
		validate("json", AdjustPoints),
		async (c) => {
			const { id } = c.req.valid("param");
			const { points, reason } = c.req.valid("json");
			const a = c.var.admin;
			const d = await adminTx(c, async (tx) => {
				const [cust] = await tx
					.select()
					.from(customers)
					.where(eq(customers.id, id))
					.for("update");
				if (!cust) throw new ApiError("not_found", "no such guest");
				if (cust.points + points < 0)
					throw new ApiError("unprocessable", "balance can't go below zero");
				await tx.insert(loyaltyLedger).values({
					orgId: a.orgId,
					customerId: id,
					kind: "adjust",
					points,
					reason,
					createdBy: a.memberId,
				});
				await tx
					.update(customers)
					.set({ points: sql`${customers.points} + ${points}` })
					.where(eq(customers.id, id));
				return loadDetail(tx, id);
			});
			return c.json(d);
		},
	);
