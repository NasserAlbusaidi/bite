/**
 * Bite restaurant-day simulator. Drives the REAL API (loadsim/server.ts) and
 * Postgres with tablets, guests, group carts, a back office and an attacker.
 *
 * Time: virtual. simNow = VIRT0 + (real - REAL0) * SPEED. The API runs on the
 * same mapping, so promotions, business dates and expiry line up.
 *
 * Env: SIM_REAL0, SIM_VIRT0 (ISO), SIM_SPEED, SIM_FROM / SIM_TO (ISO, virtual),
 *      SIM_MODE=day|stress, SIM_QR_FIXED=1 (till charges QR orders via
 *      order.addPayment, i.e. the missing till feature), SIM_OUT=name, API_PID.
 */
// biome-ignore-all lint: throwaway load tool, loosely typed on purpose
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
	buildCatalog,
	businessDate,
	localClock,
	planRefund,
	priceCart,
	summarizePayments,
} from "@bite/core";
import { createDb } from "@bite/db";
import postgres from "postgres";
import { v7 as uuid } from "uuid";
import { expireGroupCarts, expireGuestOrders } from "../src/jobs/tasks.js";

// ------------------------------------------------------------------ config
const env = (k: string, d?: string) => {
	const v = process.env[k] ?? d;
	if (v === undefined) throw new Error(`${k} required`);
	return v;
};
const BASE = env("SIM_BASE", "http://localhost:3000");
const REAL0 = Number(env("SIM_REAL0"));
const VIRT0 = Date.parse(env("SIM_VIRT0"));
const SPEED = Number(env("SIM_SPEED"));
const FROM = Date.parse(env("SIM_FROM", env("SIM_VIRT0")));
const TO = Date.parse(env("SIM_TO"));
const MODE = env("SIM_MODE", "day") as "day" | "stress";
const QR_FIXED = env("SIM_QR_FIXED", "0") === "1";
const OUT = env("SIM_OUT", "day");
const API_PID = Number(env("API_PID", "0"));
const ADMIN_ORIGIN = "http://localhost:5173";
const TZ = "Asia/Muscat";
const POLL_MS = 5000;
/** Stress: tenant-equivalents. C copies of (A + B) at their Thursday-night peak, with C x 15 tablets polling. */
const C = Number(env("SIM_C", "0"));

const seed = JSON.parse(
	readFileSync(new URL("./out/seed.json", import.meta.url), "utf8"),
);
const ownerSql = postgres("postgres://postgres:postgres@localhost:5432/bite", {
	max: 3,
	onnotice: () => {},
});
const worker = createDb(
	"postgres://bite_worker:bite_worker@localhost:5432/bite",
	{
		max: 2,
	},
);

const simNow = () => VIRT0 + (Date.now() - REAL0) * SPEED;
const sleepReal = (ms: number) =>
	new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const sleepSim = (simMs: number) => sleepReal(simMs / SPEED);
const sleepUntilSim = (t: number) => sleepReal((t - simNow()) / SPEED);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T =>
	xs[Math.floor(Math.random() * xs.length)] as T;
const MIN = 60_000;
/** Virtual instant for local HH:MM on the sim day (+1 for after midnight). */
const DAY0 = env("SIM_DAY");
const at = (hhmm: string, plusDays = 0) => {
	const d = new Date(`${DAY0}T${hhmm}:00+04:00`).getTime();
	return d + plusDays * 86_400_000;
};
const hhmm = (t: number) =>
	new Date(t + 4 * 3600_000).toISOString().slice(11, 16);
let stopping = false;

// ------------------------------------------------------------------ metrics
type Rec = [
	real: number,
	sim: number,
	label: string,
	ms: number,
	status: number,
	bytes: number,
];
const recs: Rec[] = [];
const S: Record<string, number> = {};
const inc = (k: string, n = 1) => {
	S[k] = (S[k] ?? 0) + n;
};
const notes: string[] = [];
const leaks: string[] = [];
const rtLatency: number[] = [];
const dbSamples: any[] = [];
const problems: any[] = [];

async function http(
	label: string,
	method: string,
	path: string,
	opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; json: any; headers?: Headers }> {
	const t0 = performance.now();
	let status = 0;
	let json: any = null;
	let headers: Headers | undefined;
	let bytes = 0;
	try {
		const res = await fetch(BASE + path, {
			method,
			headers: {
				...(opts.body === undefined
					? {}
					: { "content-type": "application/json" }),
				...opts.headers,
			},
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		});
		status = res.status;
		headers = res.headers;
		const txt = await res.text();
		bytes = txt.length;
		json = txt ? safeJson(txt) : null;
	} catch (e) {
		json = { error: { code: "network", message: String(e) } };
	}
	recs.push([
		Date.now(),
		simNow(),
		label,
		performance.now() - t0,
		status,
		bytes,
	]);
	return { status, json, headers };
}
const safeJson = (t: string) => {
	try {
		return JSON.parse(t);
	} catch {
		return { raw: t.slice(0, 200) };
	}
};

// ------------------------------------------------------------------ menu
function prepareMenu(snapshot: any) {
	const catalog = buildCatalog(
		snapshot.products.map((p: any) => ({
			id: p.id,
			categoryId: p.categoryId,
			name: p.name,
			price: p.price,
			taxBps: p.taxBps,
			isAvailable: p.isAvailable,
			modifierGroupIds: p.modifierGroupIds,
		})),
		snapshot.modifierGroups.map((g: any) => ({
			id: g.id,
			name: g.name,
			minSelect: g.minSelect,
			maxSelect: g.maxSelect,
			options: [...g.options]
				.sort((a: any, b: any) => a.sortOrder - b.sortOrder)
				.map((o: any) => ({
					id: o.id,
					name: o.name,
					priceDelta: o.priceDelta,
					isAvailable: o.isAvailable,
				})),
		})),
	);
	const promotions = snapshot.promotions.map((p: any) => ({
		id: p.id,
		kind: p.kind,
		value: p.value,
		productId: p.productId,
		categoryId: p.categoryId,
		startsAt: p.startsAt,
		endsAt: p.endsAt,
		dailyStart: p.dailyStart,
		dailyEnd: p.dailyEnd,
		daysOfWeek: p.daysOfWeek,
		priority: p.priority,
	}));
	const catName = new Map(
		snapshot.categories.map((c: any) => [c.id, c.name.en]),
	);
	return { snapshot, catalog, promotions, catName };
}
type Menu = ReturnType<typeof prepareMenu>;

function priceAt(menu: Menu, lines: any[], t: number) {
	const loc = menu.snapshot.location;
	return priceCart(lines, menu.catalog, {
		settings: {
			pricesIncludeTax: loc.pricesIncludeTax,
			taxBps: loc.taxBps,
			locationId: loc.locationId,
		},
		promotions: menu.promotions,
		at: localClock(t, loc.timezone),
	} as any);
}

/** A plausible order for a party, from what is available on this menu. */
function randomCart(menu: Menu, orgKey: "A" | "B", size: number) {
	const groups = new Map(
		menu.snapshot.modifierGroups.map((g: any) => [g.id, g]),
	);
	const byCat = new Map<string, any[]>();
	for (const p of menu.snapshot.products) {
		if (!p.isAvailable) continue;
		const c = menu.catName.get(p.categoryId) as string;
		byCat.set(c, [...(byCat.get(c) ?? []), p]);
	}
	const take = (cat: string, n: number, out: any[]) => {
		const ps = byCat.get(cat);
		if (!ps?.length) return;
		for (let i = 0; i < n; i++) out.push(pick(ps));
	};
	const chosen: any[] = [];
	const hour = Number(hhmm(simNow()).slice(0, 2));
	if (orgKey === "A") {
		for (let i = 0; i < size; i++) {
			if (hour < 11 && Math.random() < 0.6) take("Breakfast", 1, chosen);
			else if (Math.random() < 0.45) take(pick(["Mains", "Sweets"]), 1, chosen);
			if (Math.random() < 0.85)
				take(pick(["Hot drinks", "Hot drinks", "Cold drinks"]), 1, chosen);
		}
		if (chosen.length === 0) take("Hot drinks", 1, chosen);
	} else {
		if (size >= 4 && Math.random() < 0.35)
			take("Grills", 0, chosen),
				chosen.push(
					menu.snapshot.products.find(
						(p: any) => p.name.en === "Family grill platter" && p.isAvailable,
					) ?? pick(byCat.get("Grills") ?? []),
				);
		const mains = Math.max(
			1,
			Math.round(size * rnd(0.6, 1)) - (chosen.length ? 3 : 0),
		);
		for (let i = 0; i < mains; i++)
			take(pick(["Grills", "Mandi", "Mandi"]), 1, chosen);
		take("Starters", Math.floor(rnd(0, 2.5)), chosen);
		take("Drinks", Math.round(size * rnd(0.4, 1)), chosen);
		if (Math.random() < 0.25) take("Desserts", 1, chosen);
	}
	// Modifiers + merge identical lines.
	const merged = new Map<string, any>();
	for (const p of chosen.filter(Boolean)) {
		const mods: string[] = [];
		for (const gid of p.modifierGroupIds) {
			const g: any = groups.get(gid);
			if (!g) continue;
			const avail = g.options.filter((o: any) => o.isAvailable);
			let k = g.minSelect;
			while (k < g.maxSelect && Math.random() < 0.25) k++;
			const shuffled = [...avail].sort(() => Math.random() - 0.5);
			for (const o of shuffled.slice(0, k)) mods.push(o.id);
		}
		const key = `${p.id}|${mods.sort().join(",")}`;
		const prev = merged.get(key);
		if (prev) prev.quantity++;
		else
			merged.set(key, {
				productId: p.id,
				quantity: 1,
				modifierOptionIds: mods,
				note: null,
			});
	}
	return [...merged.values()];
}

