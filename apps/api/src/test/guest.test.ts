import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	bearer,
	type Harness,
	json,
	ownerUrl,
	setupHarness,
	uuidv7,
} from "./harness.js";

type View = {
	order: {
		ticketNumber: string;
		total: number;
		subtotal: number;
		discountTotal: number;
		taxTotal: number;
		trackingToken: string;
		paymentStatus: string;
		lines: {
			unitPrice: number;
			listUnitPrice: number;
			promotionId: string | null;
			modifiers: unknown[];
		}[];
	};
};

describe.runIf(ownerUrl)("guest QR orders", () => {
	let h: Harness;
	const group = uuidv7();
	const oat = uuidv7();
	const promo = uuidv7();

	beforeAll(async () => {
		h = await setupHarness();
		const { A } = h;
		await h.owner`update locations set tax_bps = 500 where id = ${A.loc}`;
		await h.owner`insert into modifier_groups (id, org_id, name, min_select, max_select) values (${group}, ${A.org}, '{"en":"Milk"}', 0, 1)`;
		await h.owner`insert into modifier_options (id, org_id, group_id, name, price_delta) values (${oat}, ${A.org}, ${group}, '{"en":"Oat"}', 200)`;
		await h.owner`insert into product_modifier_groups (org_id, product_id, group_id) values (${A.org}, ${A.prod}, ${group})`;
		await h.owner`insert into promotions (id, org_id, name, kind, value, product_id) values (${promo}, ${A.org}, '10% off', 'percent', 1000, ${A.prod})`;
	});
	afterAll(() => h?.close());

	const order = (
		lines: unknown[],
		key: string | null = uuidv7(),
		slug = "a-main",
	) =>
		h.app.request(
			`/v1/public/locations/${slug}/orders`,
			json(
				{ locationSlug: slug, type: "takeaway", lines },
				key ? { "idempotency-key": key } : {},
			),
		);
	const line = (extra = {}) => ({
		id: uuidv7(),
		productId: h.A.prod,
		quantity: 2,
		modifierOptionIds: [oat],
		...extra,
	});

	it("prices from the live menu only and is idempotent per key", async () => {
		const key = uuidv7();
		const lines = [line()];
		const res = await order(lines, key);
		expect(res.status).toBe(201);
		const body = (await res.json()) as View;
		// 1.500 -10% = 1.350, + oat 0.200 = 1.550 x2 = 3.100 incl. 5% VAT; discount 0.300
		expect(body.order).toMatchObject({
			ticketNumber: "Q-1",
			total: 3100,
			discountTotal: 300,
			paymentStatus: "unpaid",
			lines: [{ listUnitPrice: 1500, unitPrice: 1350, promotionId: promo }],
		});
		const again = await order(lines, key);
		expect(again.status).toBe(200);
		expect(((await again.json()) as View).order.trackingToken).toBe(
			body.order.trackingToken,
		);

		const changed = await order([line({ quantity: 3 })], key);
		expect(changed.status).toBe(422);
		expect(await changed.json()).toMatchObject({
			error: { code: "idempotency_mismatch" },
		});
	});

	it("ignores any price a client tries to send", async () => {
		const res = await order([
			line({ quantity: 1, modifierOptionIds: [], unitPrice: 1, price: 1 }),
		]);
		expect(((await res.json()) as View).order.total).toBe(1350);
	});

	it("requires an Idempotency-Key", async () => {
		expect((await order([line()], null)).status).toBe(400);
	});

	it("names the lines that can't be ordered", async () => {
		await h.owner`insert into product_location_settings (org_id, product_id, location_id, is_available)
			values (${h.A.org}, ${h.A.prod}, ${h.A.loc}, false)`;
		const bad = line();
		const res = await order([bad]);
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({
			error: {
				code: "unprocessable",
				details: { reason: "items_unavailable", lineIds: [bad.id] },
			},
		});
		await h.owner`delete from product_location_settings where product_id = ${h.A.prod}`;
	});

	it("rejects bad modifiers", async () => {
		const res = await order([line({ modifierOptionIds: [uuidv7()] })]);
		expect(await res.json()).toMatchObject({
			error: { details: { reason: "invalid_modifiers" } },
		});
	});

	it("refuses orders while closed", async () => {
		const closed = Object.fromEntries(
			["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, []]),
		);
		await h.owner`update locations set business_hours = ${JSON.stringify(closed)}::jsonb where id = ${h.A.loc}`;
		const res = await order([line()]);
		expect(await res.json()).toMatchObject({
			error: { details: { reason: "not_accepting_orders" } },
		});
		await h.owner`update locations set business_hours = null where id = ${h.A.loc}`;
	});

	it("tracks by token and shows up on the tablet", async () => {
		const placed = (await (
			await order([line({ quantity: 1, modifierOptionIds: [] })])
		).json()) as View;
		const res = await h.app.request(
			`/v1/public/orders/${placed.order.trackingToken}`,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			ticketNumber: placed.order.ticketNumber,
			total: 1350,
		});
		expect((await h.app.request(`/v1/public/orders/${uuidv7()}`)).status).toBe(
			404,
		);

		const pull = await h.app.request("/v1/sync/pull", { headers: bearer(h.A) });
		const { orders } = (await pull.json()) as {
			orders: { ticketNumber: string; source: string }[];
		};
		expect(
			orders.find((o) => o.ticketNumber === placed.order.ticketNumber)?.source,
		).toBe("guest");
	});
});
