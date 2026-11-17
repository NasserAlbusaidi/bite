import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { PinLimiter } from "../lib/pin-limiter.js";
import { adminCases } from "./cross-tenant-admin.js";
import {
	bearer,
	type Harness,
	json,
	ownerUrl,
	PIN,
	setupHarness,
	staffLogin,
	uuidv7,
} from "./harness.js";
import { openStream } from "./sse.js";

/**
 * CLAUDE.md: every tenant-scoped endpoint gets a cross-tenant test.
 * Each entry acts as tenant B and aims at tenant A's ids; it must see nothing
 * of A. The meta test below fails when a route is added without an entry.
 */
type Case = (h: Harness) => Promise<void>;

/** Not tenant-scoped: health, and Better Auth identity endpoints (no org data). */
const PUBLIC_ROUTES = new Set([
	"GET /health",
	"GET /v1/auth/*",
	"POST /v1/auth/*",
]);

const cases: Record<string, Case> = {
	...adminCases,
	"GET /v1/admin/me": async (h) => {
		// B's owner aims at A's org: refused, and nothing of A comes back.
		const res = await h.app.request("/v1/admin/me", {
			headers: { ...h.logins.B.owner, "x-org-id": h.A.org },
		});
		expect(res.status).toBe(403);
		const text = await res.text();
		for (const id of [h.A.org, h.A.loc]) expect(text).not.toContain(id);
		const own = await h.app.request("/v1/admin/me", {
			headers: h.logins.B.owner,
		});
		const body = await own.text();
		expect(body).toContain(h.B.org);
		for (const id of [h.A.org, h.A.loc, h.A.otherLoc])
			expect(body).not.toContain(id);
	},
	"GET /v1/account/orgs": async (h) => {
		const res = await h.app.request("/v1/account/orgs", {
			headers: h.logins.B.owner,
		});
		const body = (await res.json()) as { items: { id: string }[] };
		expect(body.items.map((o) => o.id)).toEqual([h.B.org]);
	},
	"POST /v1/account/invites/accept": async (h) => {
		// A invites someone; B's owner holds the link but isn't the invitee.
		const inv = await h.app.request(
			"/v1/admin/staff/invite",
			json(
				{
					email: "a-invitee@test.bite",
					displayName: "Invitee",
					orgRole: "staff",
					locations: [],
				},
				h.logins.A.owner,
			),
		);
		expect(inv.status).toBe(201);
		const { inviteToken, staff } = (await inv.json()) as {
			inviteToken: string;
			staff: { id: string };
		};
		const res = await h.app.request(
			"/v1/account/invites/accept",
			json({ token: inviteToken }, h.logins.B.owner),
		);
		expect(res.status).toBe(403);
		const [m] = await h.owner<{ user_id: string | null }[]>`
			select user_id from members where id = ${staff.id}`;
		expect(m?.user_id).toBeNull();
	},
	"POST /v1/account/orgs": async (h) => {
		// Onboarding can't take over A: ids are server-minted, A's slugs collide.
		const res = await h.app.request(
			"/v1/account/orgs",
			json(
				{
					orgName: "Hijack",
					orgSlug: "hijack-org",
					locationName: "x",
					locationSlug: "a-main",
				},
				h.logins.B.owner,
			),
		);
		expect(res.status).toBe(409);
		const owners = await h.owner<{ n: number }[]>`
			select count(*)::int as n from members where org_id = ${h.A.org} and org_role = 'owner'`;
		expect(owners[0]?.n).toBe(1);
	},
	"GET /v1/device/me": async (h) => {
		const res = await h.app.request("/v1/device/me", { headers: bearer(h.B) });
		const body = (await res.json()) as { orgId: string };
		expect(body.orgId).toBe(h.B.org);
	},
	"GET /v1/device/staff": async (h) => {
		const res = await h.app.request("/v1/device/staff", {
			headers: bearer(h.B),
		});
		const text = await res.text();
		for (const id of [h.A.cashier, h.A.kitchen, h.A.org]) {
			expect(text).not.toContain(id);
		}
	},
	"GET /v1/device/menu": async (h) => {
		const res = await h.app.request("/v1/device/menu", {
			headers: bearer(h.B),
		});
		const text = await res.text();
		expect(text).toContain(h.B.prod);
		for (const id of [h.A.prod, h.A.cat, h.A.loc])
			expect(text).not.toContain(id);
	},
	"PUT /v1/device/products/:productId/availability": async (h) => {
		const staff = await staffLogin(h, h.B, h.B.cashier);
		const res = await h.app.request(
			`/v1/device/products/${h.A.prod}/availability`,
			{
				method: "PUT",
				headers: { ...staff, "content-type": "application/json" },
				body: JSON.stringify({ isAvailable: false }),
			},
		);
		expect(res.status).toBe(404);
		const rows =
			await h.owner`select 1 from product_location_settings where product_id = ${h.A.prod} and org_id = ${h.B.org}`;
		expect(rows.length).toBe(0);
	},
	"GET /v1/public/locations/:slug/menu": async (h) => {
		const res = await h.app.request("/v1/public/locations/b-main/menu");
		const text = await res.text();
		expect(text).toContain(h.B.prod);
		for (const id of [h.A.prod, h.A.cat, h.A.loc])
			expect(text).not.toContain(id);
	},
	"POST /v1/sync/push": async (h) => {
		// B's tablet tries to pay for, bump and void A's order.
		const orderId = await aOrder(h);
		const m = (kind: string, payload: unknown) => ({
			id: uuidv7(),
			kind,
			entityId: orderId,
			memberId: h.B.manager,
			createdAt: new Date().toISOString(),
			payload,
		});
		const res = await h.app.request(
			"/v1/sync/push",
			json(
				{
					deviceId: h.B.device,
					mutations: [
						m("order.addPayment", {
							id: uuidv7(),
							orderId,
							amount: 100,
							method: "card",
							businessDate: "2026-11-17",
						}),
						m("order.setFulfillment", {
							orderId,
							to: "cancelled",
							reason: "x",
						}),
					],
				},
				bearer(h.B),
			),
		);
		const { results } = (await res.json()) as {
			results: { status: string; error?: { code: string } }[];
		};
		expect(results[0]).toMatchObject({
			status: "rejected",
			error: { code: "not_found" },
		});
		expect(results[1]?.status).toBe("blocked");
		// And a B mutation naming A's staff member is refused.
		const res2 = await h.app.request(
			"/v1/sync/push",
			json(
				{
					deviceId: h.B.device,
					mutations: [
						{
							...m("menu.setAvailability", {
								productId: h.B.prod,
								isAvailable: false,
							}),
							entityId: h.B.prod,
							memberId: h.A.manager,
						},
					],
				},
				bearer(h.B),
			),
		);
		const r2 = (await res2.json()) as { results: { status: string }[] };
		expect(r2.results[0]?.status).toBe("rejected");
		const [a] =
			await h.owner`select payment_status, fulfillment_status from orders where id = ${orderId}`;
		expect(a).toMatchObject({
			payment_status: "unpaid",
			fulfillment_status: "pending",
		});
	},
	"GET /v1/sync/pull": async (h) => {
		const orderId = await aOrder(h);
		const res = await h.app.request("/v1/sync/pull", { headers: bearer(h.B) });
		const text = await res.text();
		for (const id of [orderId, h.A.prod, h.A.loc])
			expect(text).not.toContain(id);
	},
	"GET /v1/orders/:orderId": async (h) => {
		const orderId = await aOrder(h);
		const res = await h.app.request(`/v1/orders/${orderId}`, {
			headers: bearer(h.B),
		});
		expect(res.status).toBe(404);
	},
	"POST /v1/public/locations/:slug/orders": async (h) => {
		// A's product ordered through B's menu: not on B's menu.
		const lineId = uuidv7();
		const res = await h.app.request(
			"/v1/public/locations/b-main/orders",
			json(
				{
					locationSlug: "b-main",
					type: "takeaway",
					lines: [
						{
							id: lineId,
							productId: h.A.prod,
							quantity: 1,
							modifierOptionIds: [],
						},
					],
				},
				{ "idempotency-key": uuidv7() },
			),
		);
		expect(await res.json()).toMatchObject({
			error: { details: { reason: "items_unavailable", lineIds: [lineId] } },
		});
		// And an Idempotency-Key A already used doesn't leak A's order to B.
		const key = uuidv7();
		const lines = [
			{ id: uuidv7(), productId: h.A.prod, quantity: 1, modifierOptionIds: [] },
		];
		await h.app.request(
			"/v1/public/locations/a-main/orders",
			json(
				{ locationSlug: "a-main", type: "takeaway", lines },
				{ "idempotency-key": key },
			),
		);
		const b = await h.app.request(
			"/v1/public/locations/b-main/orders",
			json(
				{
					locationSlug: "b-main",
					type: "takeaway",
					lines: [{ ...lines[0], productId: h.B.prod }],
				},
				{ "idempotency-key": key },
			),
		);
		expect(b.status).toBe(201);
		expect(await b.text()).not.toContain(h.A.prod);
	},
	"GET /v1/public/orders/:trackingToken": async (h) => {
		const [a] =
			await h.owner`select tracking_token from orders where org_id = ${h.A.org} limit 1`;
		const res = await h.app.request(`/v1/public/orders/${a?.tracking_token}`);
		const text = await res.text();
		for (const id of [h.B.org, h.B.prod, h.B.loc])
			expect(text).not.toContain(id);
		// Staff/device ids never appear on the public view.
		for (const id of [h.A.device, h.A.cashier, h.A.org])
			expect(text).not.toContain(id);
	},
	"GET /v1/realtime": async (h) => {
		// Covered end to end in realtime.test.ts (B hears nothing of A's); here,
		// a B stream stays silent while A's order changes.
		const b = await openStream(h, h.B);
		await h.owner`update orders set note = 'x' where org_id = ${h.A.org}`;
		await h.owner`update products set price = price where id = ${h.A.prod}`;
		await new Promise((r) => setTimeout(r, 150));
		expect(b.events.filter((e) => e.event !== "ready")).toEqual([]);
		await b.close();
	},
	"POST /v1/public/locations/:slug/group-carts": async (h) => {
		const res = await h.app.request(
			"/v1/public/locations/b-main/group-carts",
			json({ displayName: "x" }),
		);
		expect(res.status).toBe(201);
		const [row] =
			await h.owner`select org_id from group_carts where token = ${((await res.json()) as { cart: { token: string } }).cart.token}`;
		expect(row?.org_id).toBe(h.B.org);
	},
	"POST /v1/public/group-carts/:token/participants": async (h) => {
		const { aToken } = await aCart(h);
		const res = await h.app.request(
			`/v1/public/group-carts/${aToken}/participants`,
			json({ displayName: "x" }),
		);
		expect(await res.text()).not.toContain(h.B.org);
	},
	"GET /v1/public/group-carts/:token": async (h) => {
		const { aToken } = await aCart(h);
		const text = await (
			await h.app.request(`/v1/public/group-carts/${aToken}`)
		).text();
		for (const id of [h.B.prod, h.A.org, h.A.loc])
			expect(text).not.toContain(id);
	},
	"PUT /v1/public/group-carts/:token/items/:itemId": async (h) => {
		const { aToken, bSecret } = await aCart(h);
		// B's participant secret on A's cart: not a participant.
		const res = await h.app.request(
			`/v1/public/group-carts/${aToken}/items/${uuidv7()}`,
			{
				method: "PUT",
				headers: {
					"content-type": "application/json",
					"x-participant-secret": bSecret,
					"if-match": "2",
				},
				body: JSON.stringify({ productId: h.A.prod, quantity: 1 }),
			},
		);
		expect(res.status).toBe(401);
	},
	"DELETE /v1/public/group-carts/:token/items/:itemId": async (h) => {
		const { aToken, bSecret } = await aCart(h);
		const res = await h.app.request(
			`/v1/public/group-carts/${aToken}/items/${uuidv7()}`,
			{
				method: "DELETE",
				headers: { "x-participant-secret": bSecret, "if-match": "2" },
			},
		);
		expect(res.status).toBe(401);
	},
	"POST /v1/public/group-carts/:token/lock": async (h) => {
		const { aToken, bSecret } = await aCart(h);
		const res = await h.app.request(`/v1/public/group-carts/${aToken}/lock`, {
			method: "POST",
			headers: { "x-participant-secret": bSecret, "if-match": "2" },
		});
		expect(res.status).toBe(401);
	},
	"POST /v1/public/group-carts/:token/unlock": async (h) => {
		const { aToken, bSecret } = await aCart(h);
		const res = await h.app.request(`/v1/public/group-carts/${aToken}/unlock`, {
			method: "POST",
			headers: { "x-participant-secret": bSecret, "if-match": "2" },
		});
		expect(res.status).toBe(401);
	},
	"POST /v1/public/group-carts/:token/submit": async (h) => {
		const { aToken, bSecret } = await aCart(h);
		const res = await h.app.request(
			`/v1/public/group-carts/${aToken}/submit`,
			json(
				{ type: "dine_in" },
				{ "x-participant-secret": bSecret, "idempotency-key": uuidv7() },
			),
		);
		expect(res.status).toBe(401);
	},
	"GET /v1/public/group-carts/:token/events": async (h) => {
		const { aToken } = await aCart(h);
		const [b] =
			await h.owner`select token from group_carts where org_id = ${h.B.org} limit 1`;
		const ac = new AbortController();
		const res = await h.app.request(
			`/v1/public/group-carts/${b?.token ?? aToken}/events`,
			{ signal: ac.signal },
		);
		expect(res.status).toBe(200);
		const reader = (res.body as ReadableStream<Uint8Array>).getReader();
		await reader.read(); // ready
		await h.owner`update group_carts set version = version + 1 where token = ${aToken}`;
		const next = await Promise.race([
			reader.read().then((r) => new TextDecoder().decode(r.value)),
			new Promise<string>((r) => setTimeout(() => r("silence"), 200)),
		]);
		expect(next).toBe("silence");
		ac.abort();
		await reader.cancel().catch(() => {});
	},
	"GET /v1/device/session": async (h) => {
		// A's staff token presented with B's device token.
		const a = await staffLogin(h, h.A, h.A.cashier);
		const res = await h.app.request("/v1/device/session", {
			headers: { ...bearer(h.B), "x-staff-token": a["x-staff-token"] },
		});
		expect(res.status).toBe(401);
	},
	"POST /v1/device/pin-login": async (h) => {
		// A's cashier, right PIN, on B's device: must not log in.
		const res = await h.app.request(
			"/v1/device/pin-login",
			json({ memberId: h.A.cashier, pin: PIN }, bearer(h.B)),
		);
		expect(res.status).toBe(401);
	},
};