// ------------------------------------------------------------------ the sim's own books
type SimPay = {
	id: string;
	amount: number;
	method: string;
	sessionId: string | null;
	day: string;
	ok: boolean | null;
	reverses?: string;
};
type SimOrder = {
	id: string;
	org: "A" | "B";
	locId: string;
	day: string;
	source: string;
	ticket: string;
	tillId: string | null;
	placedAt: number;
	totals: {
		subtotal: number;
		discountTotal: number;
		taxTotal: number;
		total: number;
	};
	lines: any[];
	pays: SimPay[];
	accepted: boolean | null;
	cancelled: boolean;
	voided: Set<string>;
	refundedFull: boolean;
	staleMenu: boolean;
};
const books = new Map<string, SimOrder>();
const guestOrders: any[] = [];

// ------------------------------------------------------------------ tablets
type Mut = {
	id: string;
	kind: string;
	entityId: string;
	memberId: string;
	createdAt: string;
	payload: any;
	baseVersion?: number;
};

class Tablet {
	orders = new Map<string, any>();
	outbox: Mut[] = [];
	online = true;
	menu!: Menu;
	menuVersion?: string;
	cursor?: string;
	flushing = false;
	pulling = false;
	pullAgain = false;
	sse?: AbortController;
	member: any;
	cash: { id: string; float: number; expected: number; open: boolean } | null =
		null;
	seq = new Map<string, number>();
	queue: (() => Promise<void>)[] = [];
	busy = false;
	scheduled = new Set<string>();
	timer?: NodeJS.Timeout;
	parked = new Set<string>();
	constructor(
		readonly org: any,
		readonly loc: any,
		readonly dev: any,
	) {}
	get headers() {
		return { authorization: `Bearer ${this.dev.token}` };
	}
	get isKds() {
		return this.dev.kind === "kds";
	}
	tag() {
		return `${this.loc.name}/${this.dev.name}`;
	}

	async start() {
		const s = await http("device.staff", "GET", "/v1/device/staff", {
			headers: this.headers,
		});
		if (s.status !== 200)
			throw new Error(`staff list failed ${this.tag()} ${s.status}`);
		await this.login(this.isKds ? "kitchen" : "cashier");
		await this.pull();
		this.openSse();
		this.timer = setInterval(() => void this.pull(), POLL_MS);
	}
	async login(role: string) {
		const cands = this.loc.staff.filter((m: any) => m.role === role);
		const m = pick(cands.length ? cands : this.loc.staff);
		this.member = m;
		if (!this.online) {
			inc("pin.offlineUnlock");
			return null;
		}
		const r = await http("device.pinLogin", "POST", "/v1/device/pin-login", {
			headers: this.headers,
			body: { memberId: m.id, pin: m.pin },
		});
		if (r.status !== 200) inc(`pin.fail.${r.status}`);
		return r.json?.staffToken as string | undefined;
	}
	stop() {
		clearInterval(this.timer);
		this.sse?.abort();
	}
	goOffline() {
		this.online = false;
		this.sse?.abort();
		notes.push(`${hhmm(simNow())} ${this.tag()} OFFLINE`);
	}
	async goOnline() {
		this.online = true;
		notes.push(
			`${hhmm(simNow())} ${this.tag()} back ONLINE with ${this.outbox.length} queued mutations`,
		);
		inc("offline.queuedAtReconnect", this.outbox.length);
		const t0 = Date.now();
		await this.flush();
		inc("offline.drainRealMs", Date.now() - t0);
		await this.pull();
		this.openSse();
	}

