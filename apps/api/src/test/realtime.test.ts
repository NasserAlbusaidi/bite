import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Harness,
	json,
	ownerUrl,
	setupHarness,
	uuidv7,
} from "./harness.js";
import { openStream } from "./sse.js";

describe.runIf(ownerUrl)("realtime SSE", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	it("requires a device token", async () => {
		expect((await h.app.request("/v1/realtime")).status).toBe(401);
	});

	it("pushes order and menu changes to the right location only", async () => {
		const a = await openStream(h, h.A);
		const b = await openStream(h, h.B);
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
							quantity: 1,
							modifierOptionIds: [],
						},
					],
				},
				{ "idempotency-key": uuidv7() },
			),
		);
		expect(res.status).toBe(201);
		const ev = await a.waitFor((e) => e.event === "order.changed");
		expect(ev?.data).toMatchObject({
			type: "order.changed",
			version: 1,
			paymentStatus: "unpaid",
			fulfillmentStatus: "pending",
		});
		expect(ev?.data).not.toHaveProperty("org");

		await h.owner`update products set price = 1600 where id = ${h.A.prod}`;
		expect(await a.waitFor((e) => e.event === "menu.changed")).toBeDefined();

		// B heard nothing of A's.
		await new Promise((r) => setTimeout(r, 100));
		expect(b.events.filter((e) => e.event !== "ready")).toEqual([]);
		await a.close();
		await b.close();
	});

	it("closes the stream when the device is revoked", async () => {
		const b = await openStream(h, h.B);
		await h.owner`update devices set revoked_at = now() where id = ${h.B.device}`;
		expect(await b.waitFor((e) => e.event === "device.revoked")).toBeDefined();
		const start = Date.now();
		while (!b.isEnded() && Date.now() - start < 2000)
			await new Promise((r) => setTimeout(r, 20));
		expect(b.isEnded()).toBe(true);
		await b.close();
		await h.owner`update devices set revoked_at = null where id = ${h.B.device}`;
	});

	it("unsubscribes on disconnect", async () => {
		const before = h.deps.realtime?.size ?? 0;
		const a = await openStream(h, h.A);
		expect(h.deps.realtime?.size).toBe(before + 1);
		await a.close();
		await new Promise((r) => setTimeout(r, 50));
		expect(h.deps.realtime?.size).toBe(before);
	});
});
