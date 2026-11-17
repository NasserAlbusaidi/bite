import { z } from "zod";

/** UUID (v7 for ids we generate; clients generate their own offline). */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/**
 * Money on the wire: a safe integer count of minor units (baisa for OMR).
 * Never a decimal string, never a float. Negative only where a schema says so.
 */
export const Minor = z.int().refine(Number.isSafeInteger, "not a safe integer");
export const NonNegMinor = Minor.refine((n) => n >= 0, "must be >= 0");
export const PosMinor = Minor.refine((n) => n > 0, "must be > 0");

/** Rates are integer basis points: 5% = 500, max 100%. */
export const Bps = z.int().min(0).max(10_000);

/** Localized text. `en` is required. */
export const LocalizedText = z.object({
	en: z.string().min(1),
	ar: z.string().min(1).optional(),
});
export type LocalizedText = z.infer<typeof LocalizedText>;

/** ISO 8601 instant with offset, e.g. 2026-11-17T13:52:11Z. */
export const Instant = z.iso.datetime({ offset: true });
/** Local business day, YYYY-MM-DD. */
export const BusinessDate = z.iso.date();

/** Optimistic concurrency version on mutable rows (orders, carts). */
export const Version = z.int().min(1);

/** Opaque pagination / sync cursor. Clients never parse it. */
export const Cursor = z.string().min(1).max(512);

export const OrderSource = z.enum(["guest", "counter", "group", "kiosk"]);
export const OrderType = z.enum(["dine_in", "takeaway"]);
export const PaymentStatus = z.enum([
	"unpaid",
	"partially_paid",
	"paid",
	"partially_refunded",
	"refunded",
]);
export const FulfillmentStatus = z.enum([
	"pending",
	"preparing",
	"ready",
	"completed",
	"cancelled",
]);
export const PaymentMethod = z.enum([
	"cash",
	"card",
	"softpos",
	"thawani",
	"stripe",
	"other",
]);
export const PaymentState = z.enum(["pending", "succeeded", "failed"]);
export const DeviceKind = z.enum(["pos", "kds", "kiosk"]);
export const OrgRole = z.enum(["owner", "admin", "staff"]);
export const LocationRole = z.enum(["manager", "cashier", "server", "kitchen"]);
export const CashMovementKind = z.enum(["pay_in", "pay_out", "drop"]);
