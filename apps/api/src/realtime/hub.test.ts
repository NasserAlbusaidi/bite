import type { RealtimeEvent } from "@bite/contracts";
import { describe, expect, it } from "vitest";
import { RealtimeHub } from "./hub.js";

const wire = (o: Record<string, unknown>) => JSON.stringify(o);

describe("RealtimeHub", () => {
	it("routes by org and location, and org-wide events to every location", () => {
		const hub = new RealtimeHub(0);
		const got: Record<string, RealtimeEvent[]> = { a1: [], a2: [], b1: [] };
		hub.subscribe({
			orgId: "A",
			locationId: "1",
			send: (e) => got.a1?.push(e),
		});
		hub.subscribe({
			orgId: "A",
			locationId: "2",
			send: (e) => got.a2?.push(e),
		});
		hub.subscribe({
			orgId: "B",
			locationId: "1",
			send: (e) => got.b1?.push(e),
		});
		hub.dispatch(
			wire({
				type: "order.changed",
				org: "A",
				loc: "1",
				orderId: "o",
				version: 2,
				paymentStatus: "paid",
				fulfillmentStatus: "ready",
			}),
		);
		expect(got.a1).toEqual([
			{
				type: "order.changed",
				orderId: "o",
				version: 2,
				paymentStatus: "paid",
				fulfillmentStatus: "ready",
			},
		]);
		expect(got.a2).toEqual([]);
		expect(got.b1).toEqual([]);
	});

	it("collapses menu bursts into one event", async () => {
		const hub = new RealtimeHub(5);
		const got: RealtimeEvent[] = [];
		hub.subscribe({ orgId: "A", locationId: "1", send: (e) => got.push(e) });
		for (let i = 0; i < 50; i++)
			hub.dispatch(wire({ type: "menu.changed", org: "A", loc: null }));
		await new Promise((r) => setTimeout(r, 20));
		expect(got).toEqual([{ type: "menu.changed" }]);
		await hub.close();
	});

	it("ignores garbage and stops sending after unsubscribe", () => {
		const hub = new RealtimeHub(0);
		const got: RealtimeEvent[] = [];
		const off = hub.subscribe({
			orgId: "A",
			locationId: "1",
			send: (e) => got.push(e),
		});
		hub.dispatch("not json");
		off();
		hub.dispatch(
			wire({ type: "device.revoked", org: "A", loc: "1", deviceId: "d" }),
		);
		expect(got).toEqual([]);
		expect(hub.size).toBe(0);
	});
});
