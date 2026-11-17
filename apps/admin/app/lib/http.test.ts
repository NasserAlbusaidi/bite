import { describe, expect, it } from "vitest";
import { AdminApiError } from "./api-types";
import { httpAdminApi } from "./http";

const cat = (n: number) => ({
	id: `0193a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`,
	parentId: null,
	name: { en: `C${n}` },
	sortOrder: n,
	isActive: true,
});

function fake(routes: Record<string, unknown>, calls: string[]) {
	return (async (input: URL | RequestInfo, init?: RequestInit) => {
		const url = new URL(String(input));
		const key = `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
		calls.push(key);
		if (!(key in routes))
			return new Response(
				JSON.stringify({ error: { code: "not_found", message: "x" } }),
				{ status: 404 },
			);
		return new Response(JSON.stringify(routes[key]), { status: 200 });
	}) as typeof fetch;
}

describe("http admin api", () => {
	it("follows cursors and merges the three menu lists", async () => {
		const calls: string[] = [];
		const api = httpAdminApi(
			"https://api.test",
			fake(
				{
					"GET /v1/admin/categories": { items: [cat(1)], nextCursor: "c2" },
					"GET /v1/admin/categories?cursor=c2": { items: [cat(2)] },
					"GET /v1/admin/products": { items: [] },
					"GET /v1/admin/modifier-groups": { items: [] },
				},
				calls,
			),
		);
		const menu = await api.menu();
		expect(menu.categories.map((c) => c.name.en)).toEqual(["C1", "C2"]);
		expect(calls).toContain("GET /v1/admin/categories?cursor=c2");
	});

	it("PATCHes updates, encodes ids and surfaces API error codes", async () => {
		const calls: string[] = [];
		const api = httpAdminApi("https://api.test", fake({}, calls));
		await expect(
			api.updateCategory("a/b", { isActive: false }),
		).rejects.toEqual(new AdminApiError("not_found", 404));
		expect(calls).toEqual(["PATCH /v1/admin/categories/a%2Fb"]);
	});
});
