import { describe, expect, it } from "vitest";
import { accountApi, adminGate, safeNext } from "./account";
import { AdminApiError } from "./api-types";
import { httpAdminApi } from "./http";

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

describe("safeNext", () => {
	it("keeps in-app paths and drops anything that could leave the app", () => {
		expect(safeNext("/reports?from=2026-11-01")).toBe(
			"/reports?from=2026-11-01",
		);
		for (const bad of [
			null,
			"",
			"https://evil.example",
			"//evil.example",
			"/\\evil",
			"reports",
		])
			expect(safeNext(bad)).toBe("/");
	});
});

describe("adminGate", () => {
	it("sends 401 to sign-in, multi-org 400 to the picker, 403 to the picker with the org cleared", () => {
		expect(
			adminGate(new AdminApiError("unauthenticated", 401), "/staff"),
		).toEqual({
			to: "/sign-in?next=%2Fstaff",
		});
		expect(
			adminGate(
				new AdminApiError("bad_request", 400, { orgIds: ["a", "b"] }),
				"/",
			),
		).toEqual({ to: "/orgs?next=%2F" });
		expect(adminGate(new AdminApiError("forbidden", 403), "/")).toEqual({
			to: "/orgs?next=%2F&denied=1",
			clearOrg: true,
		});
	});
	it("leaves other failures to the error page", () => {
		expect(adminGate(new AdminApiError("bad_request", 400), "/")).toBeNull();
		expect(adminGate(new AdminApiError("internal", 500), "/")).toBeNull();
		expect(adminGate(new Error("boom"), "/")).toBeNull();
	});
});

describe("accountApi", () => {
	it("posts with the cookie and maps Better Auth error codes", async () => {
		const seen: { url: string; init: RequestInit | undefined }[] = [];
		const api = accountApi("https://api.example", async (url, init) => {
			seen.push({ url: String(url), init });
			return json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "nope" });
		});
		await expect(api.signIn("a@b.co", "x")).rejects.toMatchObject({
			status: 401,
			code: "INVALID_EMAIL_OR_PASSWORD",
		});
		expect(seen[0]?.url).toBe("https://api.example/v1/auth/sign-in/email");
		expect(seen[0]?.init?.credentials).toBe("include");
		expect(seen[0]?.init?.method).toBe("POST");
	});
	it("reads a missing session as null and parses our error envelope", async () => {
		const api = accountApi("https://api.example", async (url) =>
			String(url).endsWith("/get-session")
				? json(200, null)
				: json(404, { error: { code: "not_found", message: "expired" } }),
		);
		expect(await api.session()).toBeNull();
		await expect(api.acceptInvite("t".repeat(43))).rejects.toMatchObject({
			status: 404,
			code: "not_found",
		});
	});
});

describe("org header", () => {
	it("sends x-org-id only when an org is chosen", async () => {
		const headers: (string | null)[] = [];
		let org: string | undefined;
		const api = httpAdminApi(
			"https://api.example",
			async (_url, init) => {
				headers.push(new Headers(init?.headers).get("x-org-id"));
				return json(400, { error: { code: "bad_request", message: "x" } });
			},
			() => org,
		);
		await api.me().catch(() => undefined);
		org = "0193a1b2-0000-7000-8000-000000000001";
		await api.me().catch(() => undefined);
		expect(headers).toEqual([null, org]);
	});
});
