import { z } from "zod";
import { Entitlements } from "./billing.js";
import { CashMovement, CloseCashSession, OpenCashSession } from "./cash.js";
import {
	BusinessDate,
	Cursor,
	Id,
	Instant,
	Minor,
	NonNegMinor,
	Version,
} from "./common.js";
import { ErrorBody } from "./errors.js";
import { AssignTable, Floor, SetOrderTable } from "./floor.js";
import { MenuSnapshot } from "./menu.js";
import { CreatePosOrder, Order, SetFulfillment, VoidLine } from "./orders.js";
import { AddPayment, RefundPayment } from "./payments.js";

/**
 * Offline outbox replay. The tablet queues mutations locally and pushes them
 * in order. `id` is a client UUIDv7 and doubles as the idempotency key:
 * pushing the same id again returns the ORIGINAL result (status "duplicate"),
 * never an error, so a lost response is always safe to retry.
 *
 * Auth: device bearer token. Staff attribution: X-Staff-Token at push time
 * is NOT used for offline work (the staff session may have expired since);
 * each mutation carries the memberId that was logged in when it was queued.
 */
const base = {
	id: Id,
	/**
	 * The aggregate the mutation belongs to: the ORDER id for every order.*
	 * kind (payments and refunds included), the cash session id for cash.*,
	 * the product id for menu.*, the floor table id for table.*. Chains are blocked per entityId (see below).
	 */
	entityId: Id,
	/** Version the tablet last saw. Omit for creates. Mismatch => "conflict". */
	baseVersion: Version.optional(),
	/** Staff member who did it on the tablet. Must belong to the device's location. */
	memberId: Id,
	/** When it happened on the tablet (for audit, not ordering). */
	createdAt: Instant,
};

export const SyncMutation = z.discriminatedUnion("kind", [
	z.object({
		...base,
		kind: z.literal("order.create"),
		payload: CreatePosOrder,
	}),
	z.object({
		...base,
		kind: z.literal("order.addPayment"),
		payload: AddPayment,
	}),
	z.object({
		...base,
		kind: z.literal("order.refund"),
		payload: RefundPayment,
	}),
	z.object({
		...base,
		kind: z.literal("order.setFulfillment"),
		payload: SetFulfillment,
	}),
	z.object({ ...base, kind: z.literal("order.voidLine"), payload: VoidLine }),
	z.object({
		...base,
		kind: z.literal("order.setTable"),
		payload: SetOrderTable,
	}),
	z.object({
		...base,
		kind: z.literal("table.assign"),
		payload: AssignTable,
	}),
	z.object({ ...base, kind: z.literal("cash.open"), payload: OpenCashSession }),
	z.object({
		...base,
		kind: z.literal("cash.movement"),
		payload: CashMovement,
	}),
	z.object({
		...base,
		kind: z.literal("cash.close"),
		payload: CloseCashSession,
	}),
	z.object({
		...base,
		kind: z.literal("menu.setAvailability"),
		payload: z.object({ productId: Id, isAvailable: z.boolean() }),
	}),
]);
export type SyncMutation = z.infer<typeof SyncMutation>;
export type SyncMutationKind = SyncMutation["kind"];

export const SyncPushRequest = z.object({
	/** Must match the device token's device. Redundant on purpose: catches mixed-up tablets. */
	deviceId: Id,
	mutations: z.array(SyncMutation).min(1).max(100),
});

export const SyncMutationStatus = z.enum([
	"applied", // done now
	"duplicate", // done before; this is the original result
	"conflict", // baseVersion stale; pull, rebase, re-queue with a NEW id
	"rejected", // invalid (validation, domain rule); do not retry as-is
	"blocked", // not attempted: an earlier mutation on the same entityId in this push was rejected/conflicted
]);

export const SyncMutationResult = z.object({
	id: Id,
	status: SyncMutationStatus,
	entityId: Id,
	/** Version after applying (or current version on conflict). */
	entityVersion: Version.optional(),
	error: ErrorBody.shape.error.optional(),
});
export type SyncMutationResult = z.infer<typeof SyncMutationResult>;

/**
 * Results come back in request order. Mutations are applied in order, each in
 * its own transaction. Once a mutation on entityId E is rejected or conflicts,
 * every later mutation on E in the same push is answered "blocked" without
 * being applied, because offline chains can't carry a reliable baseVersion
 * and must not land on a state the cashier never saw. Other entities carry on.
 * "blocked" mutations are NOT recorded, so the same ids can be pushed again
 * once the blocker is resolved.
 */
export const SyncPushResponse = z.object({
	results: z.array(SyncMutationResult),
});

export const SyncPullQuery = z.object({
	/** Absent on first sync. */
	cursor: Cursor.optional(),
	/** The menuVersion the tablet has; the snapshot is only sent when it differs. */
	menuVersion: z.string().optional(),
});

export const OpenDrawer = z.object({
	id: Id,
	businessDate: BusinessDate,
	openingFloat: NonNegMinor,
	openedBy: Id,
	openedAt: Instant,
	/**
	 * Cash that went into the drawer on the server so far, float excluded:
	 * cash payments and tips, minus cash refunds, plus pay ins, minus pay
	 * outs and drops. The server's expected cash at close is float + this.
	 */
	cashSoFar: Minor,
});
export type OpenDrawer = z.infer<typeof OpenDrawer>;

export const SyncPullResponse = z.object({
	cursor: Cursor,
	/** True = call again immediately with the new cursor. */
	hasMore: z.boolean(),
	menuVersion: z.string(),
	/** Present only when menuVersion differs from the one sent. */
	menu: MenuSnapshot.optional(),
	/** Orders at this location changed since the cursor (any device, QR included). */
	orders: z.array(Order),
	/**
	 * The cash session the server still has open for THIS device, or null.
	 * A re-paired or reset tablet adopts it instead of opening a second one
	 * (the server allows one open session per device). Sent on every page.
	 */
	cashSession: OpenDrawer.nullable().optional(),
	/**
	 * The org's plan, for showing or hiding features on the tablet. Sent on
	 * every page. A tablet keeps the last copy and trusts it until its
	 * `validUntil`; selling for cash is never gated by it.
	 */
	entitlements: Entitlements.optional(),
	/**
	 * This branch's floor plan with today's server assignments. Sent on every
	 * page (it is small); absent from servers older than floor plans.
	 */
	floor: Floor.optional(),
});

export type SyncPushRequest = z.infer<typeof SyncPushRequest>;
export type SyncMutationStatus = z.infer<typeof SyncMutationStatus>;
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;
export type SyncPullQuery = z.infer<typeof SyncPullQuery>;
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;
