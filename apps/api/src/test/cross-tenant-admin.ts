import { expect } from "vitest";
import { type Harness, uuidv7 } from "./harness.js";

/**
 * Back-office cross-tenant cases: B's owner (full rights in B) aims every
 * admin route at A's ids. Expect a refusal and A's menu byte-for-byte
 * unchanged. Merged into the meta-checked case table in cross-tenant.test.ts.
 */
type Case = (h: Harness) => Promise<void>;

let fixtures: { group: string; option: string; promo: string } | undefined;
async function aMenu(h: Harness) {
	if (fixtures) return fixtures;
	const f = { group: uuidv7(), option: uuidv7(), promo: uuidv7() };
	await h.owner`insert into modifier_groups (id, org_id, name) values (${f.group}, ${h.A.org}, ${JSON.stringify({ en: "Milk" })}::jsonb)`;
	await h.owner`insert into modifier_options (id, org_id, group_id, name, price_delta) values (${f.option}, ${h.A.org}, ${f.group}, ${JSON.stringify({ en: "Oat" })}::jsonb, 200)`;
	await h.owner`insert into promotions (id, org_id, name, kind, value) values (${f.promo}, ${h.A.org}, 'A promo', 'percent', 1000)`;
	fixtures = f;
	return f;
}

const ORG_TABLES = [
	"members",
	"member_locations",
	"member_invites",
	"locations",
	"devices",
];

const MENU_TABLES = [
	"categories",
	"products",
	"product_location_settings",
	"modifier_groups",
	"modifier_options",
	"product_modifier_groups",
	"promotions",
];

/** Fingerprint of everything A owns in the menu, staff, locations and devices. */
async function aDigest(h: Harness) {
	const parts: string[] = [];
	for (const t of [...MENU_TABLES, ...ORG_TABLES]) {
		const [r] = await h.owner.unsafe<{ d: string | null }[]>(
			`select md5(string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text)) as d
			 from ${t} x where org_id = $1`,
			[h.A.org],
		);
		parts.push(`${t}:${r?.d ?? "-"}`);
	}
	return parts.join("|");
}

