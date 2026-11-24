import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, type Harness, json, setupHarness } from "./harness.js";
import { openStream } from "./sse.js";

let h: Harness;
beforeAll(async () => {
	h = await setupHarness();
});
afterAll(async () => {
	await h.close();
});

describe("guest service calls", () => {
	it("reaches the till live, folds repeats, and closes", async () => {
		const stream = await openStream(h, h.A);
		const first = await h.app.request(
			"/v1/public/locations/a-main/service-requests",
			json({ kind: "waiter", tableLabel: "7" }),
		);
		expect(first.status).toBe(201);
		await stream.waitFor((e) => e.event === "service.changed");
		const again = await h.app.request(
			"/v1/public/locations/a-main/service-requests",
			json({ kind: "waiter", tableLabel: "7" }),
		);
		expect(again.status).toBe(200);
		const list = (await (
			await h.app.request("/v1/device/service-requests", {
				headers: bearer(h.A),
			})
		).json()) as {
			requests: { id: string; calls: number; tableLabel: string }[];
		};
		const mine = list.requests.filter((r) => r.tableLabel === "7");
		expect(mine).toHaveLength(1);
		expect(mine[0]?.calls).toBe(2);
		const done = await h.app.request(
			`/v1/device/service-requests/${mine[0]?.id}/done`,
			{ method: "POST", headers: bearer(h.A) },
		);
		expect(done.status).toBe(200);
		await stream.close();
	});

	it("rejects bad input and unknown locations", async () => {
		const bad = await h.app.request(
			"/v1/public/locations/a-main/service-requests",
			json({ kind: "dance", tableLabel: "7" }),
		);
		expect(bad.status).toBe(400);
		const noTable = await h.app.request(
			"/v1/public/locations/a-main/service-requests",
			json({ kind: "bill", tableLabel: "" }),
		);
		expect(noTable.status).toBe(400);
		const missing = await h.app.request(
			"/v1/public/locations/nope/service-requests",
			json({ kind: "bill", tableLabel: "1" }),
		);
		expect(missing.status).toBe(404);
	});

	it("needs a device token to read the calls", async () => {
		const res = await h.app.request("/v1/device/service-requests");
		expect(res.status).toBe(401);
	});
});
