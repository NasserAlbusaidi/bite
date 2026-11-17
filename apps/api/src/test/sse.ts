import { expect } from "vitest";
import { bearer, type Harness, type Tenant } from "./harness.js";

/** Open the SSE stream and collect events until `until` matches or timeout. */
export async function openStream(h: Harness, t: Tenant) {
	const ac = new AbortController();
	const res = await h.app.request("/v1/realtime", {
		headers: bearer(t),
		signal: ac.signal,
	});
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type")).toContain("text/event-stream");
	const reader = (res.body as ReadableStream<Uint8Array>).getReader();
	const dec = new TextDecoder();
	let buf = "";
	const events: { event: string; data: Record<string, unknown> }[] = [];
	let ended = false;
	const pump = (async () => {
		for (;;) {
			const { value, done } = await reader
				.read()
				.catch(() => ({ value: undefined, done: true }));
			if (done) {
				ended = true;
				return;
			}
			buf += dec.decode(value, { stream: true });
			let i = buf.indexOf("\n\n");
			while (i >= 0) {
				const chunk = buf.slice(0, i);
				buf = buf.slice(i + 2);
				const ev = /^event: (.*)$/m.exec(chunk)?.[1];
				const data = /^data: (.*)$/m.exec(chunk)?.[1];
				if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
				i = buf.indexOf("\n\n");
			}
		}
	})();
	const waitFor = async (
		pred: (e: (typeof events)[number]) => boolean,
		ms = 3000,
	) => {
		const start = Date.now();
		while (Date.now() - start < ms) {
			const e = events.find(pred);
			if (e) return e;
			await new Promise((r) => setTimeout(r, 20));
		}
		return undefined;
	};
	await waitFor((e) => e.event === "ready");
	return {
		events,
		waitFor,
		isEnded: () => ended,
		close: async () => {
			ac.abort();
			await reader.cancel().catch(() => {});
			await pump;
		},
	};
}
