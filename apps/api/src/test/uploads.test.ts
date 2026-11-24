import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { PinLimiter } from "../lib/pin-limiter.js";
import { memoryStore, parseKey, sniffImage } from "../lib/uploads.js";
import { type Harness, ownerUrl, setupHarness } from "./harness.js";

const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

describe("image sniffing and keys", () => {
	it("knows images by their bytes, not their names", () => {
		expect(sniffImage(PNG)).toBe("png");
		expect(sniffImage(JPG)).toBe("jpg");
		expect(sniffImage(WEBP)).toBe("webp");
		expect(sniffImage(new TextEncoder().encode("<svg onload=x>"))).toBeNull();
		expect(sniffImage(new Uint8Array())).toBeNull();
	});
	it("accepts only <org uuid>/<uuid>.<ext>", () => {
		const org = "0193a1b2-0000-7000-8000-000000000001";
		const file = "6f1c2d3e-4a5b-4c6d-8e7f-001122334455";
		expect(parseKey(`${org}/${file}.png`)).toEqual({ orgId: org, type: "png" });
		for (const bad of [
			`${org}/../${file}.png`,
			`${org}/${file}.svg`,
			`${org}/${file}.png/x`,
			`../${file}.png`,
			`${org}/${file}`,
		])
			expect(parseKey(bad)).toBeNull();
	});
});

describe("public photo route", () => {
	it("serves a stored image with safe headers, 404 otherwise", async () => {
		const uploads = memoryStore();
		const app = createApp({
			db: {} as never,
			staffTokenSecret: "x".repeat(32),
			pinLimiter: new PinLimiter(),
			uploads,
		});
		const key = await uploads.put(
			"0193a1b2-0000-7000-8000-000000000001",
			"png",
			PNG,
		);
		const res = await app.request(`/v1/uploads/${key}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
		const missing = key.replace(/.{4}\.png$/, "ffff.png");
		expect((await app.request(`/v1/uploads/${missing}`)).status).toBe(404);
		expect(
			(await app.request("/v1/uploads/x/..%2F..%2Fetc%2Fpasswd")).status,
		).toBe(404);
	});
});

describe.runIf(ownerUrl)("admin photo upload", () => {
	let h: Harness;
	const store = memoryStore();
	beforeAll(async () => {
		h = await setupHarness();
		h.deps.uploads = store;
		h.deps.publicApiUrl = "https://api.bite.test";
	});
	afterAll(() => h?.close());

	const upload = (
		who: "owner" | "manager",
		body: Uint8Array,
		type = "image/png",
	) =>
		h.app.request("/v1/admin/uploads", {
			method: "POST",
			headers: { ...h.logins.A[who], "content-type": type },
			body,
		});

	it("owner uploads a photo into their own org and can load it back", async () => {
		const res = await upload("owner", PNG);
		expect(res.status).toBe(201);
		const { url } = (await res.json()) as { url: string };
		expect(url.startsWith(`https://api.bite.test/v1/uploads/${h.A.org}/`)).toBe(
			true,
		);
		const back = await h.app.request(new URL(url).pathname);
		expect(back.status).toBe(200);
		// The URL is accepted as a product photo.
		const prod = await h.app.request(`/v1/admin/products/${h.A.prod}`, {
			method: "PATCH",
			headers: { ...h.logins.A.owner, "content-type": "application/json" },
			body: JSON.stringify({ imageUrl: url }),
		});
		expect(prod.status).toBe(200);
	});

	it("refuses non-images, lying content types, and managers", async () => {
		const svg = new TextEncoder().encode(
			"<svg xmlns='http://www.w3.org/2000/svg'/>",
		);
		expect((await upload("owner", svg, "image/svg+xml")).status).toBe(400);
		expect((await upload("owner", svg, "image/png")).status).toBe(400);
		expect((await upload("owner", PNG, "text/plain")).status).toBe(400);
		expect((await upload("manager", PNG)).status).toBe(403);
	});

	it("refuses files over 5 MB", async () => {
		const big = new Uint8Array(5 * 1024 * 1024 + 1);
		big.set(PNG);
		expect((await upload("owner", big)).status).toBe(400);
	});

	it("needs a login", async () => {
		const res = await h.app.request("/v1/admin/uploads", {
			method: "POST",
			headers: { "content-type": "image/png" },
			body: PNG,
		});
		expect(res.status).toBe(401);
	});
});
