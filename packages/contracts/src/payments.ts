import { z } from "zod";
import {
	BusinessDate,
	Id,
	Instant,
	NonNegMinor,
	PaymentMethod,
	PaymentState,
	PosMinor,
} from "./common.js";

/** Record money in (sync kind "order.addPayment"). A split bill = several of these. */
export const AddPayment = z
	.object({
		/** Client-generated UUIDv7. */
		id: Id,
		orderId: Id,
		amount: PosMinor,
		/** Cash only: what the customer handed over. Change = tendered - amount. */
		tendered: PosMinor.optional(),
		tip: NonNegMinor.default(0),
		method: PaymentMethod,
		/** Required for cash. */
		cashSessionId: Id.optional(),
		businessDate: BusinessDate,
		providerReference: z.string().max(200).optional(),
	})
	.refine((p) => p.method === "cash" || p.tendered === undefined, {
		message: "tendered is cash only",
		path: ["tendered"],
	})
	.refine((p) => p.tendered === undefined || p.tendered >= p.amount, {
		message: "tendered must cover amount",
		path: ["tendered"],
	})
	.refine((p) => p.method !== "cash" || p.cashSessionId !== undefined, {
		message: "cash needs an open cash session",
		path: ["cashSessionId"],
	});

/** Refund = a new negative ledger row (sync kind "order.refund"). Amount is positive here. */
export const RefundPayment = z.object({
	id: Id,
	reversesPaymentId: Id,
	amount: PosMinor,
	reason: z.string().min(1).max(200),
	cashSessionId: Id.optional(),
	businessDate: BusinessDate,
});

export const Payment = z.object({
	id: Id,
	orderId: Id,
	amount: z.int(),
	tendered: z.int().nullable(),
	tip: NonNegMinor,
	method: PaymentMethod,
	state: PaymentState,
	reversesPaymentId: Id.nullable(),
	reason: z.string().nullable(),
	businessDate: BusinessDate,
	createdAt: Instant,
});

export type AddPayment = z.infer<typeof AddPayment>;
export type RefundPayment = z.infer<typeof RefundPayment>;
export type Payment = z.infer<typeof Payment>;
