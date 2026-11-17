import { describe, expect, it } from "vitest";
import { GuestApiError, httpApi, withFreshVersion } from "./api.server";
import { demoMenu, fixtureApi } from "./fixtures.server";
import { uuidv7 } from "./uuid";

const { menu, location } = demoMenu();
const croissant = menu.products.find((p) => p.name.en === "Butter croissant")!;
const bun = menu.products.find((p) => p.name.en === "Cardamom bun")!;
const item = (productId: string, quantity = 1) => ({
	productId,
	quantity,
	modifierOptionIds: [],
});

async function table() {
	const api = fixtureApi();
	const host = await api.createGroupCart(location.slug, "Layla");
	const guest = await api.joinGroupCart(host.cart.token, "Sara");
	return { api, token: host.cart.token, host, guest };
}

describe("group cart (fixture rules)", () => {
	it("each guest edits only their own items; one order with everyone's items", async () => {
		const { api, token, host, guest } = await table();
		let v = guest.cart.version;
		const hostItem = uuidv7();
		let cart = await api.upsertGroupItem(
			token,
			hostItem,
			item(croissant.id, 2),
			{ secret: host.secret, version: v },
		);
		v = cart.version;
		cart = await api.upsertGroupItem(token, uuidv7(), item(bun.id), {
			secret: guest.secret,
			version: v,
		});

		await expect(
			api.upsertGroupItem(token, hostItem, item(croissant.id, 9), {
				secret: guest.secret,
				version: cart.version,
			}),
		).rejects.toMatchObject({ code: "forbidden" });
		await expect(
			api.lockGroupCart(token, { secret: guest.secret, version: cart.version }),
		).rejects.toMatchObject({
			code: "forbidden",
		});

		cart = await api.lockGroupCart(token, {
			secret: host.secret,
			version: cart.version,
		});
		await expect(
			api.upsertGroupItem(token, uuidv7(), item(bun.id), {
				secret: guest.secret,
				version: cart.version,
			}),
		).rejects.toMatchObject({ rejection: { reason: "cart_not_open" } });

		const key = uuidv7();
		const order = await api.submitGroupCart(
			token,
			{ type: "dine_in" },
			{ secret: host.secret, version: cart.version },
			key,
		);
		// 2 croissants + 1 bun, pastries 20% off: (2 x 0.960) + 1.080
		expect(order.total).toBe(3000);
		expect(order.lines).toHaveLength(2);
		const after = await api.getGroupCart(token);
		expect(after?.status).toBe("submitted");
		expect(after?.trackingToken).toBe(order.trackingToken);
		// A lost response retried with the same key gets the same order.
		const again = await api.submitGroupCart(
			token,
			{ type: "dine_in" },
			{ secret: host.secret, version: 1 },
			key,
		);
		expect(again.trackingToken).toBe(order.trackingToken);
	});

	it("stale versions conflict, and withFreshVersion retries on the current one", async () => {
		const { api, token, host, guest } = await table();
		const stale = { secret: guest.secret, version: guest.cart.version };
		await api.upsertGroupItem(token, uuidv7(), item(bun.id), {
			secret: host.secret,
			version: guest.cart.version,
		});
		const err = await api
			.upsertGroupItem(token, uuidv7(), item(bun.id), stale)
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GuestApiError);
		expect((err as GuestApiError).currentCart?.version).toBe(
			guest.cart.version + 1,
		);
		const cart = await withFreshVersion(stale, (a) =>
			api.upsertGroupItem(token, uuidv7(), item(bun.id), a),
		);
		expect(cart.items).toHaveLength(2);
	});

	it("rejects bad secrets and empty submits", async () => {
		const { api, token, host } = await table();
		const v = (await api.getGroupCart(token))!.version;
		await expect(
			api.lockGroupCart(token, { secret: "nope", version: v }),
		).rejects.toMatchObject({
			code: "unauthenticated",
		});
		const locked = await api.lockGroupCart(token, {
			secret: host.secret,
			version: v,
		});
		await expect(
			api.submitGroupCart(
				token,
				{ type: "dine_in" },
				{ secret: host.secret, version: locked.version },
				uuidv7(),
			),
		).rejects.toMatchObject({ rejection: { reason: "cart_empty" } });
	});
});

describe("group cart (http client)", () => {
	it("sends the participant secret and If-Match, and surfaces the current cart on 409", async () => {
		const seen: Request[] = [];
		const current = {
			token: uuidv7(),
			status: "open",
			version: 7,
			expiresAt: "2026-11-17T15:00:00Z",
			participants: [],
			items: [],
			trackingToken: null,
		};
		const api = httpApi("http://api", async (input, init) => {
			seen.push(new Request(input, init));
			return new Response(
				JSON.stringify({
					error: {
						code: "conflict",
						message: "stale",
						details: { cart: current },
					},
				}),
				{
					status: 409,
				},
			);
		});
		const err = await api
			.upsertGroupItem("tok", "item-1", item(bun.id), {
				secret: "s3cret",
				version: 6,
			})
			.catch((e: unknown) => e);
		expect((err as GuestApiError).currentCart?.version).toBe(7);
		const req = seen[0]!;
		expect(req.method).toBe("PUT");
		expect(req.url).toBe("http://api/v1/public/group-carts/tok/items/item-1");
		expect(req.headers.get("x-participant-secret")).toBe("s3cret");
		expect(req.headers.get("if-match")).toBe("6");
	});
});