const send = (h: Harness, method: string, path: string, body?: unknown) =>
	h.app.request(`/v1/admin${path}`, {
		method,
		headers: { ...h.logins.B.owner, "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

/** B writes at A: refused with one of `codes`, and A's menu is untouched. */
const write =
	(
		method: string,
		path: (h: Harness, f: Awaited<ReturnType<typeof aMenu>>) => string,
		body: (h: Harness, f: Awaited<ReturnType<typeof aMenu>>) => unknown,
		codes = [404, 422],
	): Case =>
	async (h) => {
		const f = await aMenu(h);
		const before = await aDigest(h);
		const res = await send(h, method, path(h, f), body(h, f));
		expect(codes).toContain(res.status);
		expect(await aDigest(h)).toBe(before);
	};

/** B lists: sees none of A's ids. */
const read =
	(path: (h: Harness) => string, status = 200): Case =>
	async (h) => {
		const f = await aMenu(h);
		const res = await send(h, "GET", path(h));
		expect(res.status).toBe(status);
		const text = await res.text();
		for (const id of [h.A.cat, h.A.prod, h.A.loc, f.group, f.option, f.promo]) {
			expect(text).not.toContain(id);
		}
	};

const name = { en: "Hijacked" };

const pin = { pin: "9999" };

const range = (h: Harness) =>
	`locationId=${h.A.loc}&from=2026-01-01&to=2026-12-31`;

export const adminCases: Record<string, Case> = {
	"GET /v1/admin/reports/sales": read((h) => `/reports/sales?${range(h)}`, 404),
	"GET /v1/admin/orders": read((h) => `/orders?${range(h)}`, 404),
	"GET /v1/admin/orders.csv": read((h) => `/orders.csv?${range(h)}`, 404),
	"GET /v1/admin/staff": async (h) => {
		const res = await send(h, "GET", "/staff");
		const text = await res.text();
		for (const id of [h.A.cashier, h.A.manager, h.A.otherLocStaff, h.A.loc]) {
			expect(text).not.toContain(id);
		}
	},
	"POST /v1/admin/staff/invite": write(
		"POST",
		() => "/staff/invite",
		(h) => ({
			email: "x@test.bite",
			displayName: "x",
			orgRole: "staff",
			locations: [{ locationId: h.A.loc, role: "cashier" }],
		}),
	),
	"POST /v1/admin/staff": write(
		"POST",
		() => "/staff",
		(h) => ({
			displayName: "x",
			pin: "1234",
			locations: [{ locationId: h.A.loc, role: "cashier" }],
		}),
	),
	"PATCH /v1/admin/staff/:id": write(
		"PATCH",
		(h) => `/staff/${h.A.cashier}`,
		(h) => ({
			displayName: "Hijacked",
			locations: [{ locationId: h.B.loc, role: "manager" }],
		}),
	),
	"POST /v1/admin/staff/:id/reset-pin": write(
		"POST",
		(h) => `/staff/${h.A.cashier}/reset-pin`,
		() => pin,
	),
	"POST /v1/admin/staff/:id/deactivate": write(
		"POST",
		(h) => `/staff/${h.A.cashier}/deactivate`,
		() => undefined,
	),
	"POST /v1/admin/staff/:id/invite": write(
		"POST",
		(h) => `/staff/${h.A.cashier}/invite`,
		() => undefined,
	),
	"GET /v1/admin/locations": read(() => "/locations"),
	"PATCH /v1/admin/locations/:id": write(
		"PATCH",
		(h) => `/locations/${h.A.loc}`,
		() => ({ ordersPausedUntil: "2030-01-01T00:00:00Z" }),
	),
	"GET /v1/admin/locations/:id/devices": async (h) => {
		const res = await send(h, "GET", `/locations/${h.A.loc}/devices`);
		expect(res.status).toBe(404);
		expect(await res.text()).not.toContain(h.A.device);
	},
	"POST /v1/admin/devices": write(
		"POST",
		() => "/devices",
		(h) => ({ locationId: h.A.loc, name: "x", kind: "pos", ticketPrefix: "Z" }),
	),
	"POST /v1/admin/devices/:id/revoke": write(
		"POST",
		(h) => `/devices/${h.A.device}/revoke`,
		() => undefined,
	),

	"GET /v1/admin/categories": read(() => "/categories"),
	"POST /v1/admin/categories": write(
		"POST",
		() => "/categories",
		(h) => ({ name, parentId: h.A.cat }),
	),
	"PATCH /v1/admin/categories/order": write(
		"PATCH",
		() => "/categories/order",
		(h) => [{ id: h.A.cat, sortOrder: 99 }],
	),
	"PATCH /v1/admin/categories/:id": write(
		"PATCH",
		(h) => `/categories/${h.A.cat}`,
		() => ({ name }),
	),
	"POST /v1/admin/categories/:id/archive": write(
		"POST",
		(h) => `/categories/${h.A.cat}/archive`,
		() => undefined,
	),
	"GET /v1/admin/products": read(() => "/products?archived=true"),
	"POST /v1/admin/products": write(
		"POST",
		() => "/products",
		(h) => ({ categoryId: h.A.cat, name, price: 1 }),
	),
	"PATCH /v1/admin/products/order": write(
		"PATCH",
		() => "/products/order",
		(h) => [{ id: h.A.prod, sortOrder: 99 }],
	),
	"PATCH /v1/admin/products/:id": write(
		"PATCH",
		(h) => `/products/${h.A.prod}`,
		() => ({ price: 1 }),
	),
	"POST /v1/admin/products/:id/archive": write(
		"POST",
		(h) => `/products/${h.A.prod}/archive`,
		() => undefined,
	),
	"GET /v1/admin/modifier-groups": read(() => "/modifier-groups"),
	"POST /v1/admin/modifier-groups": async (h) => {
		// Nothing of A to aim at; B's new group must land in B only.
		const res = await send(h, "POST", "/modifier-groups", { name });
		expect(res.status).toBe(201);
		const { id } = (await res.json()) as { id: string };
		const [row] = await h.owner<{ org_id: string }[]>`
			select org_id from modifier_groups where id = ${id}`;
		expect(row?.org_id).toBe(h.B.org);
	},
	"PATCH /v1/admin/modifier-groups/:id": write(
		"PATCH",
		(_h, f) => `/modifier-groups/${f.group}`,
		() => ({ name }),
	),
	"POST /v1/admin/modifier-groups/:id/options": write(
		"POST",
		(_h, f) => `/modifier-groups/${f.group}/options`,
		() => ({ name, priceDelta: -100 }),
	),
	"PATCH /v1/admin/modifier-groups/:id/options/:optionId": write(
		"PATCH",
		(_h, f) => `/modifier-groups/${f.group}/options/${f.option}`,
		() => ({ priceDelta: 0 }),
	),
	"GET /v1/admin/locations/:id/products": read(
		(h) => `/locations/${h.A.loc}/products`,
		404,
	),
	"PUT /v1/admin/locations/:id/products/:productId": async (h) => {
		// Both A's location, and B's own location with A's product.
		await write(
			"PUT",
			(h) => `/locations/${h.A.loc}/products/${h.A.prod}`,
			() => ({ price: 1, isAvailable: false }),
		)(h);
		await write(
			"PUT",
			(h) => `/locations/${h.B.loc}/products/${h.A.prod}`,
			() => ({ price: 1, isAvailable: false }),
		)(h);
	},
	"GET /v1/admin/promotions": read(() => "/promotions"),
	"POST /v1/admin/promotions": async (h) => {
		for (const body of [
			{ name: "x", kind: "fixed", value: 1, productId: h.A.prod },
			{ name: "x", kind: "fixed", value: 1, categoryId: h.A.cat },
			{ name: "x", kind: "fixed", value: 1, locationId: h.A.loc },
		]) {
			await write(
				"POST",
				() => "/promotions",
				() => body,
			)(h);
		}
	},
	"PATCH /v1/admin/promotions/:id": write(
		"PATCH",
		(_h, f) => `/promotions/${f.promo}`,
		() => ({ value: 9999 }),
	),
};
