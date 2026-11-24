import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	bearer,
	type Harness,
	json,
	ownerUrl,
	setupHarness,
	staffLogin,
	uuidv7,
} from "./harness.js";

type OrderRes = {
	order: { total: number; paymentStatus: string; trackingToken: string };
	guest?: {
		token?: string;
		points: number;
		pointsPending: number;
		redeemed?: { rewardId: string; amount: number };
	};
};

describe.runIf(ownerUrl)("returning guests and loyalty", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	const place = async (
		extra: Record<string, unknown> = {},
		headers: Record<string, string> = {},
		qty = 2,
	) => {
		const res = await h.app.request(
			"/v1/public/locations/a-main/orders",
			json(
				{
					locationSlug: "a-main",
					type: "takeaway",
					lines: [
						{
							id: uuidv7(),
							productId: h.A.prod,
							quantity: qty,
							modifierOptionIds: [],
						},
					],
					...extra,
				},
				{ "idempotency-key": uuidv7(), ...headers },
			),
		);
		return { status: res.status, body: (await res.json()) as OrderRes };
	};
	const orderId = async (tracking: string) => {
		const [o] = await h.owner<
			{ id: string; total: number; customer_id: string }[]
		>`
			select id, total::int, customer_id from orders where tracking_token = ${tracking}`;
		if (!o) throw new Error("no order");
		return o;
	};
	const payAtTill = async (id: string, amount: number) => {
		const res = await h.app.request(
			"/v1/sync/push",
			json(
				{
					deviceId: h.A.device,
					mutations: [
						{
							id: uuidv7(),
							kind: "order.addPayment",
							entityId: id,
							memberId: h.A.cashier,
							createdAt: new Date().toISOString(),
							payload: {
								id: uuidv7(),
								orderId: id,
								amount,
								method: "card",
								businessDate: new Date().toISOString().slice(0, 10),
							},
						},
					],
				},
				bearer(h.A),
			),
		);
		const r = (await res.json()) as { results: { status: string }[] };
		expect(r.results[0]?.status).toBe("applied");
	};
	const admin = (method: string, path: string, body?: unknown) =>
		h.app.request(`/v1/admin${path}`, {
			method,
			headers: { ...h.logins.A.owner, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});

	let token = "";
	let customerId = "";

	it("owner sets up the program", async () => {
		const res = await admin("PUT", "/loyalty", {
			enabled: true,
			pointsPerRial: 10,
			rewards: [
				{
					id: "coffee",
					name: { en: "Free coffee", ar: "قهوة مجانية" },
					points: 20,
					value: 1000,
				},
			],
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			enabled: true,
			pointsPerRial: 10,
		});
		// A branch manager can't change it.
		const m = await h.app.request("/v1/admin/loyalty", {
			method: "PUT",
			headers: { ...h.logins.A.manager, "content-type": "application/json" },
			body: JSON.stringify({ enabled: false, pointsPerRial: 1, rewards: [] }),
		});
		expect(m.status).toBe(403);
	});

	it("first order with a phone creates the guest and hands this phone a token", async () => {
		const { status, body } = await place({
			customerPhone: "9123 4567",
			customerName: "Sara",
		});
		expect(status).toBe(201);
		expect(body.guest?.token).toMatch(/^bg_/);
		const total = body.order.total;
		expect(body.guest?.pointsPending).toBe(Math.floor((total * 10) / 1000));
		token = body.guest?.token ?? "";
		const o = await orderId(body.order.trackingToken);
		customerId = o.customer_id;
		const [c] = await h.owner<
			{ phone: string; name: string; visit_count: number; points: number }[]
		>`
			select phone, name, visit_count, points from customers where id = ${customerId}`;
		expect(c).toMatchObject({
			phone: "+96891234567",
			name: "Sara",
			visit_count: 1,
			points: 0,
		});

		// Paid at the till: points land, once.
		await payAtTill(o.id, o.total);
		const [after] = await h.owner<{ points: number }[]>`
			select points from customers where id = ${customerId}`;
		expect(after?.points).toBe(Math.floor((o.total * 10) / 1000));
		const earns =
			await h.owner`select 1 from loyalty_ledger where order_id = ${o.id} and kind = 'earn'`;
		expect(earns.length).toBe(1);
	});

	it("the remembered guest sees points and last orders", async () => {
		const res = await h.app.request("/v1/public/locations/a-main/guest", {
			headers: { "x-bite-guest": token },
		});
		expect(res.status).toBe(200);
		const p = (await res.json()) as {
			name: string;
			phoneHint: string;
			points: number;
			recentOrders: { lines: { productId: string; quantity: number }[] }[];
		};
		expect(p.name).toBe("Sara");
		expect(p.phoneHint).toBe("•••• 4567");
		expect(p.recentOrders[0]?.lines[0]).toMatchObject({
			productId: h.A.prod,
			quantity: 2,
		});
		const bad = await h.app.request("/v1/public/locations/a-main/guest", {
			headers: { "x-bite-guest": "bg_not-a-real-token-at-all" },
		});
		expect(bad.status).toBe(404);
	});

	it("someone else typing the number earns for it but gets no token and can't redeem", async () => {
		const { body } = await place({ customerPhone: "+96891234567" });
		expect(body.guest?.token).toBeUndefined();
		const r = await place({
			customerPhone: "+96891234567",
			rewardId: "coffee",
		});
		expect(r.status).toBe(422);
		const [c] = await h.owner<{ visit_count: number }[]>`
			select visit_count from customers where id = ${customerId}`;
		expect(c?.visit_count).toBe(2);
	});

	it("redeems a reward at checkout with the token, no phone needed", async () => {
		await admin("POST", `/customers/${customerId}/points`, {
			points: 50,
			reason: "welcome",
		});
		const [before] = await h.owner<
			{ points: number }[]
		>`select points from customers where id = ${customerId}`;
		const { status, body } = await place(
			{ rewardId: "coffee" },
			{ "x-bite-guest": token },
		);
		expect(status).toBe(201);
		expect(body.guest?.redeemed).toEqual({ rewardId: "coffee", amount: 1000 });
		expect(body.order.paymentStatus).toBe("partially_paid");
		expect(body.guest?.points).toBe((before?.points ?? 0) - 20);
		const o = await orderId(body.order.trackingToken);
		expect(o.customer_id).toBe(customerId);
		const pays = await h.owner<{ method: string; amount: number }[]>`
			select method, amount::int from payments where order_id = ${o.id}`;
		expect(pays).toEqual([{ method: "loyalty", amount: 1000 }]);
		// Earn on the rest, not on the reward.
		await payAtTill(o.id, o.total - 1000);
		const [l] = await h.owner<{ points: number }[]>`
			select points from loyalty_ledger where order_id = ${o.id} and kind = 'earn'`;
		expect(l?.points).toBe(Math.floor(((o.total - 1000) * 10) / 1000));
	});

	it("refuses a reward the guest can't afford", async () => {
		await h.owner`update customers set points = 5 where id = ${customerId}`;
		const r = await place({ rewardId: "coffee" }, { "x-bite-guest": token });
		expect(r.status).toBe(422);
		await h.owner`update customers set points = 100 where id = ${customerId}`;
	});

	it("back office lists, searches and opens the guest", async () => {
		const list = await admin("GET", "/customers?q=4567");
		const items = (
			(await list.json()) as {
				items: { id: string; visitCount: number; totalSpent: number }[];
			}
		).items;
		expect(items.map((c) => c.id)).toEqual([customerId]);
		expect(items[0]?.totalSpent).toBeGreaterThan(0);
		const byName = await admin("GET", "/customers?q=sar&sort=spent");
		expect(((await byName.json()) as { items: unknown[] }).items).toHaveLength(
			1,
		);
		const d = await admin("GET", `/customers/${customerId}`);
		const detail = (await d.json()) as {
			ledger: { kind: string }[];
			orders: unknown[];
			favorites: { count: number }[];
		};
		expect(detail.ledger.map((l) => l.kind)).toEqual(
			expect.arrayContaining(["earn", "redeem", "adjust"]),
		);
		expect(detail.orders.length).toBe(3);
		expect(detail.favorites[0]?.count).toBeGreaterThan(0);
		const neg = await admin("POST", `/customers/${customerId}/points`, {
			points: -100000,
			reason: "x",
		});
		expect(neg.status).toBe(422);
	});

	it("the till finds the guest by phone and redeems on an order", async () => {
		const staff = await staffLogin(h, h.A, h.A.cashier);
		const found = await h.app.request("/v1/device/customers?phone=91234567", {
			headers: staff,
		});
		expect(found.status).toBe(200);
		expect(await found.json()).toMatchObject({ id: customerId, points: 100 });
		const none = await h.app.request("/v1/device/customers?phone=99999999", {
			headers: staff,
		});
		expect(none.status).toBe(404);

		const { body } = await place();
		const o = await orderId(body.order.trackingToken);
		const res = await h.app.request(
			`/v1/device/orders/${o.id}/redeem`,
			json({ rewardId: "coffee", customerId }, staff),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ amount: 1000, points: 20 });
		const [linked] = await h.owner<
			{ customer_id: string; payment_status: string }[]
		>`
			select customer_id, payment_status from orders where id = ${o.id}`;
		expect(linked).toEqual({
			customer_id: customerId,
			payment_status: "partially_paid",
		});
		// One reward per order.
		const again = await h.app.request(
			`/v1/device/orders/${o.id}/redeem`,
			json({ rewardId: "coffee", customerId }, staff),
		);
		expect(again.status).toBe(409);
	});
});
