import type {
	CashMovement,
	CloseCashSession,
	OpenCashSession,
} from "@bite/contracts";
import { schema } from "@bite/db";
import { and, eq, sql } from "@bite/db/orm";
import { ApiError } from "../lib/errors.js";
import type { MutationCtx, MutationOutcome } from "./context.js";
import { isUniqueViolation, reject } from "./orders.js";

const { cashMovements, cashSessions, payments } = schema;

export async function openCashSession(
	ctx: MutationCtx,
	p: OpenCashSession,
): Promise<MutationOutcome> {
	const { device } = ctx;
	try {
		await ctx.tx.insert(cashSessions).values({
			id: p.id,
			orgId: device.orgId,
			locationId: device.locationId,
			deviceId: device.deviceId,
			businessDate: p.businessDate,
			openedBy: ctx.member.memberId,
			openingFloat: p.openingFloat,
		});
	} catch (err) {
		if (isUniqueViolation(err, "cash_sessions_one_open_per_device")) {
			throw reject(
				"session_already_open",
				"this drawer already has an open session",
			);
		}
		if (isUniqueViolation(err))
			throw reject("session_exists", "session id already used");
		throw err;
	}
	return {};
}

async function lockOpenSession(ctx: MutationCtx, id: string) {
	const [s] = await ctx.tx
		.select()
		.from(cashSessions)
		.where(
			and(
				eq(cashSessions.id, id),
				eq(cashSessions.deviceId, ctx.device.deviceId),
			),
		)
		.for("update");
	if (!s)
		throw new ApiError("not_found", "no such cash session on this device");
	if (s.status !== "open")
		throw reject("cash_session_not_open", "cash session is closed");
	return s;
}

export async function addCashMovement(
	ctx: MutationCtx,
	p: CashMovement,
): Promise<MutationOutcome> {
	await lockOpenSession(ctx, p.cashSessionId);
	try {
		await ctx.tx.insert(cashMovements).values({
			id: p.id,
			orgId: ctx.device.orgId,
			cashSessionId: p.cashSessionId,
			kind: p.kind,
			amount: p.amount,
			reason: p.reason,
			createdBy: ctx.member.memberId,
		});
	} catch (err) {
		if (isUniqueViolation(err))
			throw reject("movement_exists", "movement id already used");
		throw err;
	}
	return {};
}

type Tx = MutationCtx["tx"];

/**
 * Cash into the drawer so far, float excluded: succeeded cash payments and
 * tips (refunds are negative rows, so they subtract) + pay-ins - pay-outs -
 * drops. Also sent on pull so a re-paired tablet can adopt the session.
 */
export async function cashSoFar(tx: Tx, sessionId: string): Promise<number> {
	const [pay] = await tx
		.select({
			total: sql<string>`coalesce(sum(${payments.amount} + ${payments.tip}), 0)`,
		})
		.from(payments)
		.where(
			and(
				eq(payments.cashSessionId, sessionId),
				eq(payments.method, "cash"),
				eq(payments.state, "succeeded"),
			),
		);
	const [mov] = await tx
		.select({
			net: sql<string>`coalesce(sum(case when ${cashMovements.kind} = 'pay_in' then ${cashMovements.amount} else -${cashMovements.amount} end), 0)`,
		})
		.from(cashMovements)
		.where(eq(cashMovements.cashSessionId, sessionId));
	return Number(pay?.total ?? 0) + Number(mov?.net ?? 0);
}

/**
 * Expected = float + succeeded cash payments (refunds are negative rows, so
 * they subtract) + pay-ins - pay-outs - drops. Tips are in the drawer too.
 */
export async function closeCashSession(
	ctx: MutationCtx,
	p: CloseCashSession,
): Promise<MutationOutcome> {
	const s = await lockOpenSession(ctx, p.cashSessionId);
	const expectedCash = s.openingFloat + (await cashSoFar(ctx.tx, s.id));
	await ctx.tx
		.update(cashSessions)
		.set({
			status: "closed",
			closedBy: ctx.member.memberId,
			closedAt: ctx.now,
			expectedCash,
			countedCash: p.countedCash,
			countDetail: p.countDetail ?? null,
			notes: p.notes ?? null,
		})
		.where(eq(cashSessions.id, s.id));
	return {};
}
