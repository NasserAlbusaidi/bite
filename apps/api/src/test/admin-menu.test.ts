import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, type Harness, ownerUrl, setupHarness } from "./harness.js";

describe.runIf(ownerUrl)("admin menu", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await setupHarness();
	});
	afterAll(() => h?.close());

	const call = (
		who: "owner" | "manager",
		method: string,
		path: string,
		body?: unknown,
	) =>
		h.app.request(`/v1/admin${path}`, {
			method,
			headers: { ...h.logins.A[who], "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	const ok = async <T>(res: Response | Promise<Response>, status = 200) => {
		const r = await res;
		if (r.status !== status) {
			throw new Error(`${r.status}: ${await r.text()}`);
		}
		return (r.status === 204 ? undefined : await r.json()) as T;
	};

	it("owner builds a menu: category, modifier group, product", async () => {
		const cat = await ok<{ id: string; sortOrder: number }>(
			call("owner", "POST", "/categories", {
				name: { en: "Coffee", ar: "قهوة" },
			}),
			201,
		);
		const group = await ok<{ id: string }>(
			call("owner", "POST", "/modifier-groups", {
				name: { en: "Milk" },
				minSelect: 0,
				maxSelect: 1,
			}),
			201,
		);
		const withOpt = await ok<{ options: { priceDelta: number }[] }>(
			call("owner", "POST", `/modifier-groups/${group.id}/options`, {
				name: { en: "Oat" },
				priceDelta: 250,
			}),
			201,
		);
		expect(withOpt.options).toEqual([
			expect.objectContaining({ priceDelta: 250, isAvailable: true }),
		]);
		const prod = await ok<{
			id: string;
			modifierGroupIds: string[];
			taxBps: number | null;
		}>(
			call("owner", "POST", "/products", {
				categoryId: cat.id,
				name: { en: "Flat white" },
				price: 1800,
				modifierGroupIds: [group.id],
			}),
			201,
		);
		expect(prod).toMatchObject({ modifierGroupIds: [group.id], taxBps: null });

		const patched = await ok<{ price: number; description: unknown }>(
			call("owner", "PATCH", `/products/${prod.id}`, {
				price: 1900,
				description: { en: "Double shot" },
			}),
		);
		expect(patched).toMatchObject({
			price: 1900,
			description: { en: "Double shot" },
		});

		// The tablet's menu picks it up.
		const menu = await h.app.request("/v1/device/menu", {
			headers: bearer(h.A),
		});
		expect(await menu.text()).toContain("Flat white");

		await ok(call("owner", "POST", `/products/${prod.id}/archive`));
		const list = await ok<{ items: { id: string }[] }>(
			call("owner", "GET", "/products"),
		);
		expect(list.items.map((p) => p.id)).not.toContain(prod.id);
		const all = await ok<{ items: { id: string }[] }>(
			call("owner", "GET", "/products?archived=true"),
		);
		expect(all.items.map((p) => p.id)).toContain(prod.id);
	});

	it("reorders all-or-nothing", async () => {
		await ok(
			call("owner", "PATCH", "/products/order", [
				{ id: h.A.prod, sortOrder: 7 },
			]),
			204,
		);
		const bad = await call("owner", "PATCH", "/products/order", [
			{ id: h.A.prod, sortOrder: 1 },
			{ id: h.B.prod, sortOrder: 2 },
		]);
		expect(bad.status).toBe(404);
		const [row] = await h.owner<{ sort_order: number }[]>`
			select sort_order from products where id = ${h.A.prod}`;
		expect(row?.sort_order).toBe(7);
	});

	it("422 for a category that isn't there", async () => {
		const res = await call("owner", "POST", "/products", {
			categoryId: "0190f000-0000-7000-8000-000000000000",
			name: { en: "Ghost" },
			price: 1,
		});
		expect(res.status).toBe(422);
	});

	it("managers read the menu but can't change it", async () => {
		await ok(call("manager", "GET", "/products"));
		const res = await call("manager", "PATCH", `/products/${h.A.prod}`, {
			price: 1,
		});
		expect(res.status).toBe(403);
	});

	it("managers set price and availability for their own location only", async () => {
		const item = await ok<{ effectivePrice: number; isAvailable: boolean }>(
			call("manager", "PUT", `/locations/${h.A.loc}/products/${h.A.prod}`, {
				price: 1200,
				isAvailable: false,
			}),
		);
		expect(item).toMatchObject({ effectivePrice: 1200, isAvailable: false });
		const list = await ok<{
			items: { productId: string; overridePrice: number | null }[];
		}>(call("manager", "GET", `/locations/${h.A.loc}/products`));
		expect(list.items.find((p) => p.productId === h.A.prod)).toMatchObject({
			overridePrice: 1200,
		});
		const other = await call(
			"manager",
			"PUT",
			`/locations/${h.A.otherLoc}/products/${h.A.prod}`,
			{ price: 1, isAvailable: true },
		);
		expect(other.status).toBe(404);
		// Back to the base price.
		await ok(
			call("manager", "PUT", `/locations/${h.A.loc}/products/${h.A.prod}`, {
				price: null,
				isAvailable: true,
			}),
		);
	});

	it("promotions: managers only for their locations, owners anywhere", async () => {
		const mine = await ok<{ id: string; dailyStart: string | null }>(
			call("manager", "POST", "/promotions", {
				name: "Happy hour",
				kind: "percent",
				value: 2000,
				locationId: h.A.loc,
				dailyStart: "16:00",
				dailyEnd: "18:00",
				daysOfWeek: [0, 1, 2, 3, 4],
			}),
			201,
		);
		expect(mine.dailyStart).toBe("16:00");
		expect(
			(
				await call("manager", "POST", "/promotions", {
					name: "Org-wide",
					kind: "fixed",
					value: 100,
				})
			).status,
		).toBe(403);
		expect(
			(
				await call("manager", "POST", "/promotions", {
					name: "Elsewhere",
					kind: "fixed",
					value: 100,
					locationId: h.A.otherLoc,
				})
			).status,
		).toBe(404);
		// Can't move their promotion org-wide either.
		expect(
			(
				await call("manager", "PATCH", `/promotions/${mine.id}`, {
					locationId: null,
				})
			).status,
		).toBe(403);
		await ok(
			call("owner", "PATCH", `/promotions/${mine.id}`, { isActive: false }),
		);
		const bad = await call("owner", "POST", "/promotions", {
			name: "Too much",
			kind: "percent",
			value: 10_001,
		});
		expect(bad.status).toBe(400);
	});
});