/** One order owned by tenant A, created through A's own tablet. */
let aOrderId: string | undefined;
async function aOrder(h: Harness): Promise<string> {
	if (aOrderId) return aOrderId;
	const id = uuidv7();
	const res = await h.app.request(
		"/v1/sync/push",
		json(
			{
				deviceId: h.A.device,
				mutations: [
					{
						id: uuidv7(),
						kind: "order.create",
						entityId: id,
						memberId: h.A.cashier,
						createdAt: new Date().toISOString(),
						payload: {
							id,
							ticketNumber: "A-900",
							businessDate: "2026-11-17",
							source: "counter",
							type: "takeaway",
							placedAt: new Date().toISOString(),
							pricesIncludeTax: true,
							lines: [
								{
									id: uuidv7(),
									productId: h.A.prod,
									quantity: 1,
									modifierOptionIds: [],
									name: { en: "Latte" },
									listUnitPrice: 1500,
									promotionId: null,
									modifiers: [],
									taxBps: 0,
								},
							],
							expectedTotals: {
								subtotal: 1500,
								discountTotal: 0,
								taxTotal: 0,
								total: 1500,
							},
						},
					},
				],
			},
			bearer(h.A),
		),
	);
	const { results } = (await res.json()) as { results: { status: string }[] };
	expect(results[0]?.status).toBe("applied");
	aOrderId = id;
	return id;
}

