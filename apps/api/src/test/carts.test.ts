import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Harness,
	json,
	ownerUrl,
	setupHarness,
	uuidv7,
} from "./harness.js";

type Cart = {
	token: string;
	status: string;
	version: number;
	participants: { id: string; isHost: boolean }[];
	items: { id: string; participantId: string; quantity: number }[];
	trackingToken: string | null;
};
type Joined = { participantId: string; secret: string; cart: Cart };

describe.runIf(ownerUrl)("group carts", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	const create = async (slug = "a-main") => {
		const res = await h.app.request(
			`/v1/public/locations/${slug}/group-carts`,
			json({ displayName: "Host" }),
		);
		expect(res.status).toBe(201);
		return (await res.json()) as Joined;
	};
	const join = async (token: string, name = "Guest") => {
		const res = await h.app.request(
			`/v1/public/group-carts/${token}/participants`,
			json({ displayName: name }),
		);
		return { res, body: (await res.json()) as Joined };
	};
	const req = (
		method: string,
		path: string,
		secret: string,
		version: number | null,
		body?: unknown,
		extra = {},
	) =>
		h.app.request(`/v1/public/group-carts/${path}`, {
			method,
			headers: {
				"content-type": "application/json",
				"x-participant-secret": secret,
				...(version === null ? {} : { "if-match": String(version) }),
				...extra,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	const putItem = (
		token: string,
		who: Joined,
		version: number,
		itemId = uuidv7(),
		qty = 1,
		productId = h.A.prod,
	) =>
		req("PUT", `${token}/items/${itemId}`, who.secret, version, {
			productId,
			quantity: qty,
		});

	it("runs the whole flow: create, join, add, lock, submit once", async () => {
		const host = await create();
		const token = host.cart.token;
		expect(host.cart.participants).toMatchObject([
			{ id: host.participantId, isHost: true },
		]);
		const { body: guest } = await join(token);

		let v = guest.cart.version;
		const r1 = await putItem(token, host, v, uuidv7(), 2);
		v = ((await r1.json()) as Cart).version;
		const r2 = await putItem(token, guest, v);
		const afterAdd = (await r2.json()) as Cart;
		expect(afterAdd.items).toHaveLength(2);
		expect(afterAdd).not.toHaveProperty("items.0.price");

		const notHost = await req(
			"POST",
			`${token}/lock`,
			guest.secret,
			afterAdd.version,
		);
		expect(notHost.status).toBe(403);
		const locked = (await (
			await req("POST", `${token}/lock`, host.secret, afterAdd.version)
		).json()) as Cart;
		expect(locked.status).toBe("locked");
		expect((await putItem(token, guest, locked.version)).status).toBe(422);

		const key = uuidv7();
		const submit = () =>
			req(
				"POST",
				`${token}/submit`,
				host.secret,
				null,
				{ type: "dine_in" },
				{ "idempotency-key": key },
			);
		const s1 = await submit();
		expect(s1.status).toBe(201);
		const order = (
			(await s1.json()) as {
				order: { ticketNumber: string; total: number; lines: unknown[] };
			}
		).order;
		// Re-priced from the live menu: 3 lattes x 1.500.
		expect(order).toMatchObject({ ticketNumber: "G-1", total: 4500 });
		expect(order.lines).toHaveLength(2);
		const s2 = await submit();
		expect(s2.status).toBe(200);

		const view = (await (
			await h.app.request(`/v1/public/group-carts/${token}`)
		).json()) as Cart;
		expect(view.status).toBe("submitted");
		expect(view.trackingToken).toBeTruthy();
	});

	it("lets guests touch only their own items", async () => {
		const host = await create();
		const { body: guest } = await join(host.cart.token);
		const itemId = uuidv7();
		const r = (await (
			await putItem(host.cart.token, host, guest.cart.version, itemId)
		).json()) as Cart;
		const steal = await req(
			"PUT",
			`${host.cart.token}/items/${itemId}`,
			guest.secret,
			r.version,
			{ productId: h.A.prod, quantity: 5 },
		);
		expect(steal.status).toBe(403);
		const del = await req(
			"DELETE",
			`${host.cart.token}/items/${itemId}`,
			guest.secret,
			r.version,
		);
		expect(del.status).toBe(404);
		const noSecret = await req(
			"PUT",
			`${host.cart.token}/items/${uuidv7()}`,
			"gc_wrong",
			r.version,
			{ productId: h.A.prod, quantity: 1 },
		);
		expect(noSecret.status).toBe(401);
	});

	it("rejects stale versions with the current cart", async () => {
		const host = await create();
		const res = await putItem(host.cart.token, host, host.cart.version - 1);
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({
			error: {
				code: "conflict",
				details: { cart: { version: host.cart.version } },
			},
		});
		expect(
			(await putItem(host.cart.token, host, host.cart.version)).status,
		).toBe(200);
	});

	it("refuses an empty submit and expired carts", async () => {
		const host = await create();
		const locked = (await (
			await req(
				"POST",
				`${host.cart.token}/lock`,
				host.secret,
				host.cart.version,
			)
		).json()) as Cart;
		const empty = await req(
			"POST",
			`${host.cart.token}/submit`,
			host.secret,
			null,
			{ type: "dine_in" },
			{ "idempotency-key": uuidv7() },
		);
		expect(await empty.json()).toMatchObject({
			error: { details: { reason: "cart_empty" } },
		});
		await h.owner`update group_carts set expires_at = now() - interval '1 minute' where token = ${host.cart.token}`;
		const v = (await (
			await h.app.request(`/v1/public/group-carts/${host.cart.token}`)
		).json()) as Cart;
		expect(v.status).toBe("expired");
		expect((await join(host.cart.token)).res.status).toBe(422);
		expect(locked.status).toBe("locked");
	});

	it("streams cart.changed to that cart's listeners", async () => {
		const host = await create();
		const ac = new AbortController();
		const res = await h.app.request(
			`/v1/public/group-carts/${host.cart.token}/events`,
			{ signal: ac.signal },
		);
		const reader = (res.body as ReadableStream<Uint8Array>).getReader();
		const dec = new TextDecoder();
		let text = dec.decode((await reader.read()).value);
		await join(host.cart.token);
		while (!text.includes("cart.changed"))
			text += dec.decode((await reader.read()).value);
		expect(text).toMatch(/"version":3/);
		ac.abort();
		await reader.cancel().catch(() => {});
	});

	it("rejects products from another menu", async () => {
		const host = await create();
		const res = await putItem(
			host.cart.token,
			host,
			host.cart.version,
			uuidv7(),
			1,
			h.B.prod,
		);
		expect(res.status).toBe(422);
	});
});
