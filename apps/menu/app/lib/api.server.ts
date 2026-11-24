/**
 * Server-side client for the public guest API. With BITE_API_URL unset it
 * serves in-memory fixtures so the menu can be built and demoed without the
 * API. Responses are parsed with the contract schemas: the API is trusted
 * for prices, not for shape.
 */
import type { z } from "zod";
import {
	type CreateGuestOrderRequest,
	CreateGuestOrderResponse,
	ErrorBody,
	type ErrorCode,
	GroupCartView,
	GUEST_TOKEN_HEADER,
	GuestOrderRejectDetails,
	GuestOrderView,
	GuestProfile,
	IDEMPOTENCY_KEY_HEADER,
	JoinGroupCartResponse,
	PARTICIPANT_SECRET_HEADER,
	PublicMenuResponse,
	type ServiceRequest,
	type ServiceRequestKind,
	ServiceRequestResponse,
	type SubmitGroupCartRequest,
	type UpsertGroupCartItem,
} from "./contracts";
import { fixtureApi } from "./fixtures.server";

export class GuestApiError extends Error {
	constructor(
		readonly code: ErrorCode,
		readonly rejection: GuestOrderRejectDetails | null = null,
		/** On a 409 conflict: the cart as it is now. */
		readonly currentCart: GroupCartView | null = null,
	) {
		super(rejection ? `${code}: ${rejection.reason}` : code);
	}
}

/** Who is acting on a group cart, and the cart version they last saw. */
export type ParticipantAuth = { secret: string; version: number };

export interface GuestApi {
	getMenu(slug: string): Promise<PublicMenuResponse | null>;
	placeOrder(
		req: CreateGuestOrderRequest,
		idempotencyKey: string,
	): Promise<GuestOrderView>;
	getOrder(trackingToken: string): Promise<GuestOrderView | null>;
	/** Call a waiter or ask for the bill at a table. */
	callService(
		slug: string,
		kind: ServiceRequestKind,
		tableLabel: string,
	): Promise<ServiceRequest>;
	/** Checkout with the remembered-guest token; returns loyalty info too. */
	checkout(
		req: CreateGuestOrderRequest,
		idempotencyKey: string,
		guestToken: string | null,
	): Promise<CreateGuestOrderResponse>;
	/** The remembered guest, or null for an unknown token. */
	getGuest(slug: string, guestToken: string): Promise<GuestProfile | null>;

	createGroupCart(
		slug: string,
		displayName: string,
	): Promise<JoinGroupCartResponse>;
	joinGroupCart(
		token: string,
		displayName: string,
	): Promise<JoinGroupCartResponse>;
	getGroupCart(token: string): Promise<GroupCartView | null>;
	upsertGroupItem(
		token: string,
		itemId: string,
		item: UpsertGroupCartItem,
		auth: ParticipantAuth,
	): Promise<GroupCartView>;
	removeGroupItem(
		token: string,
		itemId: string,
		auth: ParticipantAuth,
	): Promise<GroupCartView>;
	lockGroupCart(token: string, auth: ParticipantAuth): Promise<GroupCartView>;
	unlockGroupCart(token: string, auth: ParticipantAuth): Promise<GroupCartView>;
	submitGroupCart(
		token: string,
		req: SubmitGroupCartRequest,
		auth: ParticipantAuth,
		idempotencyKey: string,
	): Promise<GuestOrderView>;
}

const enc = encodeURIComponent;

