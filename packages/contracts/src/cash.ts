import { z } from "zod";
import {
	BusinessDate,
	CashMovementKind,
	Id,
	NonNegMinor,
	PosMinor,
} from "./common.js";

/** sync kind "cash.open". One open session per device. */
export const OpenCashSession = z.object({
	id: Id,
	businessDate: BusinessDate,
	openingFloat: NonNegMinor,
});

/** sync kind "cash.movement". */
export const CashMovement = z.object({
	id: Id,
	cashSessionId: Id,
	kind: CashMovementKind,
	amount: PosMinor,
	reason: z.string().min(1).max(200),
});

/** sync kind "cash.close". Server computes expected cash; the tablet sends the count. */
export const CloseCashSession = z.object({
	cashSessionId: Id,
	countedCash: NonNegMinor,
	/** Denomination (minor units, as string key) -> count. */
	countDetail: z.record(z.string().regex(/^\d+$/), z.int().min(0)).optional(),
	notes: z.string().max(500).optional(),
});

export type OpenCashSession = z.infer<typeof OpenCashSession>;
export type CashMovement = z.infer<typeof CashMovement>;
export type CloseCashSession = z.infer<typeof CloseCashSession>;
