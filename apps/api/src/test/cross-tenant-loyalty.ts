import { expect } from "vitest";
import { type Harness, json, staffLogin, uuidv7 } from "./harness.js";

/**
 * Loyalty cross-tenant cases: B (owner, till, guest menu) aims at A's guests,
 * points and orders. Merged into the meta-checked table in cross-tenant.test.ts.
 */
type Case = (h: Harness) => Promise<void>;

const PROGRAM = {
	enabled: true,
	pointsPerRial: 10,
	rewards: [
		{ id: "coffee", name: { en: "Free coffee" }, points: 10, value: 500 },
	],
};

let fx:
	| { customer: string; token: string; order: string; phone: string }
	| undefined;
/** A runs loyalty and has one guest with points and an unpaid QR order. */
async function aGuest(h: Harness) {
	if (fx) return fx;
	await h.owner`insert into loyalty_programs (org_id, enabled, points_per_rial, rewards)
		values (${h.A.org}, true, 10, ${JSON.stringify(PROGRAM.rewards)}::jsonb)
		on conflict (org_id) do nothing`;
	const res = await h.app.request(
		"/v1/public/locations/a-main/orders",
		json(
			{
				locationSlug: "a-main",
				type: "takeaway",
				customerPhone: "+96891110000",
				lines: [
					{
						id: uuidv7(),
						productId: h.A.prod,
						quantity: 1,
						modifierOptionIds: [],
					},
				],
			},
			{ "idempotency-key": uuidv7() },
		),
	);
	expect(res.status).toBe(201);
	const body = (await res.json()) as {
		order: { trackingToken: string };
		guest: { token: string };
	};
	const [o] = await h.owner<{ id: string; customer_id: string }[]>`
		select id, customer_id from orders where tracking_token = ${body.order.trackingToken}`;
	if (!o) throw new Error("no order");
	await h.owner`update customers set points = 500 where id = ${o.customer_id}`;
	fx = {
		customer: o.customer_id,
		token: body.guest.token,
		order: o.id,
		phone: "+96891110000",
	};
	return fx;
}

async function aState(h: Harness, f: { customer: string }) {
	const rows = await h.owner<{ d: string }[]>`
		select (select points from customers where id = ${f.customer})::text || '|' ||
		       (select count(*) from loyalty_ledger where org_id = ${h.A.org})::text || '|' ||
		       (select count(*) from payments where org_id = ${h.A.org})::text || '|' ||
		       coalesce((select rewards::text from loyalty_programs where org_id = ${h.A.org}), '-') as d`;
	return rows[0]?.d;
}

const admin = (h: Harness, method: string, path: string, body?: unknown) =>
	h.app.request(`/v1/admin${path}`, {
		method,
		headers: { ...h.logins.B.owner, "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

export const loyaltyCases: Record<string, Case> = {
	"GET /v1/public/locations/:slug/guest": async (h) => {
		const f = await aGuest(h);
		// A's guest token on B's menu: unknown there.
		const res = await h.app.request("/v1/public/locations/b-main/guest", {
			headers: { "x-bite-guest": f.token },
		});
		expect(res.status).toBe(404);
	},
	"GET /v1/admin/loyalty": async (h) => {
		await aGuest(h);
		const res = await admin(h, "GET", "/loyalty");
		expect(res.status).toBe(200);
		expect(await res.text()).not.toContain("Free coffee");
	},
	"PUT /v1/admin/loyalty": async (h) => {
		const f = await aGuest(h);
		const before = await aState(h, f);
		const res = await admin(h, "PUT", "/loyalty", {
			...PROGRAM,
			rewards: [{ id: "x", name: { en: "Hijack" }, points: 1, value: 1000 }],
		});
		expect(res.status).toBe(200);
		expect(await aState(h, f)).toBe(before);
	},
	"GET /v1/admin/customers": async (h) => {
		const f = await aGuest(h);
		const res = await admin(h, "GET", "/customers?q=9111");
		const text = await res.text();
		expect(text).not.toContain(f.customer);
		expect(text).not.toContain(f.phone);
	},
	"GET /v1/admin/customers/:id": async (h) => {
		const f = await aGuest(h);
		const res = await admin(h, "GET", `/customers/${f.customer}`);
		expect(res.status).toBe(404);
	},
	"POST /v1/admin/customers/:id/points": async (h) => {
		const f = await aGuest(h);
		const before = await aState(h, f);
		const res = await admin(h, "POST", `/customers/${f.customer}/points`, {
			points: 1000,
			reason: "hijack",
		});
		expect(res.status).toBe(404);
		expect(await aState(h, f)).toBe(before);
	},
	"GET /v1/device/customers": async (h) => {
		const f = await aGuest(h);
		const res = await h.app.request(
			`/v1/device/customers?phone=${encodeURIComponent(f.phone)}`,
			{ headers: await staffLogin(h, h.B, h.B.cashier) },
		);
		expect(res.status).toBe(404);
		expect(await res.text()).not.toContain(f.customer);
	},
	"POST /v1/device/orders/:orderId/redeem": async (h) => {
		const f = await aGuest(h);
		const before = await aState(h, f);
		const res = await h.app.request(
			`/v1/device/orders/${f.order}/redeem`,
			json(
				{ rewardId: "coffee", customerId: f.customer },
				await staffLogin(h, h.B, h.B.cashier),
			),
		);
		expect(res.status).toBe(404);
		expect(await aState(h, f)).toBe(before);
	},
};