export function httpApi(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): GuestApi {
	async function call<S extends z.ZodType>(
		schema: S,
		path: string,
		init: RequestInit = {},
	): Promise<z.infer<S> | null> {
		const res = await fetchImpl(new URL(path, baseUrl), {
			...init,
			headers: { accept: "application/json", ...init.headers },
		});
		if (res.status === 404) return null;
		const body: unknown = await res.json().catch(() => null);
		if (!res.ok) {
			const err = ErrorBody.safeParse(body);
			if (!err.success)
				throw new Error(`Guest API ${path}: HTTP ${res.status}`);
			const details = err.data.error.details;
			const rejection = GuestOrderRejectDetails.safeParse(details);
			// 409s carry the current cart as details.cart.
			const cart = GroupCartView.safeParse(
				(details as { cart?: unknown } | undefined)?.cart,
			);
			throw new GuestApiError(
				err.data.error.code,
				rejection.success ? rejection.data : null,
				cart.success ? cart.data : null,
			);
		}
		return schema.parse(body);
	}

	async function must<S extends z.ZodType>(
		schema: S,
		path: string,
		init: RequestInit,
	) {
		const res = await call(schema, path, init);
		if (res === null) throw new GuestApiError("not_found");
		return res;
	}

	const json = (
		body: unknown,
		headers: Record<string, string> = {},
		method = "POST",
	) => ({
		method,
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
	const asParticipant = (a: ParticipantAuth) => ({
		[PARTICIPANT_SECRET_HEADER]: a.secret,
		"if-match": String(a.version),
	});
	const cartPath = (token: string) => `/v1/public/group-carts/${enc(token)}`;

	return {
		getMenu: (slug) =>
			call(PublicMenuResponse, `/v1/public/locations/${enc(slug)}/menu`),
		getOrder: (token) =>
			call(GuestOrderView, `/v1/public/orders/${enc(token)}`),
		callService: async (slug, kind, tableLabel) => {
			const res = await must(
				ServiceRequestResponse,
				`/v1/public/locations/${enc(slug)}/service-requests`,
				json({ kind, tableLabel }),
			);
			return res.request;
		},
		placeOrder: async (req, key) => {
			const path = `/v1/public/locations/${enc(req.locationSlug)}/orders`;
			const res = await must(
				CreateGuestOrderResponse,
				path,
				json(req, { [IDEMPOTENCY_KEY_HEADER]: key }),
			);
			return res.order;
		},
		checkout: (req, key, token) =>
			must(
				CreateGuestOrderResponse,
				`/v1/public/locations/${enc(req.locationSlug)}/orders`,
				json(req, {
					[IDEMPOTENCY_KEY_HEADER]: key,
					...(token ? { [GUEST_TOKEN_HEADER]: token } : {}),
				}),
			),
		getGuest: (slug, token) =>
			call(GuestProfile, `/v1/public/locations/${enc(slug)}/guest`, {
				headers: { [GUEST_TOKEN_HEADER]: token },
			}),

		createGroupCart: (slug, displayName) =>
			must(
				JoinGroupCartResponse,
				`/v1/public/locations/${enc(slug)}/group-carts`,
				json({ displayName }),
			),
		joinGroupCart: (token, displayName) =>
			must(
				JoinGroupCartResponse,
				`${cartPath(token)}/participants`,
				json({ displayName }),
			),
		getGroupCart: (token) => call(GroupCartView, cartPath(token)),
		upsertGroupItem: (token, itemId, item, auth) =>
			must(
				GroupCartView,
				`${cartPath(token)}/items/${enc(itemId)}`,
				json(item, asParticipant(auth), "PUT"),
			),
		removeGroupItem: (token, itemId, auth) =>
			must(GroupCartView, `${cartPath(token)}/items/${enc(itemId)}`, {
				method: "DELETE",
				headers: asParticipant(auth),
			}),
		lockGroupCart: (token, auth) =>
			must(GroupCartView, `${cartPath(token)}/lock`, {
				method: "POST",
				headers: asParticipant(auth),
			}),
		unlockGroupCart: (token, auth) =>
			must(GroupCartView, `${cartPath(token)}/unlock`, {
				method: "POST",
				headers: asParticipant(auth),
			}),
		submitGroupCart: async (token, req, auth, key) => {
			const res = await must(
				CreateGuestOrderResponse,
				`${cartPath(token)}/submit`,
				json(req, { ...asParticipant(auth), [IDEMPOTENCY_KEY_HEADER]: key }),
			);
			return res.order;
		},
	};
}

/**
 * Run a group cart write; on a version conflict, retry against the version
 * the server reports. Safe because every write is keyed (item id, lock) and
 * participants only touch their own items.
 */
export async function withFreshVersion<T>(
	auth: ParticipantAuth,
	write: (auth: ParticipantAuth) => Promise<T>,
	attempts = 3,
): Promise<T> {
	let current = auth;
	for (let i = 1; ; i++) {
		try {
			return await write(current);
		} catch (e) {
			if (
				!(e instanceof GuestApiError) ||
				e.code !== "conflict" ||
				!e.currentCart ||
				i >= attempts
			) {
				throw e;
			}
			current = { ...current, version: e.currentCart.version };
		}
	}
}

let instance: GuestApi | undefined;

export function guestApi(): GuestApi {
	if (!instance) {
		const base = process.env.BITE_API_URL;
		instance = base ? httpApi(base) : fixtureApi();
	}
	return instance;
}
