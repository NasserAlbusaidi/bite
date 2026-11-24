import { ErrorBody, ORG_HEADER } from "@bite/contracts";
import { z } from "zod";
import { type AdminApi, AdminApiError } from "./api-types";
import {
	AdminCashSession,
	AdminCategory,
	AdminDevice,
	AdminLocationSettings,
	AdminMe,
	AdminModifierGroup,
	AdminOrderDetail,
	AdminOrderRow,
	AdminProduct,
	AdminPromotion,
	AdminStaff,
	InviteStaffResponse,
	LocationProduct,
	Page,
	RegisterDeviceResponse,
	SalesReport,
	TrendsReport,
	UploadedImage,
} from "./contracts";

/** Back office over HTTP, under /v1/admin. Auth is the Better Auth session cookie. */
export function httpAdminApi(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
	/** Org to act on, for logins in several orgs. Read per request. */
	orgId: () => string | undefined = () => undefined,
): AdminApi {
	const orgHeader = (): Record<string, string> => {
		const id = orgId();
		return id ? { [ORG_HEADER]: id } : {};
	};
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
				...orgHeader(),
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

	/** ?a=1&b=2 from the defined values only. */
	const qs = (q: Record<string, string | number | undefined>) => {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(q))
			if (v !== undefined) p.set(k, String(v));
		return `?${p.toString()}`;
	};

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
		reorderCategories: async (items) => {
			await call(z.unknown(), "/categories/order", send("PATCH", items));
		},
		reorderProducts: async (items) => {
			await call(z.unknown(), "/products/order", send("PATCH", items));
		},
		uploadImage: async (image) => {
			const r = await call(UploadedImage, "/uploads", {
				method: "POST",
				body: image,
				headers: { "content-type": image.type },
			});
			return r.url;
		},
		createModifierGroup: (g) =>
			call(AdminModifierGroup, "/modifier-groups", send("POST", g)),
		updateModifierGroup: (id, g) =>
			call(AdminModifierGroup, `/modifier-groups/${enc(id)}`, send("PATCH", g)),
		createModifierOption: (groupId, o) =>
			call(
				AdminModifierGroup,
				`/modifier-groups/${enc(groupId)}/options`,
				send("POST", o),
			),
		updateModifierOption: (groupId, optionId, o) =>
			call(
				AdminModifierGroup,
				`/modifier-groups/${enc(groupId)}/options/${enc(optionId)}`,
				send("PATCH", o),
			),
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
		inviteStaff: (s) =>
			call(InviteStaffResponse, "/staff/invite", send("POST", s)),
		reissueInvite: (id) =>
			call(InviteStaffResponse, `/staff/${enc(id)}/invite`, { method: "POST" }),
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
		updateLocation: (id, l) =>
			call(AdminLocationSettings, `/locations/${enc(id)}`, send("PATCH", l)),
		devices: (locationId) =>
			all(AdminDevice, `/locations/${enc(locationId)}/devices`),
		registerDevice: (d) =>
			call(RegisterDeviceResponse, "/devices", send("POST", d)),
		salesReport: (q) => call(SalesReport, `/reports/sales${qs(q)}`),
		orders: (q) => call(Page(AdminOrderRow), `/orders${qs(q)}`),
		trends: (q) => call(TrendsReport, `/reports/trends${qs(q)}`),
		order: (id) => call(AdminOrderDetail, `/orders/${enc(id)}`),
		cashSessions: (q) =>
			call(z.array(AdminCashSession), `/cash-sessions${qs(q)}`),
		ordersCsv: async (q) => {
			const res = await fetchImpl(
				new URL(`/v1/admin/orders.csv${qs(q)}`, baseUrl),
				{
					credentials: "include",
					headers: { accept: "text/csv", ...orgHeader() },
				},
			);
			if (!res.ok) throw new AdminApiError("internal", res.status);
			return res.blob();
		},
		revokeDevice: async (id) => {
			await call(z.unknown(), `/devices/${enc(id)}/revoke`, { method: "POST" });
		},
	};
}
