import { describe, expect, it } from "vitest";
import { GuestApiError, httpApi } from "./api.server";
import { demoMenu, fixtureApi } from "./fixtures.server";
import { uuidv7 } from "./uuid";

const { menu, location } = demoMenu();
const croissant = menu.products.find((p) => p.name.en === "Butter croissant")!;
const rye = menu.products.find((p) => !p.isAvailable)!;

const order = (productId: string) => ({
	locationSlug: location.slug,
	type: "dine_in" as const,
	customerName: "Layla",
	lines: [{ id: uuidv7(), productId, quantity: 2, modifierOptionIds: [] }],
});

describe("fixture api", () => {
	it("places an order once per idempotency key", async () => {
		const api = fixtureApi();
		const req = order(croissant.id);
		const key = uuidv7();
		const a = await api.placeOrder(req, key);
		const b = await api.placeOrder(req, key);
		expect(b.trackingToken).toBe(a.trackingToken);
		expect(a.total).toBe(1920); // 2 x 1.200 less the 20% pastry promotion
		expect(a.discountTotal).toBe(480);
		await expect(
			api.placeOrder({ ...req, customerName: "Sara" }, key),
		).rejects.toMatchObject({
			code: "idempotency_mismatch",
		});
		expect(await api.getOrder(a.trackingToken)).toEqual(a);
	});

	it("rejects sold-out lines by id", async () => {
		const req = order(rye.id);
		await expect(fixtureApi().placeOrder(req, uuidv7())).rejects.toMatchObject({
			code: "unprocessable",
			rejection: { reason: "items_unavailable", lineIds: [req.lines[0]!.id] },
		});
	});
});

describe("http api", () => {
	const fake =
		(status: number, body: unknown, seen: Request[] = []): typeof fetch =>
		async (input, init) => {
			seen.push(new Request(input, init));
			return new Response(JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			});
		};

	it("parses the menu and returns null on 404", async () => {
		expect(
			await httpApi("http://api", fake(200, demoMenu())).getMenu("demo-bakery"),
		).toEqual(demoMenu());
		expect(
			await httpApi("http://api", fake(404, {})).getMenu("nope"),
		).toBeNull();
	});

	it("rejects a menu with float money", async () => {
		const bad = demoMenu();
		bad.menu.products[0]!.price = 1.25;
		await expect(
			httpApi("http://api", fake(200, bad)).getMenu("demo-bakery"),
		).rejects.toThrow();
	});

	it("sends the idempotency key and surfaces typed rejections", async () => {
		const seen: Request[] = [];
		const api = httpApi(
			"http://api",
			fake(
				422,
				{
					error: {
						code: "unprocessable",
						message: "x",
						details: { reason: "not_accepting_orders" },
					},
				},
				seen,
			),
		);
		const err = await api
			.placeOrder(order(croissant.id), "k-1")
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GuestApiError);
		expect((err as GuestApiError).rejection?.reason).toBe(
			"not_accepting_orders",
		);
		expect(seen[0]!.url).toBe(
			"http://api/v1/public/locations/demo-bakery/orders",
		);
		expect(seen[0]!.headers.get("idempotency-key")).toBe("k-1");
	});
});
