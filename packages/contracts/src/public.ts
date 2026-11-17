import { z } from "zod";
import { Id } from "./common.js";
import { MenuSnapshot } from "./menu.js";
import { GuestOrderView } from "./orders.js";

/**
 * Unauthenticated guest routes, all under /v1/public:
 *   GET  /locations/:slug/menu        -> PublicMenuResponse
 *   POST /locations/:slug/orders      -> CreateGuestOrderResponse (Idempotency-Key required)
 *   GET  /orders/:trackingToken       -> GuestOrderView
 *   group carts: see group-carts.ts
 */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export const GuestLocation = z.object({
	slug: z.string(),
	name: z.string(),
	orgName: z.string(),
	/** False when closed, paused by staff, or no open shift. */
	isAcceptingOrders: z.boolean(),
	theme: z.object({
		accent: z.string().optional(),
		logoUrl: z.string().optional(),
	}),
});

export const PublicMenuResponse = z.object({
	location: GuestLocation,
	menu: MenuSnapshot,
});

/**
 * error.details on a 422 `unprocessable` for guest orders and cart submits.
 * lineIds are the client OrderLineInput / cart item ids that failed.
 */
export const GuestOrderRejectReason = z.enum([
	"not_accepting_orders",
	"items_unavailable",
	"invalid_modifiers",
	"total_too_high",
	"cart_not_open",
	"cart_empty",
]);
export const GuestOrderRejectDetails = z.object({
	reason: GuestOrderRejectReason,
	lineIds: z.array(Id).optional(),
});

export const GuestTrackingResponse = GuestOrderView;