	openSse() {
		if (!this.online || stopping) return;
		const ac = new AbortController();
		this.sse = ac;
		(async () => {
			try {
				const res = await fetch(`${BASE}/v1/realtime`, {
					headers: this.headers,
					signal: ac.signal,
				});
				if (!res.body) return;
				inc("sse.connect");
				const reader = res.body.getReader();
				const dec = new TextDecoder();
				let buf = "";
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					buf += dec.decode(value, { stream: true });
					let i = buf.indexOf("\n\n");
					while (i >= 0) {
						const chunk = buf.slice(0, i);
						buf = buf.slice(i + 2);
						const ev = /event: ?(.*)/.exec(chunk)?.[1];
						const data = /data: ?(.*)/.exec(chunk)?.[1];
						if (ev && data) this.onEvent(ev, safeJson(data));
						i = buf.indexOf("\n\n");
					}
				}
			} catch {}
			if (this.online && !stopping && this.sse === ac)
				setTimeout(() => this.openSse(), 1000);
		})();
	}
	onEvent(ev: string, data: any) {
		if (ev === "ready") return void this.pull();
		inc(`sse.${ev}`);
		if (ev === "order.changed" && this.isKds && data.paymentStatus === "paid") {
			const t = paidPushStart.get(data.orderId);
			if (t !== undefined) {
				rtLatency.push(Date.now() - t);
				paidPushStart.delete(data.orderId);
			}
		}
		void this.pull();
	}

	async pull() {
		if (!this.online || stopping) return;
		if (this.pulling) {
			this.pullAgain = true;
			return;
		}
		this.pulling = true;
		try {
			do {
				this.pullAgain = false;
				let more = true;
				while (more && this.online) {
					const q = new URLSearchParams();
					if (this.cursor) q.set("cursor", this.cursor);
					if (this.menuVersion) q.set("menuVersion", this.menuVersion);
					const r = await http(
						this.cursor ? "sync.pull" : "sync.pull.first",
						"GET",
						`/v1/sync/pull?${q}`,
						{ headers: this.headers },
					);
					if (r.status !== 200) {
						inc(`pull.fail.${r.status}`);
						break;
					}
					if (r.json.menu) {
						if (this.menuVersion) inc("menu.refreshed");
						this.menu = prepareMenu(r.json.menu);
						this.menuVersion = r.json.menuVersion;
					}
					inc("pull.orders", r.json.orders.length);
					for (const o of r.json.orders) {
						if (o.locationId !== this.loc.id)
							leaks.push(
								`pull on ${this.tag()} returned order of location ${o.locationId}`,
							);
						const cur = this.orders.get(o.id);
						if (!cur || o.version >= cur.version) this.orders.set(o.id, o);
						else inc("pull.olderVersionIgnored");
						if (cur && o.version === cur.version) inc("pull.repeatSameVersion");
					}
					this.cursor = r.json.cursor;
					more = r.json.hasMore;
				}
			} while (this.pullAgain && this.online);
		} finally {
			this.pulling = false;
		}
		if (this.isKds) this.kitchenTick();
	}

	enqueue(
		kind: string,
		entityId: string,
		payload: any,
		memberId = this.member.id,
		baseVersion?: number,
	) {
		const m: Mut = {
			id: uuid(),
			kind,
			entityId,
			memberId,
			createdAt: new Date(simNow()).toISOString(),
			payload,
		};
		if (baseVersion !== undefined) m.baseVersion = baseVersion;
		this.outbox.push(m);
		return m;
	}
	queuedFor(entityId: string) {
		return this.outbox.some((m) => m.entityId === entityId);
	}

	async flush(): Promise<void> {
		if (this.flushing || !this.online) return;
		this.flushing = true;
		try {
			while (this.online && this.outbox.length) {
				const batch = this.outbox.slice(0, 100);
				const t0 = Date.now();
				const r = await http(
					batch.length > 5 ? "sync.push.batch" : "sync.push",
					"POST",
					"/v1/sync/push",
					{
						headers: this.headers,
						body: { deviceId: this.dev.id, mutations: batch },
					},
				);
				if (r.status !== 200) {
					inc(`push.fail.${r.status}`);
					if (r.status === 400 || r.status === 422) {
						problems.push({
							dev: this.tag(),
							status: r.status,
							err: r.json,
							kinds: batch.map((b) => b.kind),
						});
						this.outbox.splice(0, batch.length);
					} else await sleepReal(2000);
					continue;
				}
				const sent = new Set(batch.map((b) => b.id));
				this.outbox = this.outbox.filter((m) => !sent.has(m.id));
				const requeue: Mut[] = [];
				for (const res of r.json.results) {
					const m = batch.find((b) => b.id === res.id) as Mut;
					inc(`mut.${m.kind}.${res.status}`);
					this.onResult(m, res, t0, requeue);
				}
				if (requeue.length) this.outbox.unshift(...requeue);
			}
		} finally {
			this.flushing = false;
		}
	}

	onResult(m: Mut, res: any, t0: number, requeue: Mut[]) {
		const b = books.get(m.entityId);
		const ok = res.status === "applied" || res.status === "duplicate";
		if (m.kind === "order.create" && b) b.accepted = ok;
		if ((m.kind === "order.addPayment" || m.kind === "order.refund") && b) {
			const p = b.pays.find((x) => x.id === m.payload.id);
			if (p && res.status !== "blocked") p.ok = ok;
			if (
				ok &&
				m.kind === "order.addPayment" &&
				b.pays.every((x) => x.ok || x.reverses)
			)
				paidPushStart.set(b.id, t0);
		}
		if (m.kind === "order.voidLine" && b && ok) b.voided.add(m.payload.lineId);
		if (
			m.kind === "order.setFulfillment" &&
			b &&
			ok &&
			m.payload.to === "cancelled"
		)
			b.cancelled = true;
		if (m.kind === "cash.close" && ok && this.cash) this.cash.open = false;
		if (res.status === "rejected") {
			const reason = res.error?.details?.reason ?? res.error?.code;
			inc(`reject.${m.kind}.${reason}`);
			problems.push({
				dev: this.tag(),
				sim: hhmm(simNow()),
				kind: m.kind,
				reason,
				msg: res.error?.message,
			});
			// Manager "sets it aside" later; anything that was blocked behind it goes again.
			this.parked.add(m.entityId);
			if (m.kind === "order.addPayment" && b) {
				// Money the till thinks it took but the server refused.
				inc("money.refusedPayments", m.payload.amount);
			}
		}
		if (res.status === "blocked") {
			inc(`blocked.${m.kind}`);
			requeue.push(m); // same id, retried after set-aside
		}
		if (res.status === "conflict") {
			inc(`conflict.${m.kind}`);
			problems.push({
				dev: this.tag(),
				sim: hhmm(simNow()),
				kind: m.kind,
				reason: "conflict",
			});
			if (m.kind === "order.setFulfillment") {
				// Problems sheet: "send again" = new id after a pull.
				void this.pull().then(() => {
					const o = this.orders.get(m.entityId);
					if (
						o &&
						o.fulfillmentStatus !== m.payload.to &&
						o.fulfillmentStatus !== "cancelled" &&
						o.fulfillmentStatus !== "completed"
					) {
						this.enqueue(
							"order.setFulfillment",
							m.entityId,
							m.payload,
							m.memberId,
							o.version,
						);
						inc("conflict.resent");
						void this.flush();
					}
				});
			}
		}
	}

	// ---------------------------------------------------------------- till
	run(job: () => Promise<void>) {
		this.queue.push(job);
		inc("till.queueMax", 0);
		S[`qmax.${this.tag()}`] = Math.max(
			S[`qmax.${this.tag()}`] ?? 0,
			this.queue.length,
		);
		void this.drain();
	}
	async drain() {
		if (this.busy) return;
		this.busy = true;
		while (this.queue.length && !stopping) {
			const j = this.queue.shift() as () => Promise<void>;
			try {
				await j();
			} catch (e) {
				inc("till.jobError");
				notes.push(`till job error ${this.tag()}: ${String(e)}`);
			}
		}
		this.busy = false;
	}
	nextTicket(day: string) {
		const n = (this.seq.get(day) ?? 0) + 1;
		this.seq.set(day, n);
		return `${this.dev.prefix}-${n}`;
	}

	/** commitSale, like apps/pos domain/sale.ts. Returns the order id or null. */
	sale(
		lines0: any[],
		type: string,
		source: string,
		customerName?: string,
	): string | null {
		const t = simNow();
		let lines = lines0.map((l) => ({ ...l, lineId: uuid() }));
		let q = priceAt(this.menu, lines, t);
		if (!q.ok) {
			const bad = new Set(q.errors.map((e: any) => e.lineIndex));
			inc("till.itemsRemovedUnavailable", bad.size);
			lines = lines.filter((_, i) => !bad.has(i));
			if (!lines.length) {
				inc("till.saleAbandoned");
				return null;
			}
			q = priceAt(this.menu, lines, t);
			if (!q.ok) {
				inc("till.saleAbandoned");
				return null;
			}
		}
		const priced = q.value;
		const loc = this.menu.snapshot.location;
		const day = businessDate(t, loc.timezone, loc.dayCutoffMinutes);
		const id = uuid();
		const ticket = this.nextTicket(day);
		const create = {
			id,
			ticketNumber: ticket,
			businessDate: day,
			source: "counter",
			type,
			...(customerName ? { customerName } : {}),
			placedAt: new Date(t).toISOString(),
			pricesIncludeTax: priced.pricesIncludeTax,
			lines: priced.lines.map((l: any, i: number) => ({
				id: (lines[i] as any).lineId,
				productId: l.productId,
				quantity: l.quantity,
				modifierOptionIds: l.modifiers.map((m: any) => m.optionId),
				name: l.name,
				listUnitPrice: l.listUnitPrice,
				promotionId: l.promotionId,
				modifiers: l.modifiers.map((m: any) => ({ ...m })),
				taxBps: l.taxBps,
			})),
			expectedTotals: {
				subtotal: priced.subtotal,
				discountTotal: priced.discountTotal,
				taxTotal: priced.taxTotal,
				total: priced.total,
			},
		};
		this.enqueue("order.create", id, create);
		const book: SimOrder = {
			id,
			org: this.org.key,
			locId: this.loc.id,
			day,
			source,
			ticket,
			tillId: this.dev.id,
			placedAt: t,
			totals: { ...create.expectedTotals },
			lines: priced.lines.map((l: any, i: number) => ({
				...l,
				id: (lines[i] as any).lineId,
			})),
			pays: [],
			accepted: null,
			cancelled: false,
			voided: new Set(),
			refundedFull: false,
			staleMenu: !this.online,
		};
		books.set(id, book);
		const T = priced.total as number;
		const r = Math.random();
		const tenders: { method: string; amount: number; tendered?: number }[] =
			T === 0
				? []
				: r < 0.62
					? [{ method: "card", amount: T }]
					: r < 0.95
						? [{ method: "cash", amount: T, tendered: noteUp(T) }]
						: T >= 400
							? [
									{
										method: "cash",
										amount: Math.floor(T / 200) * 100,
										tendered: Math.floor(T / 200) * 100,
									},
									{ method: "card", amount: T - Math.floor(T / 200) * 100 },
								]
							: [{ method: "card", amount: T }];
		for (const td of tenders) {
			const p: any = {
				id: uuid(),
				orderId: id,
				amount: td.amount,
				tip: 0,
				method: td.method,
				businessDate: day,
			};
			if (td.method === "cash") {
				if (!this.cash?.open) {
					inc("till.noDrawerCashToCard");
					p.method = "card";
				} else {
					p.cashSessionId = this.cash.id;
					p.tendered = td.tendered ?? td.amount;
					this.cash.expected += td.amount;
				}
			}
			this.enqueue("order.addPayment", id, p);
			book.pays.push({
				id: p.id,
				amount: td.amount,
				method: p.method,
				sessionId: p.cashSessionId ?? null,
				day,
				ok: null,
			});
		}
		inc(`sale.${source}`);
		if (!this.online) inc("kitchen.paperOnlyOffline");
		void this.flush();
		return id;
	}

	/** Manager refund of a whole paid order (refund every payment, then cancel if still open). */
	async refundWhole(o: SimOrder, reason: string) {
		const mgr = this.loc.staff.find((m: any) => m.role === "manager");
		if (this.online)
			await http("device.pinLogin", "POST", "/v1/device/pin-login", {
				headers: this.headers,
				body: { memberId: mgr.id, pin: mgr.pin },
			});
		const okPays = o.pays.filter((p) => p.ok !== false && !p.reverses);
		for (const p of [...okPays].reverse()) {
			const already = -o.pays
				.filter((x) => x.reverses === p.id && x.ok !== false)
				.reduce((s, x) => s + x.amount, 0);
			const amt = p.amount - already;
			if (amt <= 0) continue;
			const payload: any = {
				id: uuid(),
				reversesPaymentId: p.id,
				amount: amt,
				reason,
				businessDate: businessDate(simNow(), TZ, 240),
			};
			if (p.method === "cash") {
				if (!this.cash?.open) continue;
				payload.cashSessionId = this.cash.id;
				this.cash.expected -= amt;
			}
			this.enqueue("order.refund", o.id, payload, mgr.id);
			o.pays.push({
				id: payload.id,
				amount: -amt,
				method: p.method,
				sessionId: payload.cashSessionId ?? null,
				day: payload.businessDate,
				ok: null,
				reverses: p.id,
			});
		}
		o.refundedFull = true;
		const local = this.orders.get(o.id);
		if (
			!local ||
			!["completed", "cancelled"].includes(local.fulfillmentStatus)
		) {
			this.enqueue(
				"order.setFulfillment",
				o.id,
				{ orderId: o.id, to: "cancelled", reason },
				mgr.id,
			);
		}
		inc("refund.whole");
		await this.flush();
	}

	/** "Refund item" on an open order: refund the line's gross, then void it. */
	async refundItem(o: SimOrder) {
		const live = o.lines.filter((l) => !o.voided.has(l.id));
		if (live.length < 2) return;
		const line = pick(live);
		const mgr = this.loc.staff.find((m: any) => m.role === "manager");
		if (this.online)
			await http("device.pinLogin", "POST", "/v1/device/pin-login", {
				headers: this.headers,
				body: { memberId: mgr.id, pin: mgr.pin },
			});
		const entries = o.pays
			.filter((p) => p.ok !== false)
			.map((p) => ({
				id: p.id,
				amount: p.amount,
				method: p.method,
				state: "succeeded",
				reversesPaymentId: p.reverses ?? null,
			}));
		const plan = planRefund(line.lineGross, entries as any);
		if (!plan) return inc("refund.item.unplannable");
		for (const part of plan) {
			const amt = -part.amount;
			const payload: any = {
				id: uuid(),
				reversesPaymentId: part.reversesPaymentId,
				amount: amt,
				reason: "customer changed mind",
				businessDate: businessDate(simNow(), TZ, 240),
			};
			if (part.method === "cash") {
				if (!this.cash?.open) return inc("refund.item.noDrawer");
				payload.cashSessionId = this.cash.id;
				this.cash.expected -= amt;
			}
			this.enqueue("order.refund", o.id, payload, mgr.id);
			o.pays.push({
				id: payload.id,
				amount: -amt,
				method: part.method,
				sessionId: payload.cashSessionId ?? null,
				day: payload.businessDate,
				ok: null,
				reverses: part.reversesPaymentId,
			});
		}
		this.enqueue(
			"order.voidLine",
			o.id,
			{ orderId: o.id, lineId: line.id, reason: "customer changed mind" },
			mgr.id,
		);
		inc("refund.item");
		await this.flush();
	}

	// ---------------------------------------------------------------- kitchen
	kitchenTick() {
		const now = simNow();
		for (const o of this.orders.values()) {
			if (!["paid", "partially_refunded"].includes(o.paymentStatus)) continue;
			if (!["pending", "preparing", "ready"].includes(o.fulfillmentStatus))
				continue;
			const key = `${o.id}:${o.fulfillmentStatus}`;
			if (this.scheduled.has(key)) continue;
			this.scheduled.add(key);
			const age = now - Date.parse(o.placedAt);
			let to: string;
			let delay: number;
			if (o.fulfillmentStatus === "pending" && age > 25 * MIN) {
				to = "completed"; // already cooked from the paper ticket while the till was offline
				delay = rnd(0.2, 1) * MIN;
				inc("kitchen.staleTicketsCleared");
			} else if (o.fulfillmentStatus === "pending") {
				to = "preparing";
				delay = rnd(0.5, 2) * MIN;
			} else if (o.fulfillmentStatus === "preparing") {
				to = "ready";
				delay = (rnd(4, 12) + o.lines.length * 0.8) * MIN;
			} else {
				to = "completed";
				delay = rnd(1, 6) * MIN;
			}
			void sleepSim(delay).then(() => this.bump(o.id, to));
		}
	}
	async bump(orderId: string, to: string) {
		if (stopping) return;
		const o = this.orders.get(orderId);
		if (!o) return;
		if (
			o.fulfillmentStatus === "cancelled" ||
			o.fulfillmentStatus === "completed"
		)
			return;
		if (to === "preparing" && o.fulfillmentStatus !== "pending") return;
		if (to === "ready" && o.fulfillmentStatus !== "preparing") return;
		if (
			to === "completed" &&
			!["ready", "pending", "preparing"].includes(o.fulfillmentStatus)
		)
			return;
		const base = this.queuedFor(orderId) ? undefined : o.version;
		this.enqueue(
			"order.setFulfillment",
			orderId,
			{ orderId, to },
			this.member.id,
			base,
		);
		// Optimistic local move, like moveTicket().
		this.orders.set(orderId, { ...o, fulfillmentStatus: to });
		inc(`kitchen.bump.${to}`);
		await this.flush();
		this.kitchenTick();
	}
}

