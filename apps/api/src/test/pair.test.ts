import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, json, ownerUrl, setupHarness } from "./harness.js";

type Registered = {
	deviceId: string;
	token: string;
	ticketPrefix: string;
	pairingCode: string;
	pairingExpiresAt: string;
};

describe.runIf(ownerUrl)("connecting a tablet with a connect code", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	const admin = (method: string, path: string, body?: unknown) =>
		h.app.request(`/v1/admin${path}`, {
			method,
			headers: { ...h.logins.A.owner, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	const register = async (name: string, kind = "pos") => {
		const res = await admin("POST", "/devices", {
			locationId: h.A.loc,
			name,
			kind,
		});
		expect(res.status).toBe(201);
		return (await res.json()) as Registered;
	};
	const pair = (code: string, ip = "203.0.113.1") =>
		h.app.request(
			"/v1/pair",
			json({ code }, { "x-forwarded-for": `10.0.0.9, ${ip}` }),
		);
	const me = (token: string) =>
		h.app.request("/v1/device/me", {
			headers: { authorization: `Bearer ${token}` },
		});
	const listed = async (id: string) => {
		const res = await admin("GET", `/locations/${h.A.loc}/devices`);
		const { items } = (await res.json()) as {
			items: {
				id: string;
				name: string;
				pairingExpiresAt: string | null;
				lastSeenAt: string | null;
			}[];
		};
		return items.find((d) => d.id === id);
	};

	it("picks a free ticket prefix and hands out a code", async () => {
		const r = await register("Front till");
		// The harness tablet already has "A".
		expect(r.ticketPrefix).toBe("B");
		expect(r.pairingCode).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
		expect((await listed(r.deviceId))?.pairingExpiresAt).toBe(
			r.pairingExpiresAt,
		);
	});

	it("trades the code, typed loosely, for a working token, once", async () => {
		const r = await register("Kitchen", "kds");
		const typed = `${r.pairingCode.slice(0, 4).toLowerCase()}-${r.pairingCode.slice(4)}`;
		const res = await pair(typed);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			token: string;
			device: { deviceId: string; kind: string; name: string };
		};
		expect(body.device).toMatchObject({
			deviceId: r.deviceId,
			kind: "kds",
			name: "Kitchen",
		});
		expect((await me(body.token)).status).toBe(200);
		// The registration token is replaced, and the code is spent.
		expect((await me(r.token)).status).toBe(401);
		expect((await pair(r.pairingCode)).status).toBe(404);
		const row = await listed(r.deviceId);
		expect(row?.pairingExpiresAt).toBeNull();
		expect(row?.lastSeenAt).toBeTruthy();
	});

	it("refuses expired codes and removed devices", async () => {
		const old = await register("Old");
		await h.owner.unsafe(
			"update devices set pairing_expires_at = now() - interval '1 minute' where id = $1",
			[old.deviceId],
		);
		expect((await pair(old.pairingCode, "203.0.113.2")).status).toBe(404);
		expect((await listed(old.deviceId))?.pairingExpiresAt).toBeNull();

		const gone = await register("Gone");
		await admin("POST", `/devices/${gone.deviceId}/revoke`);
		expect((await pair(gone.pairingCode, "203.0.113.2")).status).toBe(404);
		const again = await admin("POST", `/devices/${gone.deviceId}/connect-code`);
		expect(again.status).toBe(409);
	});

	it("moves a device to a new tablet: the old one works until the code is used", async () => {
		const r = await register("Bar till");
		const first = (await (await pair(r.pairingCode)).json()) as {
			token: string;
		};
		const res = await admin("POST", `/devices/${r.deviceId}/connect-code`);
		expect(res.status).toBe(200);
		const { pairingCode } = (await res.json()) as { pairingCode: string };
		expect((await me(first.token)).status).toBe(200);
		const second = (await (await pair(pairingCode)).json()) as {
			token: string;
		};
		expect((await me(second.token)).status).toBe(200);
		expect((await me(first.token)).status).toBe(401);
	});

	it("renames a device", async () => {
		const r = await register("Till 3");
		const res = await admin("PATCH", `/devices/${r.deviceId}`, {
			name: "  Window till ",
		});
		expect(res.status).toBe(200);
		expect((await listed(r.deviceId))?.name).toBe("Window till");
	});

	it("slows down guessing from one address", async () => {
		const r = await register("Patio");
		for (let i = 0; i < 10; i++)
			expect((await pair("AAAA-AAAA", "198.51.100.7")).status).toBe(404);
		const locked = await pair(r.pairingCode, "198.51.100.7");
		expect(locked.status).toBe(429);
		// Someone else is not affected.
		expect((await pair(r.pairingCode, "198.51.100.8")).status).toBe(200);
	});
});
