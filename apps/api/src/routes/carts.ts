import {
	CreateGroupCartRequest,
	type CreateGuestOrderResponse,
	GroupCartEvent,
	IDEMPOTENCY_KEY_HEADER,
	JoinGroupCartRequest,
	type JoinGroupCartResponse,
	PARTICIPANT_SECRET_HEADER,
	SubmitGroupCartRequest,
	UpsertGroupCartItem,
} from "@bite/contracts";
import { schema } from "@bite/db";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
	bump,
	CART_TTL_MS,
	type CartCtx,
	cartTx,
	cartView,
	checkIfMatch,
	MAX_ITEMS,
	MAX_PARTICIPANTS,
	participant,
	requireStatus,
} from "../carts/service.js";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { slugTx } from "../lib/public-tenant.js";
import { newSecret, sha256 } from "../lib/tokens.js";
import { validate } from "../lib/validate.js";
import { loadOrderDto } from "../orders/dto.js";
import {
	guestFingerprint,
	placeGuestOrder,
	rejectGuest,
	toGuestView,
} from "../orders/guest.js";

const { groupCarts, groupCartItems, groupCartParticipants } = schema;

const TokenParam = z.object({ token: z.uuid() });
const ItemParam = TokenParam.extend({ itemId: z.uuid() });
const IdemKey = z.string().min(8).max(200);

async function addParticipant(
	ctx: CartCtx,
	displayName: string,
	isHost: boolean,
) {
	const secret = newSecret("gc_");
	const [p] = await ctx.tx
		.insert(groupCartParticipants)
		.values({
			orgId: ctx.orgId,
			cartId: ctx.cart.id,
			displayName,
			isHost,
			secretHash: sha256(secret),
		})
		.returning({ id: groupCartParticipants.id });
	if (!p) throw new ApiError("internal", "insert returned nothing");
	return { participantId: p.id, secret };
}

