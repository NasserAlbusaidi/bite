import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { PinLimiter } from "../lib/pin-limiter.js";
import {
	bearer,
	type Harness,
	json,
	ownerUrl,
	PIN,
	setupHarness,
	staffLogin,
} from "./harness.js";

/**
 * CLAUDE.md: every tenant-scoped endpoint gets a cross-tenant test.
 * Each entry acts as tenant B and aims at tenant A's ids; it must see nothing
 * of A. The meta test below fails when a route is added without an entry.
 */
type Case = (h: Harness) => Promise<void>;

const PUBLIC_ROUTES = new Set(["GET /health"]);

const cases: Record<string, Case> = {
	"GET /v1/device/me": async (h) => {
		const res = await h.app.request("/v1/device/me", { headers: bearer(h.B) });
		const body = (await res.json()) as { orgId: string };
		expect(body.orgId).toBe(h.B.org);
	},
	"GET /v1/device/staff": async (h) => {
		const res = await h.app.request("/v1/device/staff", {
			headers: bearer(h.B),
		});
		const text = await res.text();
		for (const id of [h.A.cashier, h.A.kitchen, h.A.org]) {
			expect(text).not.toContain(id);
		}
	},
	"GET /v1/device/session": async (h) => {
		// A's staff token presented with B's device token.
		const a = await staffLogin(h, h.A, h.A.cashier);
		const res = await h.app.request("/v1/device/session", {
			headers: { ...bearer(h.B), "x-staff-token": a["x-staff-token"] },
		});
		expect(res.status).toBe(401);
	},
	"POST /v1/device/pin-login": async (h) => {
		// A's cashier, right PIN, on B's device: must not log in.
		const res = await h.app.request(
			"/v1/device/pin-login",
			json({ memberId: h.A.cashier, pin: PIN }, bearer(h.B)),
		);
		expect(res.status).toBe(401);
	},
};

describe("cross-tenant coverage", () => {
	it("has a cross-tenant case for every route", () => {
		const app = createApp({
			db: {} as never,
			staffTokenSecret: "x".repeat(32),
			pinLimiter: new PinLimiter(),
		});
		const routes = new Set(
			app.routes
				.filter((r) => r.method !== "ALL")
				.map((r) => `${r.method} ${r.path}`),
		);
		const missing = [...routes].filter(
			(r) => !PUBLIC_ROUTES.has(r) && !(r in cases),
		);
		expect(missing).toEqual([]);
	});
});

describe.runIf(ownerUrl)("cross-tenant isolation", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	for (const [route, run] of Object.entries(cases)) {
		it(route, () => run(h));
	}
});
