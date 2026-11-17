import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	bearer,
	type Harness,
	json,
	ownerUrl,
	PIN,
	setupHarness,
	staffLogin,
} from "./harness.js";

describe.runIf(ownerUrl)("device + PIN auth", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	it("answers health without auth", async () => {
		const res = await h.app.request("/health");
		expect(res.status).toBe(200);
	});

	it("rejects missing and wrong device tokens with the error envelope", async () => {
		const none = await h.app.request("/v1/device/me");
		expect(none.status).toBe(401);
		expect(await none.json()).toMatchObject({
			error: { code: "unauthenticated" },
		});
		const wrong = await h.app.request("/v1/device/me", {
			headers: { authorization: "Bearer dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
		});
		expect(wrong.status).toBe(401);
	});

	it("identifies the device", async () => {
		const res = await h.app.request("/v1/device/me", { headers: bearer(h.A) });
		expect(await res.json()).toMatchObject({
			deviceId: h.A.device,
			orgId: h.A.org,
			locationId: h.A.loc,
			ticketPrefix: "A",
		});
	});

	it("lists only active staff at the device's location", async () => {
		const res = await h.app.request("/v1/device/staff", {
			headers: bearer(h.A),
		});
		const { staff } = (await res.json()) as { staff: { memberId: string }[] };
		expect(staff.map((s) => s.memberId).sort()).toEqual(
			[h.A.cashier, h.A.kitchen, h.A.manager].sort(),
		);
	});

	it("logs in with the right PIN and returns a staff token", async () => {
		const res = await h.app.request(
			"/v1/device/pin-login",
			json({ memberId: h.A.cashier, pin: PIN }, bearer(h.A)),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			member: { memberId: h.A.cashier, role: "cashier" },
		});
	});

	it("refuses inactive staff and staff from another location", async () => {
		for (const memberId of [h.A.inactive, h.A.otherLocStaff]) {
			const res = await h.app.request(
				"/v1/device/pin-login",
				json({ memberId, pin: PIN }, bearer(h.A)),
			);
			expect(res.status).toBe(401);
		}
	});

	it("rejects malformed PIN bodies with bad_request", async () => {
		const res = await h.app.request(
			"/v1/device/pin-login",
			json({ memberId: h.A.cashier, pin: "12" }, bearer(h.A)),
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: "bad_request" } });
	});

	it("locks a member out after 5 wrong PINs on a device", async () => {
		for (let i = 0; i < 5; i++) {
			const res = await h.app.request(
				"/v1/device/pin-login",
				json({ memberId: h.A.kitchen, pin: "0000" }, bearer(h.A)),
			);
			expect(res.status).toBe(401);
		}
		const locked = await h.app.request(
			"/v1/device/pin-login",
			json({ memberId: h.A.kitchen, pin: PIN }, bearer(h.A)),
		);
		expect(locked.status).toBe(429);
	});

	it("returns the logged-in staff member and re-checks them each request", async () => {
		const headers = await staffLogin(h, h.A, h.A.cashier);
		const ok = await h.app.request("/v1/device/session", { headers });
		expect(await ok.json()).toMatchObject({
			member: { memberId: h.A.cashier, role: "cashier" },
		});
		await h.owner`update members set is_active = false where id = ${h.A.cashier}`;
		const gone = await h.app.request("/v1/device/session", { headers });
		expect(gone.status).toBe(401);
		await h.owner`update members set is_active = true where id = ${h.A.cashier}`;
	});

	it("rejects tampered and expired staff tokens", async () => {
		const headers = await staffLogin(h, h.A, h.A.cashier);
		const t = headers["x-staff-token"];
		const tampered = `${t.slice(0, -2)}xx`;
		const r1 = await h.app.request("/v1/device/session", {
			headers: { ...headers, "x-staff-token": tampered },
		});
		expect(r1.status).toBe(401);
		h.deps.now = () => new Date(Date.now() + 13 * 3600_000);
		const r2 = await h.app.request("/v1/device/session", { headers });
		delete h.deps.now;
		expect(r2.status).toBe(401);
	});

	it("stops accepting a revoked device immediately", async () => {
		const headers = await staffLogin(h, h.B, h.B.cashier);
		await h.owner`update devices set revoked_at = now() where id = ${h.B.device}`;
		const res = await h.app.request("/v1/device/me", { headers });
		expect(res.status).toBe(401);
		await h.owner`update devices set revoked_at = null where id = ${h.B.device}`;
	});

	it("rejects devices of a suspended org", async () => {
		await h.owner`update orgs set status = 'suspended' where id = ${h.B.org}`;
		const res = await h.app.request("/v1/device/me", { headers: bearer(h.B) });
		expect(res.status).toBe(401);
		await h.owner`update orgs set status = 'active' where id = ${h.B.org}`;
	});
});
