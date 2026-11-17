import type { GroupCartEvent, RealtimeEvent } from "@bite/contracts";

export type HubEvent = RealtimeEvent | GroupCartEvent;

/** What the database sends on the bite_events channel (migrations 0008, 0009). */
type Wire = HubEvent & { org: string; loc: string | null; cart?: string };

/**
 * A location subscriber (tablet) gets location events; a cart subscriber
 * (guest) gets only that cart's events.
 */
export type Subscriber = {
	orgId: string;
	locationId: string;
	cartId?: string;
	send: (e: HubEvent) => void;
};

export type Listen = (
	channel: string,
	onMessage: (payload: string) => void,
) => Promise<{ unlisten: () => Promise<void> }>;

/**
 * One LISTEN connection per API process, fanned out to SSE subscribers by
 * org + location. Menu bursts (bulk edits fire one NOTIFY per row) are
 * collapsed to one event per subscriber per `menuDebounceMs`.
 */
export class RealtimeHub {
	private subs = new Set<Subscriber>();
	private menuTimers = new Map<Subscriber, ReturnType<typeof setTimeout>>();
	private stop: (() => Promise<void>) | undefined;

	constructor(private readonly menuDebounceMs = 250) {}

	async start(listen: Listen): Promise<void> {
		const { unlisten } = await listen("bite_events", (p) => this.dispatch(p));
		this.stop = unlisten;
	}

	async close(): Promise<void> {
		for (const t of this.menuTimers.values()) clearTimeout(t);
		this.menuTimers.clear();
		this.subs.clear();
		await this.stop?.();
	}

	subscribe(s: Subscriber): () => void {
		this.subs.add(s);
		return () => {
			this.subs.delete(s);
			const t = this.menuTimers.get(s);
			if (t) clearTimeout(t);
			this.menuTimers.delete(s);
		};
	}

	get size(): number {
		return this.subs.size;
	}

	dispatch(payload: string): void {
		let w: Wire;
		try {
			w = JSON.parse(payload) as Wire;
		} catch {
			return;
		}
		const { org, loc, cart, ...event } = w;
		for (const s of this.subs) {
			if (s.orgId !== org) continue;
			if (loc && s.locationId !== loc) continue;
			if ((cart ?? null) !== (s.cartId ?? null)) continue;
			if (event.type === "menu.changed") {
				if (this.menuTimers.has(s)) continue;
				this.menuTimers.set(
					s,
					setTimeout(() => {
						this.menuTimers.delete(s);
						s.send({ type: "menu.changed" });
					}, this.menuDebounceMs),
				);
				continue;
			}
			s.send(event as HubEvent);
		}
	}
}
