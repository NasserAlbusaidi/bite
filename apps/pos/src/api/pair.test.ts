import { describe, expect, it } from "vitest";
import { SyncHttpError } from "../sync/transport.js";
import { pairError } from "../ui/PairScreen.js";
import { pairWithCode } from "./client.js";

const device = {
	deviceId: "d1",
	orgId: "o1",
	locationId: "l1",
	kind: "pos",
	ticketPrefix: "B",
	name: "Till 2",
};

describe("pairWithCode", () => {
	it("posts the code to the server and keeps the token it gets back", async () => {
		const calls: { url: string; body: string }[] = [];
		const fake = (async (url: string, init: RequestInit) => {
			calls.push({ url, body: String(init.body) });
			return new Response(JSON.stringify({ token: "dev_new", device }), {
				status: 200,
			});
		}) as unknown as typeof fetch;
		const r = await pairWithCode("https://api.bite.om//", "K7QDM2PX", fake);
		expect(calls).toEqual([
			{ url: "https://api.bite.om/v1/pair", body: '{"code":"K7QDM2PX"}' },
		]);
		expect(r).toEqual({
			cfg: { baseUrl: "https://api.bite.om", deviceToken: "dev_new" },
			device,
		});
	});

	it("turns failures into plain words", async () => {
		const status = (s: number) =>
			(async () =>
				new Response("{}", { status: s })) as unknown as typeof fetch;
		const fail = (s: number) =>
			pairWithCode("https://x", "K7QDM2PX", status(s)).catch(pairError);
		expect(await fail(404)).toBe("pair.wrongCode");
		expect(await fail(429)).toBe("pair.tooMany");
		expect(await fail(502)).toBe("pair.offline");
		expect(pairError(new TypeError("Failed to fetch"))).toBe("pair.offline");
		expect(pairError(new SyncHttpError(401, "x"))).toBe("pair.wrongCode");
	});
});