/** A cart in tenant A, and a participant secret from a cart in tenant B. */
let carts: { aToken: string; bSecret: string } | undefined;
async function aCart(h: Harness) {
	if (carts) return carts;
	const a = await h.app.request(
		"/v1/public/locations/a-main/group-carts",
		json({ displayName: "A" }),
	);
	const b = await h.app.request(
		"/v1/public/locations/b-main/group-carts",
		json({ displayName: "B" }),
	);
	carts = {
		aToken: ((await a.json()) as { cart: { token: string } }).cart.token,
		bSecret: ((await b.json()) as { secret: string }).secret,
	};
	return carts;
}

describe("cross-tenant coverage", () => {
	it("has a cross-tenant case for every route", () => {
		const app = createApp({
			db: {} as never,
			staffTokenSecret: "x".repeat(32),
			pinLimiter: new PinLimiter(),
		});
		const routes = new Set(
			app.routes
				.filter((r) => r.method !== "ALL")
				.map((r) => `${r.method} ${r.path}`),
		);
		const missing = [...routes].filter(
			(r) => !PUBLIC_ROUTES.has(r) && !(r in cases),
		);
		expect(missing).toEqual([]);
	});
});

describe.runIf(ownerUrl)("cross-tenant isolation", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	for (const [route, run] of Object.entries(cases)) {
		it(route, () => run(h));
	}
});