/** Group carts for the guest menu. See contracts/group-carts.ts for the route table. */
export const cartRoutes = new Hono<AppEnv>()
	.post(
		"/locations/:slug/group-carts",
		validate("json", CreateGroupCartRequest),
		async (c) => {
			const now = c.var.deps.now?.() ?? new Date();
			const { displayName } = c.req.valid("json");
			const body = await slugTx(c, c.req.param("slug"), async (tx, ids) => {
				const [cart] = await tx
					.insert(groupCarts)
					.values({
						id: uuidv7(),
						orgId: ids.orgId,
						locationId: ids.locationId,
						expiresAt: new Date(now.getTime() + CART_TTL_MS),
					})
					.returning();
				if (!cart) throw new ApiError("internal", "insert returned nothing");
				const ctx: CartCtx = { tx, cart, orgId: ids.orgId, now };
				const p = await addParticipant(ctx, displayName, true);
				const res: JoinGroupCartResponse = { ...p, cart: await bump(ctx) };
				return res;
			});
			return c.json(body, 201);
		},
	)
	.post(
		"/group-carts/:token/participants",
		validate("param", TokenParam),
		validate("json", JoinGroupCartRequest),
		async (c) =>
			c.json(
				await cartTx(c, c.req.valid("param").token, async (ctx) => {
					requireStatus(ctx, "open");
					const [n] = await ctx.tx
						.select({ n: count() })
						.from(groupCartParticipants)
						.where(eq(groupCartParticipants.cartId, ctx.cart.id));
					if ((n?.n ?? 0) >= MAX_PARTICIPANTS)
						throw new ApiError("unprocessable", "cart is full", {
							reason: "cart_not_open",
						});
					const p = await addParticipant(
						ctx,
						c.req.valid("json").displayName,
						false,
					);
					const res: JoinGroupCartResponse = { ...p, cart: await bump(ctx) };
					return res;
				}),
				201,
			),
	)
	.get("/group-carts/:token", validate("param", TokenParam), async (c) => {
		c.header("cache-control", "no-store");
		return c.json(
			await cartTx(c, c.req.valid("param").token, (ctx) =>
				cartView(ctx.tx, ctx.cart),
			),
		);
	})
	.put(
		"/group-carts/:token/items/:itemId",
		validate("param", ItemParam),
		validate("json", UpsertGroupCartItem),
		async (c) => {
			const { token, itemId } = c.req.valid("param");
			const item = c.req.valid("json");
			return c.json(
				await cartTx(c, token, async (ctx) => {
					const me = await participant(
						ctx,
						c.req.header(PARTICIPANT_SECRET_HEADER),
					);
					requireStatus(ctx, "open");
					await checkIfMatch(ctx, c.req.header("if-match"));
					const [existing] = await ctx.tx
						.select()
						.from(groupCartItems)
						.where(eq(groupCartItems.id, itemId));
					if (
						existing &&
						(existing.cartId !== ctx.cart.id ||
							existing.participantId !== me.id)
					) {
						throw new ApiError(
							"forbidden",
							"you can only change your own items",
						);
					}
					const values = {
						productId: item.productId,
						quantity: item.quantity,
						modifierOptionIds: item.modifierOptionIds,
						note: item.note ?? null,
					};
					if (existing) {
						await ctx.tx
							.update(groupCartItems)
							.set(values)
							.where(eq(groupCartItems.id, itemId));
					} else {
						const [n] = await ctx.tx
							.select({ n: count() })
							.from(groupCartItems)
							.where(eq(groupCartItems.cartId, ctx.cart.id));
						if ((n?.n ?? 0) >= MAX_ITEMS) throw rejectGuest("total_too_high");
						try {
							await ctx.tx.insert(groupCartItems).values({
								id: itemId,
								orgId: ctx.orgId,
								cartId: ctx.cart.id,
								participantId: me.id,
								...values,
							});
						} catch (err) {
							// Composite FK (org_id, product_id): not on this tenant's menu.
							if (
								(err as { cause?: { code?: string } }).cause?.code === "23503"
							) {
								throw rejectGuest("items_unavailable", [itemId]);
							}
							throw err;
						}
					}
					return bump(ctx);
				}),
			);
		},
	)
	.delete(
		"/group-carts/:token/items/:itemId",
		validate("param", ItemParam),
		async (c) => {
			const { token, itemId } = c.req.valid("param");
			return c.json(
				await cartTx(c, token, async (ctx) => {
					const me = await participant(
						ctx,
						c.req.header(PARTICIPANT_SECRET_HEADER),
					);
					requireStatus(ctx, "open");
					await checkIfMatch(ctx, c.req.header("if-match"));
					const gone = await ctx.tx
						.delete(groupCartItems)
						.where(
							and(
								eq(groupCartItems.id, itemId),
								eq(groupCartItems.cartId, ctx.cart.id),
								eq(groupCartItems.participantId, me.id),
							),
						)
						.returning({ id: groupCartItems.id });
					if (gone.length === 0)
						throw new ApiError("not_found", "no such item of yours");
					return bump(ctx);
				}),
			);
		},
	)
	.post("/group-carts/:token/lock", validate("param", TokenParam), async (c) =>
		c.json(
			await cartTx(c, c.req.valid("param").token, async (ctx) => {
				const me = await participant(
					ctx,
					c.req.header(PARTICIPANT_SECRET_HEADER),
				);
				if (!me.isHost)
					throw new ApiError("forbidden", "only the host can lock");
				requireStatus(ctx, "open");
				await checkIfMatch(ctx, c.req.header("if-match"));
				return bump(ctx, { status: "locked", lockedAt: ctx.now });
			}),
		),
	)
	.post(
		"/group-carts/:token/unlock",
		validate("param", TokenParam),
		async (c) =>
			c.json(
				await cartTx(c, c.req.valid("param").token, async (ctx) => {
					const me = await participant(
						ctx,
						c.req.header(PARTICIPANT_SECRET_HEADER),
					);
					if (!me.isHost)
						throw new ApiError("forbidden", "only the host can unlock");
					requireStatus(ctx, "locked");
					await checkIfMatch(ctx, c.req.header("if-match"));
					return bump(ctx, { status: "open", lockedAt: null });
				}),
			),
	)
	/**
	 * Host submits the locked cart as ONE order, re-priced from the live menu.
	 * Idempotent: a retry (same key) after success returns the same order.
	 */
	.post(
		"/group-carts/:token/submit",
		validate("param", TokenParam),
		validate("json", SubmitGroupCartRequest),
		async (c) => {
			const key = IdemKey.safeParse(c.req.header(IDEMPOTENCY_KEY_HEADER));
			if (!key.success)
				throw new ApiError(
					"bad_request",
					"Idempotency-Key header (8-200 chars) is required",
				);
			const body = c.req.valid("json");
			const res = await cartTx(c, c.req.valid("param").token, async (ctx) => {
				const me = await participant(
					ctx,
					c.req.header(PARTICIPANT_SECRET_HEADER),
				);
				if (!me.isHost)
					throw new ApiError("forbidden", "only the host can submit");
				if (ctx.cart.status === "submitted" && ctx.cart.orderId) {
					const dto = await loadOrderDto(ctx.tx, ctx.cart.orderId);
					const view = await cartView(ctx.tx, ctx.cart);
					if (!dto || !view.trackingToken)
						throw new ApiError("internal", "submitted cart without order");
					return {
						body: { order: toGuestView(dto, view.trackingToken) },
						created: false,
					};
				}
				requireStatus(ctx, "locked");
				const items = await ctx.tx
					.select()
					.from(groupCartItems)
					.where(eq(groupCartItems.cartId, ctx.cart.id))
					.orderBy(groupCartItems.createdAt, groupCartItems.id);
				if (items.length === 0) throw rejectGuest("cart_empty");
				const input = {
					type: body.type,
					customerName: body.customerName,
					customerPhone: body.customerPhone,
					note: body.note,
					lines: items.map((i) => ({
						id: i.id,
						productId: i.productId,
						quantity: i.quantity,
						modifierOptionIds: i.modifierOptionIds,
						note: i.note ?? undefined,
					})),
				};
				const out = await placeGuestOrder(
					ctx.tx,
					{ orgId: ctx.orgId, locationId: ctx.cart.locationId },
					input,
					{
						source: "group",
						now: ctx.now,
						idempotencyKey: key.data,
						fingerprint: guestFingerprint(input, ctx.cart.id),
					},
				);
				await bump(ctx, {
					status: "submitted",
					orderId: out.orderId,
					submittedAt: ctx.now,
				});
				const r: CreateGuestOrderResponse = { order: out.view };
				return { body: r, created: out.created };
			});
			return c.json(res.body, res.created ? 201 : 200);
		},
	)
	/** Per-cart SSE: GroupCartEvent hints. Refetch the cart on each, and on reconnect. */
	.get(
		"/group-carts/:token/events",
		validate("param", TokenParam),
		async (c) => {
			const hub = c.var.deps.realtime;
			if (!hub) throw new ApiError("internal", "realtime is not enabled");
			const cart = await cartTx(
				c,
				c.req.valid("param").token,
				async (ctx) => ctx.cart,
			);
			return streamSSE(c, async (stream) => {
				let wake: (() => void) | undefined;
				let closed = false;
				const queue: GroupCartEvent[] = [];
				const unsubscribe = hub.subscribe({
					orgId: cart.orgId,
					locationId: cart.locationId,
					cartId: cart.id,
					send: (e) => {
						if (e.type !== "cart.changed") return;
						queue.push(GroupCartEvent.parse(e));
						wake?.();
					},
				});
				stream.onAbort(() => {
					closed = true;
					wake?.();
				});
				await stream.writeSSE({ event: "ready", data: "{}" });
				try {
					while (!closed) {
						const e = queue.shift();
						if (e) {
							await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
							if (["submitted", "expired", "cancelled"].includes(e.status))
								break;
							continue;
						}
						await new Promise<void>((resolve) => {
							const t = setTimeout(resolve, 25_000);
							wake = () => {
								clearTimeout(t);
								resolve();
							};
						});
						wake = undefined;
						if (!closed && queue.length === 0) await stream.write(": ping\n\n");
					}
				} finally {
					unsubscribe();
				}
			});
		},
	);
