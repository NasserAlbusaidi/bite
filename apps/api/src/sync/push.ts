import { createHash } from "node:crypto";
import type {
	SyncMutation,
	SyncMutationResult,
	SyncPushRequest,
} from "@bite/contracts";
import { schema, type Tx, withTenant } from "@bite/db";
import { and, eq } from "@bite/db/orm";
import type { Deps, DeviceCtx, StaffCtx } from "../env.js";
import { assignTable, orderAtTable, setOrderTable } from "../floor/service.js";
import { ApiError, errorBody } from "../lib/errors.js";
import { setAvailability } from "../menu/availability.js";
import { addCashMovement, closeCashSession, openCashSession } from "./cash.js";
import type { MutationCtx, MutationOutcome } from "./context.js";
import {
	createPosOrder,
	isUniqueViolation,
	setFulfillment,
	voidLine,
} from "./orders.js";
import { addPayment, orderOfPayment, refundPayment } from "./payments.js";

const { memberLocations, syncMutations } = schema;

type Role = StaffCtx["role"];
type Rule = {
	roles: readonly Role[];
	/** KDS tablets may only bump tickets and 86 items. */
	kds?: boolean;
	/** The payload field that must equal entityId. */
	entity: (m: SyncMutation, tx: Tx) => Promise<string> | string;
};

const ALL: Role[] = ["manager", "cashier", "server", "kitchen"];
const RULES: Record<SyncMutation["kind"], Rule> = {
	"order.create": {
		roles: ["manager", "cashier", "server"],
		entity: (m) => (m.payload as { id: string }).id,
	},
	"order.addPayment": {
		roles: ["manager", "cashier", "server"],
		entity: (m) => (m.payload as { orderId: string }).orderId,
	},
	// Refunds are manager-only: money out of the drawer needs a second pair of eyes.
	"order.refund": {
		roles: ["manager"],
		entity: (m, tx) =>
			orderOfPayment(
				tx,
				(m.payload as { reversesPaymentId: string }).reversesPaymentId,
			),
	},
	"order.setFulfillment": {
		roles: ALL,
		kds: true,
		entity: (m) => (m.payload as { orderId: string }).orderId,
	},
	"order.voidLine": {
		roles: ["manager", "cashier"],
		entity: (m) => (m.payload as { orderId: string }).orderId,
	},
	"order.setTable": {
		roles: ["manager", "cashier", "server"],
		entity: (m) => (m.payload as { orderId: string }).orderId,
	},
	"order.atTable": {
		roles: ["manager", "cashier", "server"],
		entity: (m) => (m.payload as { orderId: string }).orderId,
	},
	"table.assign": {
		roles: ["manager", "cashier", "server"],
		entity: (m) => (m.payload as { tableId: string }).tableId,
	},
	"cash.open": {
		roles: ["manager", "cashier"],
		entity: (m) => (m.payload as { id: string }).id,
	},
	"cash.movement": {
		roles: ["manager", "cashier"],
		entity: (m) => (m.payload as { cashSessionId: string }).cashSessionId,
	},
	"cash.close": {
		roles: ["manager", "cashier"],
		entity: (m) => (m.payload as { cashSessionId: string }).cashSessionId,
	},
	"menu.setAvailability": {
		roles: ["manager", "cashier", "kitchen"],
		kds: true,
		entity: (m) => (m.payload as { productId: string }).productId,
	},
};

function apply(ctx: MutationCtx, m: SyncMutation): Promise<MutationOutcome> {
	switch (m.kind) {
		case "order.create":
			return createPosOrder(ctx, m.payload);
		case "order.addPayment":
			return addPayment(ctx, m.payload);
		case "order.refund":
			return refundPayment(ctx, m.entityId, m.payload);
		case "order.setFulfillment":
			return setFulfillment(ctx, m.payload);
		case "order.voidLine":
			return voidLine(ctx, m.payload);
		case "order.setTable":
			return setOrderTable(ctx, m.payload);
		case "order.atTable":
			return orderAtTable(ctx, m.payload);
		case "table.assign":
			return assignTable(ctx, m.payload);
		case "cash.open":
			return openCashSession(ctx, m.payload);
		case "cash.movement":
			return addCashMovement(ctx, m.payload);
		case "cash.close":
			return closeCashSession(ctx, m.payload);
		case "menu.setAvailability":
			return setAvailability(
				ctx.tx,
				ctx.device.orgId,
				ctx.device.locationId,
				m.payload.productId,
				m.payload.isAvailable,
			).then(() => ({}));
	}
}

function canonical(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(canonical);
	if (v && typeof v === "object") {
		return Object.fromEntries(
			Object.keys(v as object)
				.sort()
				.map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
		);
	}
	return v;
}
const fingerprint = (m: SyncMutation) =>
	createHash("sha256")
		.update(JSON.stringify(canonical(m)))
		.digest("hex");

