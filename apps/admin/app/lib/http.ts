import { ErrorBody } from "@bite/contracts";
import { z } from "zod";
import { type AdminApi, AdminApiError } from "./api-types";
import {
	AdminCategory,
	AdminLocationSettings,
	AdminMe,
	AdminModifierGroup,
	AdminProduct,
	AdminPromotion,
	AdminStaff,
	LocationProduct,
	Page,
} from "./contracts";

/** Back office over HTTP, under /v1/admin. Auth is the Better Auth session cookie. */
export function httpAdminApi(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): AdminApi {
	async function call<S extends z.ZodType>(
		schema: S,
		path: string,
		init: RequestInit = {},
	): Promise<z.infer<S>> {
		const res = await fetchImpl(new URL(`/v1/admin${path}`, baseUrl), {
			credentials: "include",
			...init,
			headers: {
				accept: "application/json",
				...(init.body ? { "content-type": "application/json" } : {}),
				...init.headers,
			},
		});
		const body: unknown =
			res.status === 204 ? null : await res.json().catch(() => null);
		if (!res.ok) {
			const err = ErrorBody.safeParse(body);
			throw new AdminApiError(
				err.success ? err.data.error.code : "internal",
				res.status,
				err.success ? err.data.error.details : undefined,
			);
		}
		return schema.parse(body);
	}

	/** Follow nextCursor to the end. Menus and location lists are small. */
	async function all<S extends z.ZodType>(item: S, path: string) {
		const page = Page(item);
		const out: z.infer<S>[] = [];
		let cursor: string | undefined;
		for (let i = 0; i < 50; i++) {
			const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
			const r = (await call(page, `${path}${q}`)) as {
				items: z.infer<S>[];
				nextCursor?: string;
			};
			out.push(...r.items);
			cursor = r.nextCursor;
			if (!cursor) break;
		}
		return out;
	}

	const send = (method: string, body: unknown): RequestInit => ({
		method,
		body: JSON.stringify(body),
	});
	const enc = encodeURIComponent;

	return {
		me: () => call(AdminMe, "/me"),
		locations: () => all(AdminLocationSettings, "/locations"),
		menu: async () => {
			const [categories, products, modifierGroups] = await Promise.all([
				all(AdminCategory, "/categories"),
				all(AdminProduct, "/products"),
				all(AdminModifierGroup, "/modifier-groups"),
			]);
			return { categories, products, modifierGroups };
		},
		createProduct: (p) => call(AdminProduct, "/products", send("POST", p)),
		updateProduct: (id, p) =>
			call(AdminProduct, `/products/${enc(id)}`, send("PATCH", p)),
		archiveProduct: async (id) => {
			await call(z.unknown(), `/products/${enc(id)}/archive`, {
				method: "POST",
			});
		},
		createCategory: (c) => call(AdminCategory, "/categories", send("POST", c)),
		updateCategory: (id, c) =>
			call(AdminCategory, `/categories/${enc(id)}`, send("PATCH", c)),
		locationProducts: (locationId) =>
			all(LocationProduct, `/locations/${enc(locationId)}/products`),
		setLocationProduct: async (locationId, productId, s) => {
			await call(
				z.unknown(),
				`/locations/${enc(locationId)}/products/${enc(productId)}`,
				send("PUT", s),
			);
		},
		promotions: () => all(AdminPromotion, "/promotions"),
		createPromotion: (p) =>
			call(AdminPromotion, "/promotions", send("POST", p)),
		updatePromotion: (id, p) =>
			call(AdminPromotion, `/promotions/${enc(id)}`, send("PATCH", p)),
		staff: () => all(AdminStaff, "/staff"),
		inviteStaff: (s) => call(AdminStaff, "/staff/invite", send("POST", s)),
		createPinStaff: (s) => call(AdminStaff, "/staff", send("POST", s)),
		updateStaff: (id, s) =>
			call(AdminStaff, `/staff/${enc(id)}`, send("PATCH", s)),
		resetPin: async (id, pin) => {
			await call(
				z.unknown(),
				`/staff/${enc(id)}/reset-pin`,
				send("POST", { pin }),
			);
		},
		deactivateStaff: async (id) => {
			await call(z.unknown(), `/staff/${enc(id)}/deactivate`, {
				method: "POST",
			});
		},
	};
}