const paidPushStart = new Map<string, number>();
function noteUp(T: number) {
	for (const n of [1000, 5000, 10000, 20000, 50000])
		if (n >= T && Math.random() < 0.75) return n;
	return Math.ceil(T / 1000) * 1000;
}

// ------------------------------------------------------------------ build the world
const tablets: Tablet[] = [];
const byLoc = new Map<
	string,
	{ org: any; loc: any; tills: Tablet[]; kds: Tablet }
>();
for (const org of seed.orgs) {
	for (const loc of org.locations) {
		const tabs = loc.devices.map((d: any) => new Tablet(org, loc, d));
		tablets.push(...tabs);
		byLoc.set(loc.id, {
			org,
			loc,
			tills: tabs.filter((t: Tablet) => !t.isKds),
			kds: tabs.find((t: Tablet) => t.isKds),
		});
	}
}
const orgA = seed.orgs[0];
const orgB = seed.orgs[1];

// ------------------------------------------------------------------ arrivals
/** Relative traffic per local hour. Omani pattern: lunch 12:30-14:30, quiet afternoon, big late dinner. */
const CURVE: Record<"A" | "B", Record<number, number>> = {
	A: {
		7: 3,
		8: 5,
		9: 5,
		10: 3,
		11: 3,
		12: 7,
		13: 9,
		14: 5,
		15: 3,
		16: 4,
		17: 5,
		18: 6,
		19: 8,
		20: 11,
		21: 12,
		22: 8,
		23: 4,
	},
	B: {
		11: 1,
		12: 8,
		13: 10,
		14: 6,
		15: 2,
		16: 2,
		17: 3,
		18: 5,
		19: 9,
		20: 13,
		21: 14,
		22: 9,
		23: 5,
		24: 3,
	},
};
const PARTY: Record<"A" | "B", [number, number][]> = {
	A: [
		[1, 45],
		[2, 35],
		[3, 12],
		[4, 8],
	],
	B: [
		[1, 15],
		[2, 30],
		[3, 15],
		[4, 20],
		[5, 10],
		[6, 10],
	],
};
const CUSTOMERS = { A: 500, B: 1500 };
function partySize(k: "A" | "B") {
	const tot = PARTY[k].reduce((s, [, w]) => s + w, 0);
	let r = Math.random() * tot;
	for (const [n, w] of PARTY[k]) if ((r -= w) <= 0) return n;
	return 2;
}
type Party = {
	t: number;
	org: "A" | "B";
	locId: string;
	size: number;
	channel: "counter" | "qr" | "group";
	type: string;
};
function planStress(): Party[] {
	// Constant peak-hour arrival rate (21:00 hour) scaled so the REAL rate is C x the real-world peak.
	const out: Party[] = [];
	for (const org of [orgA, orgB]) {
		const k = org.key as "A" | "B";
		const curve = CURVE[k];
		const wsum = Object.values(curve).reduce((a, b) => a + b, 0);
		const avg =
			PARTY[k].reduce((s, [n, w]) => s + n * w, 0) /
			PARTY[k].reduce((s, [, w]) => s + w, 0);
		const peakPerSimHour =
			((CUSTOMERS[k] / avg) * Math.max(...Object.values(curve))) / wsum;
		const perSimMs = (peakPerSimHour * (C / SPEED)) / 3600_000;
		let t = FROM;
		while (true) {
			t += -Math.log(1 - Math.random()) / perSimMs;
			if (t >= TO - 10 * MIN) break;
			const size = partySize(k);
			const lr = Math.random();
			let acc = 0;
			const loc =
				org.locations.find((l: any) => (acc += l.weight) >= lr) ??
				org.locations.at(-1);
			const qr = k === "A" ? 0.28 : 0.2;
			const ch =
				size >= 3 && Math.random() < 0.3
					? "group"
					: Math.random() < qr
						? "qr"
						: "counter";
			out.push({
				t,
				org: k,
				locId: loc.id,
				size,
				channel: ch,
				type: Math.random() < 0.6 ? "dine_in" : "takeaway",
			});
		}
	}
	return out.sort((a, b) => a.t - b.t);
}
function planDay(): Party[] {
	if (MODE === "stress") return planStress();
	const out: Party[] = [];
	for (const org of [orgA, orgB]) {
		const k = org.key as "A" | "B";
		const curve = CURVE[k];
		const wsum = Object.values(curve).reduce((a, b) => a + b, 0);
		let customers = 0;
		while (customers < CUSTOMERS[k]) {
			const size = partySize(k);
			customers += size;
			let r = Math.random() * wsum;
			let hour = 12;
			for (const [h, w] of Object.entries(curve))
				if ((r -= w) <= 0) {
					hour = Number(h);
					break;
				}
			const t =
				at(`${String(hour % 24).padStart(2, "0")}:00`, hour >= 24 ? 1 : 0) +
				Math.random() * 3600_000;
			const lr = Math.random();
			let acc = 0;
			const loc =
				org.locations.find((l: any) => (acc += l.weight) >= lr) ??
				org.locations.at(-1);
			const qr = k === "A" ? 0.28 : 0.2;
			const ch =
				size >= 3 && Math.random() < 0.3
					? "group"
					: Math.random() < qr
						? "qr"
						: "counter";
			out.push({
				t,
				org: k,
				locId: loc.id,
				size,
				channel: ch,
				type: Math.random() < (k === "A" ? 0.55 : 0.7) ? "dine_in" : "takeaway",
			});
		}
	}
	return out.sort((a, b) => a.t - b.t);
}

function tillFor(locId: string) {
	const L = byLoc.get(locId)!;
	return L.tills.reduce((a, b) => (b.queue.length < a.queue.length ? b : a));
}

async function counterParty(p: Party, lines?: any[], source = "counter") {
	const till = tillFor(p.locId);
	till.run(async () => {
		await sleepSim(
			(rnd(40, 140) * 1000) / (MODE === "stress" ? Math.max(1, C / SPEED) : 1),
		); // order + pay at the counter
		const cart = lines ?? randomCart(till.menu, p.org, p.size);
		if (!cart.length) return;
		const id = till.sale(cart, p.type, source);
		if (!id) return;
		const book = books.get(id)!;
		// Some sales come back: whole refund (wrong order / complaint) or one item.
		const r = Math.random();
		if (r < 0.012) {
			void sleepSim(rnd(3, 35) * MIN).then(() =>
				till.run(() => till.refundWhole(book, "wrong order")),
			);
		} else if (r < 0.03 && book.lines.length >= 2) {
			void sleepSim(rnd(1, 9) * MIN).then(() =>
				till.run(() => till.refundItem(book)),
			);
		}
	});
}

