import type { GroupCartView } from "@bite/contracts";
import { schema, type Tx, withTenant } from "@bite/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { sha256 } from "../lib/tokens.js";

const { groupCarts, groupCartItems, groupCartParticipants, orders } = schema;

export const CART_TTL_MS = 2 * 60 * 60_000;
export const MAX_PARTICIPANTS = 20;
export const MAX_ITEMS = 100;

export type CartRow = typeof groupCarts.$inferSelect;
export type CartCtx = { tx: Tx; cart: CartRow; orgId: string; now: Date };

/**
 * Resolve the share token (resolve_group_cart_token, ids only), open the
 * tenant transaction and lock the cart row, so concurrent guests serialize
 * on it. Carts past expires_at are marked expired on first touch.
 */
export async function cartTx<T>(
	c: Context<AppEnv>,
	token: string,
	fn: (ctx: CartCtx) => Promise<T>,
): Promise<T> {
	const rows = (await c.var.deps.db.execute(
		sql`select org_id, cart_id from resolve_group_cart_token(${token}::uuid)`,
	)) as unknown as { org_id: string; cart_id: string }[];
	const r = rows[0];
	if (!r) throw new ApiError("not_found", "no such cart");
	const now = c.var.deps.now?.() ?? new Date();
	return withTenant(c.var.deps.db, r.org_id, async (tx) => {
		const [cart] = await tx
			.select()
			.from(groupCarts)
			.where(eq(groupCarts.id, r.cart_id))
			.for("update");
		if (!cart) throw new ApiError("not_found", "no such cart");
		if (
			(cart.status === "open" || cart.status === "locked") &&
			cart.expiresAt <= now
		) {
			const [expired] = await tx
				.update(groupCarts)
				.set({ status: "expired", version: sql`${groupCarts.version} + 1` })
				.where(eq(groupCarts.id, cart.id))
				.returning();
			return fn({ tx, cart: expired ?? cart, orgId: r.org_id, now });
		}
		return fn({ tx, cart, orgId: r.org_id, now });
	});
}

export async function cartView(tx: Tx, cart: CartRow): Promise<GroupCartView> {
	const [participants, items, order] = await Promise.all([
		tx
			.select({
				id: groupCartParticipants.id,
				displayName: groupCartParticipants.displayName,
				isHost: groupCartParticipants.isHost,
			})
			.from(groupCartParticipants)
			.where(eq(groupCartParticipants.cartId, cart.id))
			.orderBy(
				asc(groupCartParticipants.joinedAt),
				asc(groupCartParticipants.id),
			),
		tx
			.select({
				id: groupCartItems.id,
				participantId: groupCartItems.participantId,
				productId: groupCartItems.productId,
				quantity: groupCartItems.quantity,
				modifierOptionIds: groupCartItems.modifierOptionIds,
				note: groupCartItems.note,
			})
			.from(groupCartItems)
			.where(eq(groupCartItems.cartId, cart.id))
			.orderBy(asc(groupCartItems.createdAt), asc(groupCartItems.id)),
		cart.orderId
			? tx
					.select({ token: orders.trackingToken })
					.from(orders)
					.where(eq(orders.id, cart.orderId))
					.then((r) => r[0])
			: Promise.resolve(undefined),
	]);
	return {
		token: cart.token,
		status: cart.status,
		version: cart.version,
		expiresAt: cart.expiresAt.toISOString(),
		participants,
		items,
		trackingToken: order?.token ?? null,
	};
}

/** Identify the caller by X-Participant-Secret. */
export async function participant(ctx: CartCtx, secret: string | undefined) {
	if (!secret)
		throw new ApiError("unauthenticated", "participant secret required");
	const [p] = await ctx.tx
		.select()
		.from(groupCartParticipants)
		.where(
			and(
				eq(groupCartParticipants.cartId, ctx.cart.id),
				eq(groupCartParticipants.secretHash, sha256(secret)),
			),
		);
	if (!p)
		throw new ApiError("unauthenticated", "not a participant of this cart");
	return p;
}

/** If-Match: <version>. Stale -> 409 with the current cart so the client can redraw. */
export async function checkIfMatch(ctx: CartCtx, header: string | undefined) {
	const v = Number(header?.replaceAll('"', ""));
	if (!header || !Number.isInteger(v))
		throw new ApiError("bad_request", "If-Match: <version> required");
	if (v !== ctx.cart.version) {
		throw new ApiError("conflict", "cart changed", {
			cart: await cartView(ctx.tx, ctx.cart),
		});
	}
}

export function requireStatus(ctx: CartCtx, ...ok: CartRow["status"][]) {
	if (!ok.includes(ctx.cart.status)) {
		throw new ApiError("unprocessable", `cart is ${ctx.cart.status}`, {
			reason: "cart_not_open",
		});
	}
}

/** Bump the version (fires the cart.changed NOTIFY) and return the new view. */
export async function bump(
	ctx: CartCtx,
	set: Partial<CartRow> = {},
): Promise<GroupCartView> {
	const [cart] = await ctx.tx
		.update(groupCarts)
		.set({ ...set, version: sql`${groupCarts.version} + 1` })
		.where(eq(groupCarts.id, ctx.cart.id))
		.returning();
	if (!cart) throw new ApiError("internal", "cart vanished");
	ctx.cart = cart;
	return cartView(ctx.tx, cart);
}
