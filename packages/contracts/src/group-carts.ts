import { z } from "zod";
import { Id, Instant, OrderType, Version } from "./common.js";
import { TableLabel } from "./orders.js";

/**
 * Group carts, under /v1/public. The cart `token` is the share link secret.
 * Each participant gets a one-time `secret` (kept in their browser) and sends
 * it as X-Participant-Secret; they can only edit their own items. Writes send
 * If-Match: <version>; a stale version gets 409 `conflict` with the current
 * cart in error.details. Items carry ids only, never prices: the cart is
 * re-priced from the live menu at submit.
 *
 *   POST   /locations/:slug/group-carts           CreateGroupCartRequest -> JoinGroupCartResponse (caller is host)
 *   POST   /group-carts/:token/participants       JoinGroupCartRequest   -> JoinGroupCartResponse
 *   GET    /group-carts/:token                    -> GroupCartView
 *   PUT    /group-carts/:token/items/:itemId      UpsertGroupCartItem    -> GroupCartView (own items only)
 *   DELETE /group-carts/:token/items/:itemId      -> GroupCartView (own items only)
 *   POST   /group-carts/:token/lock               -> GroupCartView (host only)
 *   POST   /group-carts/:token/unlock             -> GroupCartView (host only)
 *   POST   /group-carts/:token/submit             SubmitGroupCartRequest -> CreateGuestOrderResponse
 *                                                 (host only, Idempotency-Key required, cart must be locked)
 *   GET    /group-carts/:token/events             SSE of GroupCartEvent
 */
export const PARTICIPANT_SECRET_HEADER = "x-participant-secret";

export const GroupCartStatus = z.enum([
	"open",
	"locked",
	"submitted",
	"expired",
	"cancelled",
]);

export const CreateGroupCartRequest = z.object({
	displayName: z.string().min(1).max(40),
});
export const JoinGroupCartRequest = CreateGroupCartRequest;

export const GroupCartParticipant = z.object({
	id: Id,
	displayName: z.string(),
	isHost: z.boolean(),
});

export const GroupCartItem = z.object({
	id: Id,
	participantId: Id,
	productId: Id,
	quantity: z.int().min(1),
	modifierOptionIds: z.array(Id),
	note: z.string().nullable(),
});

export const GroupCartView = z.object({
	token: Id,
	status: GroupCartStatus,
	version: Version,
	expiresAt: Instant,
	participants: z.array(GroupCartParticipant),
	items: z.array(GroupCartItem),
	/** Set once submitted, so every participant can follow the order. */
	trackingToken: Id.nullable(),
});
export type GroupCartView = z.infer<typeof GroupCartView>;

export const JoinGroupCartResponse = z.object({
	participantId: Id,
	/** Shown once. The server stores only a hash. */
	secret: z.string(),
	cart: GroupCartView,
});

export const UpsertGroupCartItem = z.object({
	productId: Id,
	quantity: z.int().min(1).max(99),
	modifierOptionIds: z.array(Id).max(50).default([]),
	note: z.string().max(500).optional(),
});

export const SubmitGroupCartRequest = z.object({
	type: OrderType,
	customerName: z.string().max(80).optional(),
	customerPhone: z.string().max(20).optional(),
	tableLabel: TableLabel.optional(),
	note: z.string().max(500).optional(),
});

/** Hint only: refetch the cart on every event and on reconnect. */
export const GroupCartEvent = z.object({
	type: z.literal("cart.changed"),
	version: Version,
	status: GroupCartStatus,
});

export type GroupCartStatus = z.infer<typeof GroupCartStatus>;
export type CreateGroupCartRequest = z.infer<typeof CreateGroupCartRequest>;
export type JoinGroupCartRequest = z.infer<typeof JoinGroupCartRequest>;
export type GroupCartParticipant = z.infer<typeof GroupCartParticipant>;
export type GroupCartItem = z.infer<typeof GroupCartItem>;
export type JoinGroupCartResponse = z.infer<typeof JoinGroupCartResponse>;
export type UpsertGroupCartItem = z.infer<typeof UpsertGroupCartItem>;
export type SubmitGroupCartRequest = z.infer<typeof SubmitGroupCartRequest>;
export type GroupCartEvent = z.infer<typeof GroupCartEvent>;
