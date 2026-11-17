import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	bearer,
	type Harness,
	ownerUrl,
	setupHarness,
	staffLogin,
	uuidv7,
} from "./harness.js";

type Menu = {
	menuVersion: string;
	products: {
		id: string;
		price: number;
		isAvailable: boolean;
		modifierGroupIds: string[];
	}[];
	modifierGroups: { id: string; options: { id: string }[] }[];
	promotions: { id: string }[];
};

describe.runIf(ownerUrl)("menu", () => {
	let h: Harness;
	const hidden = uuidv7();
	const archived = uuidv7();
	const group = uuidv7();
	const option = uuidv7();
	const promo = uuidv7();
	const expiredPromo = uuidv7();

	beforeAll(async () => {
		h = await setupHarness();
		const { A } = h;
		await h.owner`insert into products (id, org_id, category_id, name, price, is_visible)
			values (${hidden}, ${A.org}, ${A.cat}, '{"en":"Hidden"}', 100, false)`;
		await h.owner`insert into products (id, org_id, category_id, name, price, archived_at)
			values (${archived}, ${A.org}, ${A.cat}, '{"en":"Old"}', 100, now())`;
		await h.owner`insert into modifier_groups (id, org_id, name) values (${group}, ${A.org}, '{"en":"Milk"}')`;
		await h.owner`insert into modifier_options (id, org_id, group_id, name, price_delta)
			values (${option}, ${A.org}, ${group}, '{"en":"Oat"}', 200)`;
		await h.owner`insert into product_modifier_groups (org_id, product_id, group_id)
			values (${A.org}, ${A.prod}, ${group})`;
		await h.owner`insert into product_location_settings (org_id, product_id, location_id, price)
			values (${A.org}, ${A.prod}, ${A.loc}, 1750)`;
		await h.owner`insert into promotions (id, org_id, name, kind, value) values (${promo}, ${A.org}, 'Happy', 'percent', 1000)`;
		await h.owner`insert into promotions (id, org_id, name, kind, value, ends_at)
			values (${expiredPromo}, ${A.org}, 'Old', 'percent', 1000, now() - interval '1 day')`;
	});
	afterAll(() => h?.close());

	const getMenu = async (headers: Record<string, string>) => {
		const res = await h.app.request("/v1/device/menu", { headers });
		return { res, menu: (await res.json()) as Menu };
	};

	it("returns the location's menu with overrides, modifiers and live promotions", async () => {
		const { res, menu } = await getMenu(bearer(h.A));
		expect(res.status).toBe(200);
		expect(menu.products.map((p) => p.id)).toEqual([h.A.prod]);
		expect(menu.products[0]).toMatchObject({
			price: 1750,
			isAvailable: true,
			modifierGroupIds: [group],
		});
		expect(menu.modifierGroups).toMatchObject([
			{ id: group, options: [{ id: option }] },
		]);
		expect(menu.promotions.map((p) => p.id)).toEqual([promo]);
	});

	it("answers 304 for a matching ETag", async () => {
		const { res } = await getMenu(bearer(h.A));
		const etag = res.headers.get("etag") ?? "";
		const again = await h.app.request("/v1/device/menu", {
			headers: { ...bearer(h.A), "if-none-match": etag },
		});
		expect(again.status).toBe(304);
	});

	it("86s a product: staff only, changes the menu version", async () => {
		const path = `/v1/device/products/${h.A.prod}/availability`;
		const body = JSON.stringify({ isAvailable: false });
		const noStaff = await h.app.request(path, {
			method: "PUT",
			headers: { ...bearer(h.A), "content-type": "application/json" },
			body,
		});
		expect(noStaff.status).toBe(401);

		const before = (await getMenu(bearer(h.A))).menu.menuVersion;
		const staff = await staffLogin(h, h.A, h.A.kitchen);
		const ok = await h.app.request(path, {
			method: "PUT",
			headers: { ...staff, "content-type": "application/json" },
			body,
		});
		expect(ok.status).toBe(200);
		const { menu } = await getMenu(bearer(h.A));
		expect(menu.products[0]?.isAvailable).toBe(false);
		expect(menu.products[0]?.price).toBe(1750); // override survives the 86
		expect(menu.menuVersion).not.toBe(before);
	});

	it("serves the public menu by slug with the guest location", async () => {
		const res = await h.app.request("/v1/public/locations/a-main/menu");
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			location: {
				slug: "a-main",
				name: "a main",
				orgName: "a",
				isAcceptingOrders: true,
			},
		});
	});

	it("reports closed outside business hours", async () => {
		const closedAllWeek = Object.fromEntries(
			["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, []]),
		);
		await h.owner`update locations set business_hours = ${JSON.stringify(closedAllWeek)}::jsonb where id = ${h.A.loc}`;
		const res = await h.app.request("/v1/public/locations/a-main/menu");
		expect(await res.json()).toMatchObject({
			location: { isAcceptingOrders: false },
		});
		await h.owner`update locations set business_hours = null where id = ${h.A.loc}`;
	});

	it("404s unknown and inactive slugs the same way", async () => {
		expect((await h.app.request("/v1/public/locations/nope/menu")).status).toBe(
			404,
		);
		await h.owner`update locations set is_active = false where id = ${h.A.otherLoc}`;
		expect(
			(await h.app.request("/v1/public/locations/a-two/menu")).status,
		).toBe(404);
		await h.owner`update locations set is_active = true where id = ${h.A.otherLoc}`;
	});
});