async function guestMenu(slug: string) {
	const r = await http(
		"guest.menu",
		"GET",
		`/v1/public/locations/${slug}/menu`,
	);
	return r.status === 200 ? prepareMenu(r.json.menu) : null;
}

async function trackGuest(token: string, ticket: string) {
	for (let i = 0; i < 6 && !stopping; i++) {
		await sleepReal(rnd(6000, 10000));
		const r = await http("guest.track", "GET", `/v1/public/orders/${token}`);
		if (r.status !== 200) continue;
		if (["cancelled", "completed"].includes(r.json.fulfillmentStatus)) return;
	}
}

/** Guest pays at the counter. Today: the till can't charge a QR order (cutover gap #1). */
async function payAtCounter(
	p: Party,
	locId: string,
	view: any,
	lines: any[],
	kind: "qr" | "group",
) {
	await sleepSim(rnd(1, 5) * MIN);
	const L = byLoc.get(locId)!;
	if (QR_FIXED) {
		const till = tillFor(locId);
		till.run(async () => {
			await sleepSim(rnd(20, 60) * 1000);
			await till.pull();
			const o =
				[...till.orders.values()].find(
					(x) =>
						x.ticketNumber === view.ticketNumber &&
						x.businessDate === view.businessDate,
				) ??
				[...till.orders.values()].find(
					(x) =>
						x.ticketNumber === view.ticketNumber &&
						x.paymentStatus === "unpaid" &&
						x.fulfillmentStatus === "pending",
				);
			if (!o) return inc(`${kind}.tillCouldNotFind`);
			if (o.fulfillmentStatus === "cancelled")
				return inc(`${kind}.expiredBeforePay`);
			const method = Math.random() < 0.65 ? "card" : "cash";
			const pay: any = {
				id: uuid(),
				orderId: o.id,
				amount: o.total,
				tip: 0,
				method,
				businessDate: o.businessDate,
			};
			if (method === "cash" && till.cash?.open) {
				pay.cashSessionId = till.cash.id;
				pay.tendered = noteUp(o.total);
				till.cash.expected += o.total;
			} else pay.method = "card";
			const g = guestOrders.find(
				(x) => x.ticket === view.ticketNumber && x.locId === locId,
			);
			if (g)
				g.pays.push({
					id: pay.id,
					amount: o.total,
					method: pay.method,
					sessionId: pay.cashSessionId ?? null,
					day: o.businessDate,
					ok: null,
				});
			const book: SimOrder = {
				id: o.id,
				org: L.org.key,
				locId,
				day: o.businessDate,
				source: kind,
				ticket: o.ticketNumber,
				tillId: till.dev.id,
				placedAt: Date.parse(o.placedAt),
				totals: {
					subtotal: o.subtotal,
					discountTotal: o.discountTotal,
					taxTotal: o.taxTotal,
					total: o.total,
				},
				lines: o.lines,
				pays: [
					{
						id: pay.id,
						amount: o.total,
						method: pay.method,
						sessionId: pay.cashSessionId ?? null,
						day: o.businessDate,
						ok: null,
					},
				],
				accepted: true,
				cancelled: false,
				voided: new Set(),
				refundedFull: false,
				staleMenu: false,
			};
			books.set(o.id, book);
			till.enqueue("order.addPayment", o.id, pay);
			inc(`${kind}.paidAtTill`);
			await till.flush();
		});
		return;
	}
	if (Math.random() < 0.75) {
		inc(`${kind}.reRungAtCounter`);
		await counterParty(p, lines, `${kind}-rering`);
	} else {
		inc(`${kind}.walkedOut`);
	}
}

async function qrParty(p: Party) {
	const L = byLoc.get(p.locId)!;
	const menu = await guestMenu(L.loc.slug);
	if (!menu) return inc("qr.menuFail");
	await sleepSim(rnd(1, 4) * MIN);
	let cart = randomCart(menu, p.org, p.size);
	for (let attempt = 0; attempt < 2; attempt++) {
		const key = uuid();
		const body = {
			locationSlug: L.loc.slug,
			type: p.type,
			customerName: pick([
				"Ahmed",
				"Fatma",
				"Salim",
				"Maryam",
				"Khalid",
				"Aisha",
				"Said",
				"Noor",
			]),
			lines: cart.map((l) => ({
				id: uuid(),
				productId: l.productId,
				quantity: l.quantity,
				modifierOptionIds: l.modifierOptionIds,
			})),
		};
		const post = () =>
			http("guest.order", "POST", `/v1/public/locations/${L.loc.slug}/orders`, {
				headers: { "idempotency-key": key },
				body,
			});
		let r: Awaited<ReturnType<typeof post>>;
		if (Math.random() < 0.1) {
			const [a, b] = await Promise.all([post(), post()]);
			inc("qr.doubleTap");
			if (
				a.status < 300 &&
				b.status < 300 &&
				a.json.order.ticketNumber !== b.json.order.ticketNumber
			)
				leaks.push(
					`double-tap made two orders ${a.json.order.ticketNumber}/${b.json.order.ticketNumber}`,
				);
			if (b.status === 409 || a.status === 409) inc("qr.doubleTap409");
			r = a.status < 300 ? a : b;
		} else r = await post();
		if (r.status === 201 || r.status === 200) {
			const v = r.json.order;
			inc("qr.placed");
			guestOrders.push({
				kind: "qr",
				locId: p.locId,
				org: p.org,
				ticket: v.ticketNumber,
				total: v.total,
				token: v.trackingToken,
				pays: [],
			});
			void trackGuest(v.trackingToken, v.ticketNumber);
			await payAtCounter(
				p,
				p.locId,
				{ ...v, businessDate: businessDate(simNow(), TZ, 240) },
				cart,
				"qr",
			);
			return;
		}
		const reason = r.json?.error?.details?.reason ?? r.status;
		inc(`qr.rejected.${reason}`);
		if (reason === "items_unavailable") {
			const bad = new Set(r.json.error.details.lineIds ?? []);
			cart = cart.filter((_, i) => !bad.has(body.lines[i]?.id));
			if (!cart.length) return;
			continue;
		}
		return;
	}
}

async function groupParty(p: Party) {
	const L = byLoc.get(p.locId)!;
	const slug = L.loc.slug;
	const menu = await guestMenu(slug);
	if (!menu) return;
	const host = await http(
		"cart.create",
		"POST",
		`/v1/public/locations/${slug}/group-carts`,
		{ body: { displayName: "Host" } },
	);
	if (host.status !== 201) return inc(`group.createFail.${host.status}`);
	const token = host.json.cart.token;
	const people = [{ secret: host.json.secret, host: true }];
	const n = Math.min(5, p.size - 1);
	await Promise.all(
		Array.from({ length: n }, async (_, i) => {
			await sleepSim(rnd(0.3, 3) * MIN);
			const j = await http(
				"cart.join",
				"POST",
				`/v1/public/group-carts/${token}/participants`,
				{ body: { displayName: `Guest ${i + 1}` } },
			);
			if (j.status === 201) people.push({ secret: j.json.secret, host: false });
		}),
	);
	// Everyone adds 1-2 items at roughly the same time (the realistic contention case).
	await Promise.all(
		people.map(async (person) => {
			const mine = randomCart(menu, p.org, 1).slice(0, 2);
			for (const it of mine) {
				await sleepSim(rnd(0.2, 1.5) * MIN);
				let ver = (
					await http("cart.get", "GET", `/v1/public/group-carts/${token}`)
				).json?.version;
				for (let k = 0; k < 6; k++) {
					const r = await http(
						"cart.putItem",
						"PUT",
						`/v1/public/group-carts/${token}/items/${uuid()}`,
						{
							headers: {
								"x-participant-secret": person.secret,
								"if-match": String(ver),
							},
							body: {
								productId: it.productId,
								quantity: it.quantity,
								modifierOptionIds: it.modifierOptionIds,
							},
						},
					);
					if (r.status === 200) break;
					if (r.status === 409) {
						inc("group.ifMatchConflict");
						ver = r.json?.error?.details?.cart?.version;
						continue;
					}
					inc(`group.putFail.${r.status}`);
					break;
				}
			}
		}),
	);
	await sleepSim(rnd(0.5, 2) * MIN);
	const hostH = { "x-participant-secret": host.json.secret };
	const cur = await http("cart.get", "GET", `/v1/public/group-carts/${token}`);
	const lock = await http(
		"cart.lock",
		"POST",
		`/v1/public/group-carts/${token}/lock`,
		{ headers: { ...hostH, "if-match": String(cur.json?.version) } },
	);
	if (lock.status !== 200) return inc(`group.lockFail.${lock.status}`);
	const sub = await http(
		"cart.submit",
		"POST",
		`/v1/public/group-carts/${token}/submit`,
		{
			headers: { ...hostH, "idempotency-key": uuid() },
			body: { type: p.type, customerName: "Table group" },
		},
	);
	if (sub.status !== 201)
		return inc(
			`group.submitFail.${sub.json?.error?.details?.reason ?? sub.status}`,
		);
	const v = sub.json.order;
	inc("group.placed");
	guestOrders.push({
		kind: "group",
		locId: p.locId,
		org: p.org,
		ticket: v.ticketNumber,
		total: v.total,
		token: v.trackingToken,
		pays: [],
	});
	const items =
		(await http("cart.get", "GET", `/v1/public/group-carts/${token}`)).json
			?.items ?? [];
	const lines = items.map((i: any) => ({
		productId: i.productId,
		quantity: i.quantity,
		modifierOptionIds: i.modifierOptionIds,
		note: null,
	}));
	void trackGuest(v.trackingToken, v.ticketNumber);
	await payAtCounter(
		p,
		p.locId,
		{ ...v, businessDate: businessDate(simNow(), TZ, 240) },
		lines,
		"group",
	);
}

