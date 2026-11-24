import { describe, expect, it, vi } from "vitest";
import { ago, daysUntil, platformApi } from "./platform";

describe("platform helpers", () => {
	const now = Date.parse("2026-11-24T08:00:00Z");
	it("counts trial days up", () => {
		expect(daysUntil("2026-11-30T07:00:00Z", now)).toBe(6);
		expect(daysUntil("2026-11-20T08:00:00Z", now)).toBe(-4);
	});
	it("says how long ago, compactly", () => {
		expect(ago(null, now)).toBeNull();
		expect(ago("2026-11-24T07:15:00Z", now)).toBe("45m");
		expect(ago("2026-11-23T08:00:00Z", now)).toBe("24h");
		expect(ago("2026-11-20T08:00:00Z", now)).toBe("4d");
	});
});

describe("platformApi", () => {
	it("sends the cookie and turns a 404 into AdminApiError", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ error: { code: "not_found", message: "x" } }),
					{ status: 404 },
				),
		);
		const api = platformApi("http://api.test/", fetchImpl as typeof fetch);
		await expect(api.me()).rejects.toMatchObject({ status: 404 });
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			URL,
			RequestInit,
		];
		expect(String(url)).toBe("http://api.test/v1/platform/me");
		expect(init.credentials).toBe("include");
	});
	it("builds the list query from set filters only", async () => {
		const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
		const api = platformApi("http://api.test/", fetchImpl as typeof fetch);
		await api.orgs({ q: "luban", status: "trial" }).catch(() => {});
		const [url] = fetchImpl.mock.calls[0] as unknown as [URL];
		expect(String(url)).toBe(
			"http://api.test/v1/platform/orgs?q=luban&status=trial",
		);
	});
});
