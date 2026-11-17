import { RealtimeEvent } from "@bite/contracts";

export type SseMessage = { event: string; data: string };

/**
 * Incremental SSE parser. Feed it text chunks as they arrive; it returns the
 * complete messages. Comments (": ping") and unknown fields are ignored.
 */
export class SseParser {
	private buf = "";

	push(chunk: string): SseMessage[] {
		this.buf += chunk.replace(/\r\n?/g, "\n");
		const out: SseMessage[] = [];
		let idx = this.buf.indexOf("\n\n");
		while (idx !== -1) {
			const block = this.buf.slice(0, idx);
			this.buf = this.buf.slice(idx + 2);
			let event = "message";
			const data: string[] = [];
			for (const line of block.split("\n")) {
				if (!line || line.startsWith(":")) continue;
				const colon = line.indexOf(":");
				const field = colon === -1 ? line : line.slice(0, colon);
				const value =
					colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
				if (field === "event") event = value;
				else if (field === "data") data.push(value);
			}
			if (data.length > 0 || event !== "message")
				out.push({ event, data: data.join("\n") });
			idx = this.buf.indexOf("\n\n");
		}
		return out;
	}
}

export type RealtimeHandlers = {
	/** Connected (and after every reconnect): pull, since nothing is replayed. */
	onReady: () => void;
	onEvent: (e: RealtimeEvent) => void;
	onRevoked: () => void;
};

/**
 * GET /v1/realtime with the device token. EventSource can't send an
 * Authorization header, so this reads the stream with fetch. Reconnects with
 * backoff forever until stop() or device.revoked for this device.
 */
export function connectRealtime(opts: {
	baseUrl: string;
	deviceToken: string;
	deviceId: string;
	handlers: RealtimeHandlers;
	fetch?: typeof fetch;
}): { stop: () => void } {
	const doFetch =
		opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
	let stopped = false;
	let ctrl: AbortController | null = null;
	let attempt = 0;

	const loop = async () => {
		while (!stopped) {
			ctrl = new AbortController();
			try {
				const res = await doFetch(
					`${opts.baseUrl.replace(/\/$/, "")}/v1/realtime`,
					{
						headers: {
							authorization: `Bearer ${opts.deviceToken}`,
							accept: "text/event-stream",
						},
						signal: ctrl.signal,
					},
				);
				if (res.status === 401 || res.status === 403) {
					opts.handlers.onRevoked();
					return;
				}
				if (!res.ok || !res.body)
					throw new Error(`realtime HTTP ${res.status}`);
				const reader = res.body
					.pipeThrough(new TextDecoderStream())
					.getReader();
				const parser = new SseParser();
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					for (const msg of parser.push(value)) {
						if (msg.event === "ready") {
							attempt = 0;
							opts.handlers.onReady();
							continue;
						}
						let parsed: RealtimeEvent;
						try {
							parsed = RealtimeEvent.parse(JSON.parse(msg.data));
						} catch {
							continue; // unknown/newer event: ignore, the next pull catches up anyway
						}
						if (
							parsed.type === "device.revoked" &&
							parsed.deviceId === opts.deviceId
						) {
							stopped = true;
							opts.handlers.onRevoked();
							return;
						}
						opts.handlers.onEvent(parsed);
					}
				}
			} catch {
				// network drop or abort; fall through to backoff
			}
			if (stopped) return;
			attempt++;
			await new Promise((r) =>
				setTimeout(r, Math.min(1_000 * 2 ** attempt, 30_000)),
			);
		}
	};
	void loop();
	return {
		stop: () => {
			stopped = true;
			ctrl?.abort();
		},
	};
}