// ------------------------------------------------------------------ back office
const admin: Record<string, string> = {};
async function adminLogin(org: any) {
	const r = await fetch(`${BASE}/v1/auth/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: ADMIN_ORIGIN },
		body: JSON.stringify({
			email: org.owner.email,
			password: org.owner.password,
		}),
	});
	const cookies = r.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
	if (r.status !== 200 || !cookies)
		throw new Error(`admin login ${org.key} ${r.status}`);
	admin[org.key] = cookies;
}
const ah = (k: string, orgId: string) => ({
	cookie: admin[k] as string,
	origin: ADMIN_ORIGIN,
	"x-org-id": orgId,
});
async function adminReports(day: string) {
	for (const org of seed.orgs) {
		for (const loc of org.locations) {
			await http(
				"admin.report",
				"GET",
				`/v1/admin/reports/sales?locationId=${loc.id}&from=${day}&to=${day}`,
				{ headers: ah(org.key, org.id) },
			);
			await http(
				"admin.orders",
				"GET",
				`/v1/admin/orders?locationId=${loc.id}&from=${day}&to=${day}&limit=50`,
				{ headers: ah(org.key, org.id) },
			);
		}
	}
}

// ------------------------------------------------------------------ tenant probes
const probeStats: Record<string, Record<string, number>> = {};
const probe = (
	name: string,
	status: string | number,
	leak: boolean,
	detail = "",
) => {
	probeStats[name] ??= {};
	const ps = probeStats[name] as Record<string, number>;
	ps[String(status)] = (ps[String(status)] ?? 0) + 1;
	if (leak) leaks.push(`${name}: ${status} ${detail}`);
};
async function probeLoop() {
	const aTill = tablets.find((t) => t.org.key === "A" && !t.isKds)!;
	const bKhu = byLoc.get(orgB.locations[0].id)!;
	const bSeebId = orgB.locations[1].id;
	while (!stopping) {
		await sleepReal(rnd(1500, 3000));
		const bOrders = [...books.values()].filter(
			(o) => o.org === "B" && o.accepted,
		);
		const bOrder = bOrders.length ? pick(bOrders) : null;
		const which = Math.floor(Math.random() * 8);
		try {
			if (which === 0 && bOrder) {
				const r = await http("probe", "GET", `/v1/orders/${bOrder.id}`, {
					headers: aTill.headers,
				});
				probe("A device reads B order", r.status, r.status === 200);
			} else if (which === 1 && bOrder) {
				const pay = {
					id: uuid(),
					orderId: bOrder.id,
					amount: 100,
					tip: 0,
					method: "card",
					businessDate: DAY0,
				};
				const r = await http("probe", "POST", "/v1/sync/push", {
					headers: aTill.headers,
					body: {
						deviceId: aTill.dev.id,
						mutations: [
							{
								id: uuid(),
								kind: "order.addPayment",
								entityId: bOrder.id,
								memberId: aTill.member.id,
								createdAt: new Date().toISOString(),
								payload: pay,
							},
						],
					},
				});
				const st = r.json?.results?.[0]?.status ?? r.status;
				probe("A till pays B order", st, st === "applied");
			} else if (which === 2 && bOrder) {
				const r = await http("probe", "POST", "/v1/sync/push", {
					headers: aTill.headers,
					body: {
						deviceId: aTill.dev.id,
						mutations: [
							{
								id: uuid(),
								kind: "order.setFulfillment",
								entityId: bOrder.id,
								memberId: aTill.member.id,
								createdAt: new Date().toISOString(),
								payload: { orderId: bOrder.id, to: "cancelled", reason: "x" },
							},
						],
					},
				});
				const st = r.json?.results?.[0]?.status ?? r.status;
				probe("A till cancels B order", st, st === "applied");
			} else if (which === 3) {
				const seebOrders = [...books.values()].filter(
					(o) => o.locId === bSeebId && o.accepted,
				);
				if (!seebOrders.length) continue;
				const o = pick(seebOrders);
				const r = await http("probe", "GET", `/v1/orders/${o.id}`, {
					headers: bKhu.tills[0]!.headers,
				});
				probe("B Khuwair till reads B Seeb order", r.status, r.status === 200);
			} else if (which === 4) {
				const r = await http(
					"probe",
					"GET",
					`/v1/admin/reports/sales?locationId=${orgB.locations[0].id}&from=${DAY0}&to=${DAY0}`,
					{ headers: ah("A", orgB.id) },
				);
				probe("A owner with x-org-id=B", r.status, r.status === 200);
			} else if (which === 5) {
				const r = await http(
					"probe",
					"GET",
					`/v1/admin/reports/sales?locationId=${orgB.locations[0].id}&from=${DAY0}&to=${DAY0}`,
					{ headers: ah("A", orgA.id) },
				);
				probe("A owner reads B location report", r.status, r.status === 200);
			} else if (which === 6) {
				const prod = orgB.products["Shuwa plate"];
				const r = await http(
					"probe",
					"POST",
					`/v1/public/locations/${orgA.locations[0].slug}/orders`,
					{
						headers: { "idempotency-key": uuid() },
						body: {
							locationSlug: orgA.locations[0].slug,
							type: "takeaway",
							lines: [
								{
									id: uuid(),
									productId: prod,
									quantity: 1,
									modifierOptionIds: [],
								},
							],
						},
					},
				);
				probe("guest orders B product at A", r.status, r.status < 300);
			} else if (which === 7 && bOrder) {
				const p = bOrder.pays.find((x) => x.ok && !x.reverses);
				if (!p) continue;
				const mgr = aTill.loc.staff.find((m: any) => m.role === "manager");
				const r = await http("probe", "POST", "/v1/sync/push", {
					headers: aTill.headers,
					body: {
						deviceId: aTill.dev.id,
						mutations: [
							{
								id: uuid(),
								kind: "order.refund",
								entityId: bOrder.id,
								memberId: mgr.id,
								createdAt: new Date().toISOString(),
								payload: {
									id: uuid(),
									reversesPaymentId: p.id,
									amount: 100,
									reason: "x",
									businessDate: DAY0,
								},
							},
						],
					},
				});
				const st = r.json?.results?.[0]?.status ?? r.status;
				probe("A till refunds B payment", st, st === "applied");
			}
		} catch (e) {
			notes.push(`probe error ${String(e)}`);
		}
	}
}

// ------------------------------------------------------------------ DB + CPU sampler
function cpuTicks(pid: number) {
	try {
		const f = readFileSync(`/proc/${pid}/stat`, "utf8")
			.split(") ")[1]!
			.split(" ");
		return Number(f[11]) + Number(f[12]);
	} catch {
		return 0;
	}
}
function pgPids(): number[] {
	return readdirSync("/proc")
		.filter((d: string) => /^\d+$/.test(d))
		.map(Number)
		.filter((pid: number) => {
			try {
				return readFileSync(`/proc/${pid}/comm`, "utf8").trim() === "postgres";
			} catch {
				return false;
			}
		});
}
async function sampler() {
	let prev: any = null;
	let prevCpu = {
		api: cpuTicks(API_PID),
		pg: pgPids().reduce((s, p) => s + cpuTicks(p), 0),
		t: Date.now(),
	};
	while (!stopping) {
		await sleepReal(2000);
		const [db] =
			await ownerSql`select xact_commit::int8 c, xact_rollback::int8 r, blks_hit::int8 h, blks_read::int8 rd, tup_inserted::int8 ins, tup_updated::int8 upd, tup_returned::int8 ret, tup_fetched::int8 fet, deadlocks::int8 dl from pg_stat_database where datname='bite'`;
		const act =
			await ownerSql`select state, count(*)::int n, max(extract(epoch from now()-xact_start))::float maxx from pg_stat_activity where datname='bite' and usename='bite_api' group by state`;
		const waits =
			await ownerSql`select count(*)::int n from pg_stat_activity where datname='bite' and wait_event_type='Lock'`;
		const cpu = {
			api: cpuTicks(API_PID),
			pg: pgPids().reduce((s, p) => s + cpuTicks(p), 0),
			t: Date.now(),
		};
		const dt = (cpu.t - prevCpu.t) / 1000;
		const s: any = {
			real: Date.now(),
			sim: simNow(),
			apiCpu: ((cpu.api - prevCpu.api) / 100 / dt) * 100,
			pgCpu: ((cpu.pg - prevCpu.pg) / 100 / dt) * 100,
			conns: Object.fromEntries(act.map((a: any) => [a.state ?? "null", a.n])),
			lockWaits: waits[0]?.n ?? 0,
		};
		if (prev) {
			s.tps = (Number(db!.c) - Number(prev.c)) / dt;
			s.rollbacks = Number(db!.r) - Number(prev.r);
			s.blkRead = Number(db!.rd) - Number(prev.rd);
			s.cacheHit =
				(Number(db!.h) - Number(prev.h)) /
				Math.max(
					1,
					Number(db!.h) - Number(prev.h) + Number(db!.rd) - Number(prev.rd),
				);
			s.tupWritten =
				Number(db!.ins) + Number(db!.upd) - Number(prev.ins) - Number(prev.upd);
			s.deadlocks = Number(db!.dl) - Number(prev.dl);
		}
		prev = db;
		prevCpu = cpu;
		dbSamples.push(s);
	}
}

// ------------------------------------------------------------------ expiry worker (pg-boss jobs, virtual clock)
async function expiryLoop() {
	while (!stopping) {
		await sleepReal(1500);
		const now = new Date(simNow());
		inc("worker.expiredGuestOrders", await expireGuestOrders(worker.db, now));
		inc("worker.expiredCarts", await expireGroupCarts(worker.db, now));
	}
}

// ------------------------------------------------------------------ stress: extra tablets that only poll
const lag: number[] = [];
async function lagLoop() {
	while (!stopping) {
		const t = performance.now();
		await sleepReal(200);
		lag.push(performance.now() - t - 200);
	}
}
async function phantom(dev: any) {
	let cursor: string | undefined;
	let mv: string | undefined;
	await sleepReal(rnd(0, POLL_MS));
	while (!stopping) {
		const t0 = Date.now();
		const q = new URLSearchParams();
		if (cursor) q.set("cursor", cursor);
		if (mv) q.set("menuVersion", mv);
		const r = await http(
			cursor ? "phantom.pull" : "phantom.pull.first",
			"GET",
			`/v1/sync/pull?${q}`,
			{ headers: { authorization: `Bearer ${dev.token}` } },
		);
		if (r.status === 200) {
			cursor = r.json.cursor;
			mv = r.json.menuVersion;
		}
		await sleepReal(POLL_MS - (Date.now() - t0));
	}
}

// ------------------------------------------------------------------ main
async function main() {
	console.log(
		`sim ${MODE} ${OUT} speed=${SPEED} ${new Date(FROM).toISOString()} -> ${new Date(TO).toISOString()} qrFixed=${QR_FIXED}`,
	);
	await ownerSql`select pg_stat_statements_reset()`;
	await Promise.all(seed.orgs.map(adminLogin));
	void sampler();
	void expiryLoop();
	await sleepUntilSim(FROM);
	await Promise.all(tablets.map((t) => t.start()));
	// Open drawers.
	for (const t of tablets.filter((x) => !x.isKds)) {
		const id = uuid();
		const float = t.org.key === "A" ? 20000 : 30000;
		t.cash = { id, float, expected: float, open: true };
		t.enqueue("cash.open", id, {
			id,
			businessDate: businessDate(simNow(), TZ, 240),
			openingFloat: float,
		});
		await t.flush();
	}
	console.log("tablets up", tablets.length);
	void probeLoop();
	void lagLoop();
	if (MODE === "stress") {
		const devs = seed.orgs.flatMap((o: any) =>
			o.locations.flatMap((l: any) => l.devices),
		);
		const n = Math.max(0, C * 15 - tablets.length);
		for (let i = 0; i < n; i++) void phantom(devs[i % devs.length]);
		S["stress.C"] = C;
		S["stress.phantoms"] = n;
		console.log("phantom pollers", n);
	}

	const parties = planDay().filter((p) => p.t >= FROM && p.t < TO - 20 * MIN);
	console.log(
		"parties",
		parties.length,
		"A",
		parties.filter((p) => p.org === "A").length,
		"B",
		parties.filter((p) => p.org === "B").length,
	);
	S["plan.parties.A"] = parties.filter((p) => p.org === "A").length;
	S["plan.parties.B"] = parties.filter((p) => p.org === "B").length;
	S["plan.customers.A"] = parties
		.filter((p) => p.org === "A")
		.reduce((s, p) => s + p.size, 0);
	S["plan.customers.B"] = parties
		.filter((p) => p.org === "B")
		.reduce((s, p) => s + p.size, 0);

	// Scripted incidents (day mode only).
	const events: [number, () => Promise<void> | void][] = [];
	if (MODE === "day") {
		const aTill1 = byLoc.get(orgA.locations[0].id)!.tills[0]!;
		const seeb = byLoc.get(orgB.locations[1].id)!;
		const muttrah = byLoc.get(orgB.locations[2].id)!;
		events.push(
			[at("12:50"), () => aTill1.goOffline()],
			[at("13:35"), () => aTill1.goOnline()],
			[
				at("20:15"),
				() => [...seeb.tills, seeb.kds].forEach((t) => t.goOffline()),
			],
			[
				at("20:40"),
				async () => {
					const r = await http(
						"admin.patchProduct",
						"PATCH",
						`/v1/admin/products/${orgB.products["Shuwa plate"]}`,
						{ headers: ah("B", orgB.id), body: { price: 4800 } },
					);
					notes.push(
						`${hhmm(simNow())} B owner raises Shuwa plate 4.500 -> 4.800 (HTTP ${r.status})`,
					);
				},
			],
			[
				at("21:05"),
				async () => {
					await Promise.all([...seeb.tills, seeb.kds].map((t) => t.goOnline()));
				},
			],
			[
				at("21:30"),
				async () => {
					const k = muttrah.kds;
					const chef = k.loc.staff.find((m: any) => m.role === "kitchen");
					const login = await http(
						"device.pinLogin",
						"POST",
						"/v1/device/pin-login",
						{ headers: k.headers, body: { memberId: chef.id, pin: chef.pin } },
					);
					const r = await http(
						"device.86",
						"PUT",
						`/v1/device/products/${orgB.products["Lamb mandi"]}/availability`,
						{
							headers: {
								...k.headers,
								"x-staff-token": login.json?.staffToken,
							},
							body: { isAvailable: false },
						},
					);
					notes.push(
						`${hhmm(simNow())} Muttrah kitchen 86s Lamb mandi (HTTP ${r.status})`,
					);
				},
			],
		);
		for (const t of tablets.filter((x) => !x.isKds)) {
			events.push([
				at("14:10") + rnd(0, 20) * MIN,
				() => {
					if (!t.cash?.open) return;
					t.enqueue("cash.movement", t.cash.id, {
						id: uuid(),
						cashSessionId: t.cash.id,
						kind: "pay_out",
						amount: 2500,
						reason: "ice and bread delivery",
					});
					t.cash.expected -= 2500;
					void t.flush();
				},
			]);
			events.push([
				at("21:40") + rnd(0, 20) * MIN,
				() => {
					if (!t.cash?.open) return;
					const drop = Math.max(
						0,
						Math.floor((t.cash.expected - t.cash.float) / 10000) * 10000 -
							10000,
					);
					if (!drop) return;
					t.enqueue("cash.movement", t.cash.id, {
						id: uuid(),
						cashSessionId: t.cash.id,
						kind: "drop",
						amount: drop,
						reason: "safe drop",
					});
					t.cash.expected -= drop;
					void t.flush();
				},
			]);
		}
		// Shift change + random re-locks.
		for (const t of tablets) {
			events.push([
				at("16:00") + rnd(0, 15) * MIN,
				() => void t.login(t.isKds ? "kitchen" : "cashier"),
			]);
			for (let h = 8; h < 25; h += 1.2)
				events.push([
					at("00:00") + h * 3600_000 + rnd(0, 30) * MIN,
					async () => {
						if (!t.online) return;
						await http("device.staff", "GET", "/v1/device/staff", {
							headers: t.headers,
						});
						await t.login(t.isKds ? "kitchen" : "cashier");
					},
				]);
		}
	}
	for (let t = FROM + 45 * MIN; t < TO; t += 45 * MIN)
		events.push([t, () => adminReports(DAY0)]);
	events.sort((a, b) => a[0] - b[0]);
	const evLoop = (async () => {
		for (const [t, fn] of events) {
			if (t < FROM || t > TO) continue;
			await sleepUntilSim(t);
			await fn();
		}
	})();

	// Arrivals.
	const running: Promise<unknown>[] = [];
	let lastLog = 0;
	for (const p of parties) {
		await sleepUntilSim(p.t);
		running.push(
			(p.channel === "counter"
				? counterParty(p)
				: p.channel === "qr"
					? qrParty(p)
					: groupParty(p)
			).catch((e) => notes.push(`party error ${String(e)}`)),
		);
		if (Date.now() - lastLog > 15000) {
			lastLog = Date.now();
			console.log(
				hhmm(simNow()),
				"reqs",
				recs.length,
				"books",
				books.size,
				"guest",
				guestOrders.length,
				"leaks",
				leaks.length,
			);
		}
	}
	await Promise.all(running);
	await sleepUntilSim(TO - 15 * MIN);
	// Wait for the kitchen to finish, then last-orders.
	for (const t of tablets) if (!t.online) await t.goOnline();
	for (let i = 0; i < 20; i++) {
		await Promise.all(tablets.map((t) => t.flush()));
		await sleepReal(500);
		if (tablets.every((t) => !t.outbox.length && !t.queue.length && !t.busy))
			break;
	}
	await sleepUntilSim(TO);
	await evLoop;

	// Z: close every drawer. Two deliberate miscounts so variance shows.
	let missKey = 0;
	for (const t of tablets.filter((x) => !x.isKds && x.cash?.open)) {
		const c = t.cash!;
		const variance =
			t.org.key === "A" && t.dev.prefix === "B"
				? -500
				: t.org.key === "B" &&
						t.loc.slug === "dukkan-sohar" &&
						t.dev.prefix === "A"
					? 1000
					: 0;
		missKey++;
		t.enqueue("cash.close", c.id, {
			cashSessionId: c.id,
			countedCash: c.expected + variance,
			notes: "end of day",
		});
		await t.flush();
	}
	await sleepReal(3000);
	await Promise.all(tablets.map((t) => t.flush()));
	await adminReports(DAY0);
	stopping = true;
	tablets.forEach((t) => t.stop());
	await sleepReal(500);
	await finish();
}

// ------------------------------------------------------------------ reconcile + results
async function finish() {
	const day = DAY0;
	const recon: any = { orders: {}, reports: [], cash: [] };
	// 1. Every order the tills believe they sold vs the server row.
	const ids = [...books.keys()];
	const rows = ids.length
		? await ownerSql`select id, subtotal::int8, discount_total::int8, tax_total::int8, total::int8, paid_total::int8, payment_status, fulfillment_status, business_date::text, location_id, org_id from orders where id = any(${ids}::uuid[])`
		: [];
	const byId = new Map(rows.map((r: any) => [r.id, r]));
	let mism = 0;
	let missing = 0;
	const mismDetail: any[] = [];
	for (const b of books.values()) {
		const r: any = byId.get(b.id);
		if (b.accepted === false) continue;
		if (!r) {
			missing++;
			continue;
		}
		const voidedLines = b.lines.filter((l) => b.voided.has(l.id));
		const exp = {
			subtotal:
				b.totals.subtotal - voidedLines.reduce((s, l) => s + l.lineTotal, 0),
			tax: b.totals.taxTotal - voidedLines.reduce((s, l) => s + l.lineTax, 0),
			paid: b.pays.filter((p) => p.ok).reduce((s, p) => s + p.amount, 0),
		};
		const got = {
			subtotal: Number(r.subtotal),
			tax: Number(r.tax_total),
			paid: Number(r.paid_total),
		};
		if (
			exp.subtotal !== got.subtotal ||
			exp.tax !== got.tax ||
			exp.paid !== got.paid ||
			r.org_id !== (b.org === "A" ? orgA.id : orgB.id) ||
			r.location_id !== b.locId
		) {
			mism++;
			if (mismDetail.length < 10)
				mismDetail.push({
					ticket: b.ticket,
					exp,
					got,
					status: r.payment_status,
					f: r.fulfillment_status,
				});
		}
		if (r.business_date !== b.day) mism++;
	}
	recon.orders = {
		checked: books.size,
		mismatched: mism,
		missingOnServer: missing,
		mismDetail,
	};

	// 2. Sales report per location vs the server's raw rows vs the sim's own books.
	for (const org of seed.orgs) {
		for (const loc of org.locations) {
			const r = await http(
				"admin.report",
				"GET",
				`/v1/admin/reports/sales?locationId=${loc.id}&from=${day}&to=${day}`,
				{ headers: ah(org.key, org.id) },
			);
			const rep = r.json;
			const [raw] =
				await ownerSql`select count(*)::int n, coalesce(sum(total),0)::int8 total, coalesce(sum(tax_total),0)::int8 tax, coalesce(sum(discount_total),0)::int8 disc from orders where location_id=${loc.id} and business_date=${day} and fulfillment_status <> 'cancelled'`;
			const rawPay =
				await ownerSql`select method, sum(amount)::int8 amt, count(*)::int n from payments where location_id=${loc.id} and business_date=${day} and state='succeeded' group by method`;
			const [unpaidOpen] =
				await ownerSql`select count(*)::int n, coalesce(sum(total - paid_total),0)::int8 owed from orders where location_id=${loc.id} and business_date=${day} and fulfillment_status <> 'cancelled' and paid_total < total`;
			const [refunds] =
				await ownerSql`select coalesce(-sum(amount),0)::int8 amt, count(*)::int n from payments where location_id=${loc.id} and business_date=${day} and state='succeeded' and amount < 0`;
			const [guestCancelled] =
				await ownerSql`select count(*)::int n, coalesce(sum(total),0)::int8 total from orders where location_id=${loc.id} and business_date=${day} and source in ('guest','group') and fulfillment_status='cancelled'`;
			const [otherDay] =
				await ownerSql`select count(*)::int n from orders where location_id=${loc.id} and business_date <> ${day}`;
			// Sim books (counter sales + paid guest orders), excluding cancelled/rejected.
			const mine = [...books.values()].filter(
				(b) =>
					b.locId === loc.id &&
					b.accepted !== false &&
					!b.cancelled &&
					b.day === day,
			);
			const simTotal = mine.reduce(
				(s, b) =>
					s +
					b.totals.total -
					b.lines
						.filter((l) => b.voided.has(l.id))
						.reduce((x, l) => x + l.lineGross, 0),
				0,
			);
			const simPays: Record<string, number> = {};
			for (const b of books.values())
				for (const p of b.pays)
					if (b.locId === loc.id && p.ok && p.day === day)
						simPays[p.method] = (simPays[p.method] ?? 0) + p.amount;
			const repPays = Object.fromEntries(
				(rep?.byMethod ?? []).map((m: any) => [m.method, m.amount]),
			);
			const rawPays = Object.fromEntries(
				rawPay.map((m: any) => [m.method, Number(m.amt)]),
			);
			const takings = Object.values(repPays).reduce(
				(s: number, v: any) => s + v,
				0,
			) as number;
			recon.reports.push({
				org: org.key,
				loc: loc.name,
				report: {
					orderCount: rep?.orderCount,
					total: rep?.total,
					tax: rep?.tax,
					discounts: rep?.discounts,
					net: rep?.net,
					byMethod: repPays,
					tips: rep?.tips,
				},
				raw: {
					orderCount: raw!.n,
					total: Number(raw!.total),
					tax: Number(raw!.tax),
					discounts: Number(raw!.disc),
					byMethod: rawPays,
				},
				sim: { orderCount: mine.length, total: simTotal, byMethod: simPays },
				takings,
				refunds: { amount: Number(refunds!.amt), count: refunds!.n },
				unpaidButCounted: {
					count: unpaidOpen!.n,
					owed: Number(unpaidOpen!.owed),
				},
				guestExpired: {
					count: guestCancelled!.n,
					total: Number(guestCancelled!.total),
				},
				otherBusinessDates: otherDay!.n,
				reportVsRaw:
					rep?.total === Number(raw!.total) &&
					rep?.orderCount === raw!.n &&
					JSON.stringify(repPays) === JSON.stringify(rawPays),
				reportVsSim:
					rep?.total === simTotal &&
					rep?.orderCount === mine.length &&
					Object.keys({ ...simPays, ...repPays }).every(
						(k) => (simPays[k] ?? 0) === (repPays[k] ?? 0),
					),
				salesMinusTakings: (rep?.total ?? 0) - takings,
			});
		}
	}
	// 3. Drawers.
	for (const t of tablets.filter((x) => x.cash)) {
		const [cs] =
			await ownerSql`select status, opening_float::int8 f, expected_cash::int8 e, counted_cash::int8 c from cash_sessions where id=${t.cash!.id}`;
		recon.cash.push({
			till: t.tag(),
			status: cs?.status,
			server: { expected: Number(cs?.e), counted: Number(cs?.c) },
			sim: { expected: t.cash!.expected },
			match: Number(cs?.e) === t.cash!.expected,
		});
	}
	// 4. RLS spot check: as bite_api with org A set, count B's rows.
	const apiSql = postgres("postgres://bite_api:bite_api@localhost:5432/bite", {
		max: 1,
	});
	const [rls] = await apiSql.begin(async (sql: any) => {
		await sql`select set_config('app.org_id', ${orgA.id}, true)`;
		return sql`select (select count(*) from orders where org_id=${orgB.id})::int b_orders, (select count(*) from payments where org_id=${orgB.id})::int b_pays, (select count(*) from orders)::int visible`;
	});
	const [noTenant] = await apiSql`select count(*)::int n from orders`;
	await apiSql.end();
	recon.rls = {
		asOrgA_seesBOrders: rls.b_orders,
		asOrgA_seesBPayments: rls.b_pays,
		visibleToA: rls.visible,
		noTenantSet: noTenant!.n,
	};

	const top =
		await ownerSql`select calls::int8, round(total_exec_time)::int8 total_ms, round(mean_exec_time::numeric,2)::float mean_ms, round(max_exec_time::numeric,1)::float max_ms, rows::int8, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) q from pg_stat_statements where dbid=(select oid from pg_database where datname='bite') order by total_exec_time desc limit 25`;
	const [dbsize] = await ownerSql`select pg_database_size('bite')::int8 bytes`;
	const counts =
		await ownerSql`select (select count(*) from orders)::int orders, (select count(*) from order_lines)::int lines, (select count(*) from payments)::int payments, (select count(*) from sync_mutations)::int sync_mutations`;

	const out = {
		meta: {
			mode: MODE,
			out: OUT,
			speed: SPEED,
			from: FROM,
			to: TO,
			qrFixed: QR_FIXED,
			day: DAY0,
			real0: REAL0,
		},
		stats: S,
		notes,
		leaks,
		problems: problems.slice(0, 300),
		problemCount: problems.length,
		probeStats,
		rtLatency,
		recon,
		lag,
		dbSamples,
		top,
		dbsize: Number(dbsize!.bytes),
		counts: counts[0],
		guest: { placed: guestOrders.length },
		recs,
	};
	writeFileSync(
		new URL(`./out/${OUT}.json`, import.meta.url),
		JSON.stringify(out),
	);
	console.log(
		"done",
		OUT,
		"reqs",
		recs.length,
		"leaks",
		leaks.length,
		"recon",
		JSON.stringify(recon.orders),
		"rls",
		JSON.stringify(recon.rls),
	);
	await ownerSql.end();
	await worker.client.end();
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
