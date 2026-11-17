import { describe, expect, it } from "vitest";
import { connectRealtime, SseParser } from "./realtime.js";

describe("SseParser", () => {
	it("handles events split across chunks, CRLF, comments and multi-line data", () => {
		const p = new SseParser();
		expect(p.push("event: ready\ndata: {}\n")).toEqual([]);
		expect(p.push('\n: ping\n\nevent: order.changed\r\ndata: {"a":')).toEqual([
			{ event: "ready", data: "{}" },
		]);
		expect(p.push("1}\r\n\r\ndata: x\ndata: y\n\n")).toEqual([
			{ event: "order.changed", data: '{"a":1}' },
			{ event: "message", data: "x\ny" },
		]);
	});
});

const ORDER = "0190f000-0000-7000-8000-000000000001";
const ME = "0190f000-0000-7000-8000-0000000000dd";

function streamOf(text: string) {
	return new Response(new Blob([text]).stream(), {
		headers: { "content-type": "text/event-stream" },
	});
}

describe("connectRealtime", () => {
	it("calls ready, forwards valid events, ignores junk, stops on own device.revoked", async () => {
		const seen: string[] = [];
		await new Promise<void>((done) => {
			const conn = connectRealtime({
				baseUrl: "http://x",
				deviceToken: "t",
				deviceId: ME,
				fetch: async () =>
					streamOf(
						[
							"event: ready\ndata: {}\n\n",
							`event: order.changed\ndata: ${JSON.stringify({ type: "order.changed", orderId: ORDER, version: 2, paymentStatus: "paid", fulfillmentStatus: "preparing" })}\n\n`,
							"event: order.changed\ndata: not json\n\n",
							`event: menu.changed\ndata: {"type":"menu.changed"}\n\n`,
							`event: device.revoked\ndata: ${JSON.stringify({ type: "device.revoked", deviceId: ME })}\n\n`,
						].join(""),
					),
				handlers: {
					onReady: () => seen.push("ready"),
					onEvent: (e) => seen.push(e.type),
					onRevoked: () => {
						seen.push("revoked");
						conn.stop();
						done();
					},
				},
			});
		});
		expect(seen).toEqual(["ready", "order.changed", "menu.changed", "revoked"]);
	});

	it("treats 401 as revoked", async () => {
		let revoked = false;
		await new Promise<void>((done) => {
			connectRealtime({
				baseUrl: "http://x",
				deviceToken: "t",
				deviceId: ME,
				fetch: async () => new Response("{}", { status: 401 }),
				handlers: {
					onReady: () => {},
					onEvent: () => {},
					onRevoked: () => {
						revoked = true;
						done();
					},
				},
			});
		});
		expect(revoked).toBe(true);
	});
});
