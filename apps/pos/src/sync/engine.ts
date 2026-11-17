import { SyncPullResponse } from "@bite/contracts";
import type { ApiClient } from "../api/client.js";
import type { SqlDriver } from "../db/driver.js";
import { kvGet, kvSet } from "../db/kv.js";
import { saveMenu } from "../domain/menu.js";
import { upsertOrders } from "../domain/sale.js";
import { type FlushSummary, Replayer } from "./replayer.js";

export type SyncState = {
	online: boolean;
	lastPushAt: number | null;
	lastPullAt: number | null;
	lastError: string | null;
	authFailed: boolean;
};

/**
 * Drives push (outbox → server) and pull (server → local menu + orders).
 * Push first, then pull, so a pulled order never overwrites one of ours with
 * an older copy while our change is still queued.
 */
export class SyncEngine {
	private readonly replayer: Replayer;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running: Promise<void> | null = null;
	private readonly listeners = new Set<(s: SyncState) => void>();
	private readonly menuListeners = new Set<() => void>();
	private readonly orderListeners = new Set<() => void>();
	state: SyncState = {
		online: true,
		lastPushAt: null,
		lastPullAt: null,
		lastError: null,
		authFailed: false,
	};

	constructor(
		private readonly db: SqlDriver,
		private readonly api: ApiClient,
		deviceId: string,
		/** Fallback loop; realtime events and sales trigger a sync immediately. */
		private readonly intervalMs = 15_000,
	) {
		this.replayer = new Replayer({
			db,
			deviceId,
			transport: { push: (r) => api.push(r) },
		});
	}

	start() {
		const loop = async () => {
			await this.syncNow();
			this.timer = setTimeout(loop, this.intervalMs);
		};
		void loop();
	}

	stop() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	subscribe(fn: (s: SyncState) => void) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	onMenuChanged(fn: () => void) {
		this.menuListeners.add(fn);
		return () => this.menuListeners.delete(fn);
	}

	onOrdersChanged(fn: () => void) {
		this.orderListeners.add(fn);
		return () => this.orderListeners.delete(fn);
	}

	/** Call after a local write (sale, bump) or a realtime hint. Coalesces with a run in flight. */
	kick() {
		if (this.running) {
			this.again = true;
			return;
		}
		void this.syncNow();
	}

	private again = false;

	syncNow(): Promise<void> {
		this.running ??= this.run().finally(() => {
			this.running = null;
			// A hint arrived mid-run: what it points at may have missed this pull.
			if (this.again) {
				this.again = false;
				void this.syncNow();
			}
		});
		return this.running;
	}

	private async run() {
		const push: FlushSummary = await this.replayer.flush();
		if (push.error) {
			this.set({
				online: false,
				lastError: errText(push.error),
				authFailed: (push.error as { isAuth?: boolean }).isAuth === true,
			});
			return;
		}
		this.set({ lastPushAt: Date.now() });
		try {
			await this.pull();
			this.set({
				online: true,
				lastPullAt: Date.now(),
				lastError: null,
				authFailed: false,
			});
		} catch (err) {
			this.set({
				online: false,
				lastError: errText(err),
				authFailed: (err as { isAuth?: boolean }).isAuth === true,
			});
		}
	}

	private async pull() {
		// Orders land before the menu is announced, and the menu only after the
		// last page: the till can't ring a sale until it has seen today's
		// tickets, which is what keeps a freshly re-paired tablet from reusing
		// ticket numbers (nextTicketNumber floors on them).
		let menuChanged = false;
		try {
			for (let page = 0; page < 20; page++) {
				const cursor = await kvGet(this.db, "sync.cursor");
				const menuVersion = await kvGet(this.db, "menu.version");
				const res = SyncPullResponse.parse(
					await this.api.pull({ cursor, menuVersion }),
				);
				await upsertOrders(this.db, res.orders);
				if (res.orders.length > 0) for (const fn of this.orderListeners) fn();
				if (res.menu) {
					await saveMenu(this.db, res.menu);
					await kvSet(this.db, "menu.version", res.menuVersion);
					menuChanged = true;
				}
				await kvSet(this.db, "sync.cursor", res.cursor);
				if (!res.hasMore) return;
			}
		} finally {
			if (menuChanged) for (const fn of this.menuListeners) fn();
		}
	}

	private set(patch: Partial<SyncState>) {
		this.state = { ...this.state, ...patch };
		for (const fn of this.listeners) fn(this.state);
	}
}

function errText(e: unknown) {
	return e instanceof Error ? e.message : String(e);
}