/**
 * Apply an outbox batch in order. Each mutation runs in its own tenant
 * transaction together with its idempotency record, so "recorded" and
 * "applied/rejected" can't diverge. See contracts/sync.ts for the semantics.
 * An unexpected error aborts the push with a 500: everything before it is
 * committed and will come back as "duplicate" on retry.
 */
export async function pushMutations(
	deps: Deps,
	device: DeviceCtx,
	req: SyncPushRequest,
): Promise<SyncMutationResult[]> {
	if (req.deviceId !== device.deviceId) {
		throw new ApiError("forbidden", "deviceId does not match the device token");
	}
	const blocked = new Set<string>();
	const results: SyncMutationResult[] = [];
	for (const m of req.mutations) {
		results.push(await pushOne(deps, device, m, blocked));
	}
	return results;
}

async function pushOne(
	deps: Deps,
	device: DeviceCtx,
	m: SyncMutation,
	blocked: Set<string>,
): Promise<SyncMutationResult> {
	const fp = fingerprint(m);
	const base = { id: m.id, entityId: m.entityId };
	try {
		return await withTenant(deps.db, device.orgId, async (tx) => {
			const [prior] = await tx
				.select()
				.from(syncMutations)
				.where(eq(syncMutations.id, m.id));
			if (prior) {
				if (prior.fingerprint !== fp) {
					return {
						...base,
						status: "rejected",
						error: errorBody(
							new ApiError(
								"idempotency_mismatch",
								"this mutation id was used for a different mutation",
							),
						).error,
					} satisfies SyncMutationResult;
				}
				// Replays get the original outcome. An applied one is flagged
				// "duplicate" so the client knows nothing new happened.
				const original = prior.result as SyncMutationResult;
				return original.status === "applied"
					? { ...original, status: "duplicate" }
					: original;
			}
			if (blocked.has(m.entityId)) {
				return {
					...base,
					status: "blocked",
					error: {
						code: "unprocessable",
						message: "an earlier mutation on this entity failed",
					},
				} satisfies SyncMutationResult;
			}

			let result: SyncMutationResult;
			try {
				result = await tx.transaction(async (sp) => {
					const rule = RULES[m.kind];
					if (device.kind === "kds" && !rule.kds) {
						throw new ApiError("forbidden", `a KDS cannot ${m.kind}`);
					}
					const entity = await rule.entity(m, sp);
					if (entity !== m.entityId) {
						throw new ApiError(
							"bad_request",
							"entityId does not match the payload",
						);
					}
					// Offline work is attributed to whoever was logged in when it was
					// queued. They must belong to this location (deactivated since is
					// fine: the sale still happened).
					const [ml] = await sp
						.select({ role: memberLocations.role })
						.from(memberLocations)
						.where(
							and(
								eq(memberLocations.memberId, m.memberId),
								eq(memberLocations.locationId, device.locationId),
							),
						);
					if (!ml)
						throw new ApiError(
							"forbidden",
							"member is not staff at this location",
						);
					if (!rule.roles.includes(ml.role)) {
						throw new ApiError("forbidden", `role ${ml.role} cannot ${m.kind}`);
					}
					const out = await apply(
						{
							tx: sp,
							device,
							member: { memberId: m.memberId, role: ml.role },
							now: deps.now?.() ?? new Date(),
							baseVersion: m.baseVersion,
						},
						m,
					);
					return {
						...base,
						status: "applied",
						...(out.entityVersion === undefined
							? {}
							: { entityVersion: out.entityVersion }),
					} satisfies SyncMutationResult;
				});
			} catch (err) {
				if (!(err instanceof ApiError)) throw err;
				blocked.add(m.entityId);
				const error = errorBody(err).error;
				if (err.code === "conflict") {
					// Retryable after a pull: not recorded.
					const v = (err.details as { currentVersion?: number } | undefined)
						?.currentVersion;
					return {
						...base,
						status: "conflict",
						error,
						...(v === undefined ? {} : { entityVersion: v }),
					} satisfies SyncMutationResult;
				}
				result = { ...base, status: "rejected", error };
			}
			await tx.insert(syncMutations).values({
				id: m.id,
				orgId: device.orgId,
				deviceId: device.deviceId,
				memberId: m.memberId,
				kind: m.kind,
				entityId: m.entityId,
				fingerprint: fp,
				result,
			});
			return result;
		});
	} catch (err) {
		// Same id pushed concurrently (two retries racing): the other one won.
		if (isUniqueViolation(err, "sync_mutations_org_id_id_pk")) {
			return pushOne(deps, device, m, blocked);
		}
		// A rejection whose recording failed (e.g. unknown memberId breaks the FK).
		if ((err as { cause?: { code?: string } })?.cause?.code === "23503") {
			blocked.add(m.entityId);
			return {
				...base,
				status: "rejected",
				error: {
					code: "forbidden",
					message: "member is not staff at this location",
				},
			};
		}
		throw err;
	}
}
