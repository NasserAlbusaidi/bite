import { z } from "zod";
import { FulfillmentStatus, Id, PaymentStatus, Version } from "./common.js";

/**
 * Server-sent events on GET /v1/realtime (device token or staff session).
 * Scoped to the caller's location. Events are hints, not data: on any event
 * the client pulls (sync pull for tablets, refetch for web). On reconnect,
 * always pull once, because events missed while disconnected are not replayed.
 */
export const RealtimeEvent = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("order.changed"),
		orderId: Id,
		version: Version,
		paymentStatus: PaymentStatus,
		fulfillmentStatus: FulfillmentStatus,
	}),
	z.object({ type: z.literal("menu.changed"), menuVersion: z.string() }),
	z.object({ type: z.literal("device.revoked"), deviceId: Id }),
]);
export type RealtimeEvent = z.infer<typeof RealtimeEvent>;
