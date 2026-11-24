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
	"loyalty",
]);
export const PaymentState = z.enum(["pending", "succeeded", "failed"]);
export const DeviceKind = z.enum(["pos", "kds", "kiosk"]);
export const OrgRole = z.enum(["owner", "admin", "staff"]);
export const LocationRole = z.enum(["manager", "cashier", "server", "kitchen"]);
export const CashMovementKind = z.enum(["pay_in", "pay_out", "drop"]);

export type Minor = z.infer<typeof Minor>;
export type NonNegMinor = z.infer<typeof NonNegMinor>;
export type PosMinor = z.infer<typeof PosMinor>;
export type Bps = z.infer<typeof Bps>;
export type Instant = z.infer<typeof Instant>;
export type BusinessDate = z.infer<typeof BusinessDate>;
export type Version = z.infer<typeof Version>;
export type Cursor = z.infer<typeof Cursor>;
export type OrderSource = z.infer<typeof OrderSource>;
export type OrderType = z.infer<typeof OrderType>;
export type PaymentStatus = z.infer<typeof PaymentStatus>;
export type FulfillmentStatus = z.infer<typeof FulfillmentStatus>;
export type PaymentMethod = z.infer<typeof PaymentMethod>;
export type PaymentState = z.infer<typeof PaymentState>;
export type DeviceKind = z.infer<typeof DeviceKind>;
export type OrgRole = z.infer<typeof OrgRole>;
export type LocationRole = z.infer<typeof LocationRole>;
export type CashMovementKind = z.infer<typeof CashMovementKind>;
