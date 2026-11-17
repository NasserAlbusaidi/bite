/**
 * Server-side client for the public guest API. With BITE_API_URL unset it
 * serves in-memory fixtures so the menu can be built before the API exists.
 * Responses are parsed with the contract schemas: the API is trusted for
 * prices, not for shape.
 */
import type { z } from "zod";
import {
	type CreateGuestOrderRequest,
	CreateGuestOrderResponse,
	ErrorBody,
	type ErrorCode,
	GuestOrderRejectDetails,
	GuestOrderView,
	IDEMPOTENCY_KEY_HEADER,
	PublicMenuResponse,
} from "./contracts";
import { fixtureApi } from "./fixtures.server";

export class GuestApiError extends Error {
	constructor(
		readonly code: ErrorCode,
		readonly rejection: GuestOrderRejectDetails | null = null,
	) {
		super(rejection ? `${code}: ${rejection.reason}` : code);
	}
}

export interface GuestApi {
	getMenu(slug: string): Promise<PublicMenuResponse | null>;
	placeOrder(
		req: CreateGuestOrderRequest,
		idempotencyKey: string,
	): Promise<GuestOrderView>;
	getOrder(trackingToken: string): Promise<GuestOrderView | null>;
}

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
			const rejection = GuestOrderRejectDetails.safeParse(
				err.data.error.details,
			);
			throw new GuestApiError(
				err.data.error.code,
				rejection.success ? rejection.data : null,
			);
		}
		return schema.parse(body);
	}

	return {
		getMenu: (slug) =>
			call(
				PublicMenuResponse,
				`/v1/public/locations/${encodeURIComponent(slug)}/menu`,
			),
		getOrder: (token) =>
			call(GuestOrderView, `/v1/public/orders/${encodeURIComponent(token)}`),
		placeOrder: async (req, key) => {
			const path = `/v1/public/locations/${encodeURIComponent(req.locationSlug)}/orders`;
			const res = await call(CreateGuestOrderResponse, path, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[IDEMPOTENCY_KEY_HEADER]: key,
				},
				body: JSON.stringify(req),
			});
			if (!res) throw new GuestApiError("not_found");
			return res.order;
		},
	};
}

let instance: GuestApi | undefined;

export function guestApi(): GuestApi {
	if (!instance) {
		const base = process.env.BITE_API_URL;
		instance = base ? httpApi(base) : fixtureApi();
	}
	return instance;
}
