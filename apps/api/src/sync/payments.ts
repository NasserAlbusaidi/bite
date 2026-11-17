import type { AddPayment, RefundPayment } from "@bite/contracts";
import {
	checkTender,
	type LedgerEntry,
	minor,
	refundableAmount,
	summarizePayments,
} from "@bite/core";
import { schema, type Tx } from "@bite/db";
import { and, eq, sql } from "@bite/db/orm";
import { ApiError } from "../lib/errors.js";
import type { MutationCtx, MutationOutcome } from "./context.js";
import { isUniqueViolation, lockOrder, reject } from "./orders.js";

const { cashSessions, orders, payments } = schema;

/** Methods a tablet may record directly. Online providers settle via webhooks. */
const POS_METHODS = new Set(["cash", "card", "softpos", "other"]);

async function ledger(tx: Tx, orderId: string): Promise<LedgerEntry[]> {
	const rows = await tx
		.select({
			id: payments.id,
			amount: payments.amount,
			method: payments.method,
			state: payments.state,
			reversesPaymentId: payments.reversesPaymentId,
		})
		.from(payments)
		.where(eq(payments.orderId, orderId));
	return rows.map((r) => ({ ...r, amount: minor(r.amount) }));
}

/** The cash session must be open and belong to THIS device's drawer. */
async function requireOpenSession(ctx: MutationCtx, sessionId: string) {
	const [s] = await ctx.tx
		.select({ id: cashSessions.id })
		.from(cashSessions)
		.where(
			and(
				eq(cashSessions.id, sessionId),
				eq(cashSessions.deviceId, ctx.device.deviceId),
				eq(cashSessions.status, "open"),
			),
		);
	if (!s)
		throw reject(
			"cash_session_not_open",
			"cash session is not open on this device",
		);
}

/** Recompute paid_total + payment_status from the ledger and bump the version. */
async function settle(tx: Tx, orderId: string, total: number) {
	const s = summarizePayments(minor(total), await ledger(tx, orderId));
	const [u] = await tx
		.update(orders)
		.set({
			paidTotal: s.net,
			paymentStatus: s.status,
			version: sql`${orders.version} + 1`,
		})
		.where(eq(orders.id, orderId))
		.returning({ version: orders.version });
	return u?.version;
}

export async function addPayment(
	ctx: MutationCtx,
	p: AddPayment,
): Promise<MutationOutcome> {
	const { tx, device } = ctx;
	if (!POS_METHODS.has(p.method)) {
		throw reject(
			"method_not_allowed",
			`${p.method} is settled online, not from a tablet`,
		);
	}
	const o = await lockOrder(tx, p.orderId, device.locationId);
	// No baseVersion check: a split bill is several payments queued offline in a
	// row, and overpayment is what actually matters; checkTender guards that.
	if (o.fulfillmentStatus === "cancelled")
		throw reject("order_cancelled", "order is cancelled");
	if (p.method === "cash" && p.cashSessionId)
		await requireOpenSession(ctx, p.cashSessionId);
	const check = checkTender(
		summarizePayments(minor(o.total), await ledger(tx, o.id)),
		{
			amount: minor(p.amount),
			method: p.method,
			tendered: p.tendered === undefined ? null : minor(p.tendered),
		},
	);
	if (!check.ok) throw reject(check.error, "payment refused");
	try {
		await tx.insert(payments).values({
			id: p.id,
			orgId: device.orgId,
			locationId: device.locationId,
			orderId: o.id,
			cashSessionId: p.method === "cash" ? (p.cashSessionId ?? null) : null,
			amount: p.amount,
			tendered: p.tendered ?? null,
			tip: p.tip,
			method: p.method,
			state: "succeeded",
			providerReference: p.providerReference ?? null,
			provider: p.providerReference ? p.method : null,
			createdBy: ctx.member.memberId,
			deviceId: device.deviceId,
			businessDate: p.businessDate,
			resolvedAt: ctx.now,
		});
	} catch (err) {
		if (isUniqueViolation(err))
			throw reject("payment_exists", "payment id or reference already used");
		throw err;
	}
	return { entityVersion: await settle(tx, o.id, o.total) };
}

/** Refund = new negative row against one payment, same method. Manager only (enforced by the caller). */
export async function refundPayment(
	ctx: MutationCtx,
	orderId: string,
	p: RefundPayment,
): Promise<MutationOutcome> {
	const { tx, device } = ctx;
	const o = await lockOrder(tx, orderId, device.locationId);
	const entries = await ledger(tx, o.id);
	const original = entries.find((e) => e.id === p.reversesPaymentId);
	if (!original || original.amount <= 0 || original.state !== "succeeded") {
		throw reject(
			"not_refundable",
			"no succeeded payment with that id on this order",
		);
	}
	if (p.amount > refundableAmount(p.reversesPaymentId, entries)) {
		throw reject(
			"refund_too_large",
			"more than is left to refund on that payment",
		);
	}
	if (original.method === "cash") {
		if (!p.cashSessionId)
			throw reject(
				"cash_session_required",
				"cash refunds come out of a drawer",
			);
		await requireOpenSession(ctx, p.cashSessionId);
	}
	try {
		await tx.insert(payments).values({
			id: p.id,
			orgId: device.orgId,
			locationId: device.locationId,
			orderId: o.id,
			cashSessionId:
				original.method === "cash" ? (p.cashSessionId ?? null) : null,
			amount: -p.amount,
			method: original.method,
			state: "succeeded",
			reversesPaymentId: p.reversesPaymentId,
			reason: p.reason,
			createdBy: ctx.member.memberId,
			deviceId: device.deviceId,
			businessDate: p.businessDate,
			resolvedAt: ctx.now,
		});
	} catch (err) {
		if (isUniqueViolation(err))
			throw reject("payment_exists", "payment id already used");
		throw err;
	}
	return { entityVersion: await settle(tx, o.id, o.total) };
}

/** Which order a refund belongs to: the order of the payment it reverses. */
export async function orderOfPayment(
	tx: Tx,
	paymentId: string,
): Promise<string> {
	const [r] = await tx
		.select({ orderId: payments.orderId })
		.from(payments)
		.where(eq(payments.id, paymentId));
	if (!r) throw new ApiError("not_found", "no such payment");
	return r.orderId;
}
