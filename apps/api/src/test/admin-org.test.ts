import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ADMIN_ORIGIN,
	type Harness,
	json,
	ownerUrl,
	PIN,
	setupHarness,
	signUp,
	staffLogin,
	uuidv7,
} from "./harness.js";

type Staff = {
	id: string;
	email: string | null;
	orgRole: string;
	hasPin: boolean;
	isActive: boolean;
	locations: { locationId: string; role: string }[];
};

describe.runIf(ownerUrl)("admin staff, locations, devices", () => {
	let h: Harness;
	let admin: Record<string, string>;
	let adminId: string;
	beforeAll(async () => {
		h = await setupHarness();
		const s = await signUp(h.app, "admin-a@test.bite", "Admin");
		adminId = uuidv7();
		await h.owner`
			insert into members (id, org_id, user_id, display_name, org_role)
			values (${adminId}, ${h.A.org}, ${s.userId}, 'Admin', 'admin')`;
		admin = { cookie: s.cookie, origin: ADMIN_ORIGIN };
	});
	afterAll(() => h?.close());

	const as = (who: "owner" | "manager" | "admin") =>
		who === "admin" ? admin : h.logins.A[who];
	const call = (
		who: "owner" | "manager" | "admin",
		method: string,
		path: string,
		body?: unknown,
	) =>
		h.app.request(`/v1/admin${path}`, {
			method,
			headers: { ...as(who), "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	const ok = async <T>(res: Response | Promise<Response>, status = 200) => {
		const r = await res;
		if (r.status !== status) throw new Error(`${r.status}: ${await r.text()}`);
		return (await r.json()) as T;
	};
	const staffOf = async (who: "owner" | "manager", id: string) => {
		const { items } = await ok<{ items: Staff[] }>(call(who, "GET", "/staff"));
		return items.find((s) => s.id === id);
	};

	describe("staff list", () => {
		it("owner sees everyone; a manager sees only staff at their locations", async () => {
			const all = await ok<{ items: Staff[] }>(call("owner", "GET", "/staff"));
			const ids = all.items.map((s) => s.id);
			expect(ids).toEqual(
				expect.arrayContaining([h.A.cashier, h.A.otherLocStaff]),
			);
			expect(all.items.find((s) => s.id === h.A.manager)?.email).toMatch(
				/^manager-/,
			);

			const mine = await ok<{ items: Staff[] }>(
				call("manager", "GET", "/staff"),
			);
			const mineIds = mine.items.map((s) => s.id);
			expect(mineIds).toContain(h.A.cashier);
			expect(mineIds).not.toContain(h.A.otherLocStaff);
			for (const s of mine.items) {
				for (const r of s.locations) expect(r.locationId).toBe(h.A.loc);
			}
		});
	});

	describe("manager guards", () => {
		it("can't touch staff outside their locations, other managers, or themselves", async () => {
			expect(
				(
					await call("manager", "PATCH", `/staff/${h.A.otherLocStaff}`, {
						displayName: "x",
					})
				).status,
			).toBe(404);
			expect(
				(
					await call("manager", "PATCH", `/staff/${h.A.manager}`, {
						locations: [{ locationId: h.A.loc, role: "cashier" }],
					})
				).status,
			).toBe(403);
			// Own name is fine.
			await ok(
				call("manager", "PATCH", `/staff/${h.A.manager}`, {
					displayName: "Mgr",
				}),
			);
		});

		it("can't appoint managers or set org roles", async () => {
			expect(
				(
					await call("manager", "PATCH", `/staff/${h.A.kitchen}`, {
						locations: [{ locationId: h.A.loc, role: "manager" }],
					})
				).status,
			).toBe(403);
			expect(
				(
					await call("manager", "PATCH", `/staff/${h.A.kitchen}`, {
						orgRole: "admin",
					})
				).status,
			).toBe(403);
		});

		it("editing locations keeps the roles a manager can't see", async () => {
			await ok(
				call("owner", "PATCH", `/staff/${h.A.kitchen}`, {
					locations: [
						{ locationId: h.A.loc, role: "kitchen" },
						{ locationId: h.A.otherLoc, role: "cashier" },
					],
				}),
			);
			const seen = await ok<Staff>(
				call("manager", "PATCH", `/staff/${h.A.kitchen}`, {
					locations: [{ locationId: h.A.loc, role: "server" }],
				}),
			);
			expect(seen.locations).toEqual([{ locationId: h.A.loc, role: "server" }]);
			const full = await staffOf("owner", h.A.kitchen);
			expect(full?.locations).toEqual(
				expect.arrayContaining([
					{ locationId: h.A.loc, role: "server" },
					{ locationId: h.A.otherLoc, role: "cashier" },
				]),
			);
		});

		it("creates PIN staff for their location, and the PIN works on the till", async () => {
			const s = await ok<Staff>(
				call("manager", "POST", "/staff", {
					displayName: "New barista",
					pin: PIN,
					locations: [{ locationId: h.A.loc, role: "cashier" }],
				}),
				201,
			);
			expect(s).toMatchObject({ hasPin: true, orgRole: "staff", email: null });
			await staffLogin(h, h.A, s.id);
			expect(
				(
					await call("manager", "POST", "/staff", {
						displayName: "Elsewhere",
						pin: PIN,
						locations: [{ locationId: h.A.otherLoc, role: "cashier" }],
					})
				).status,
			).toBe(404);
		});
	});

	describe("org roles", () => {
		it("only the owner appoints admins; admins can't manage admins or the owner", async () => {
			expect(
				(
					await call("admin", "PATCH", `/staff/${h.A.cashier}`, {
						orgRole: "admin",
					})
				).status,
			).toBe(403);
			expect(
				(
					await call(
						"admin",
						"POST",
						`/staff/${h.logins.A.ownerMember}/deactivate`,
					)
				).status,
			).toBe(403);
			expect(
				(
					await call("admin", "PATCH", `/staff/${h.logins.A.ownerMember}`, {
						orgRole: "staff",
					})
				).status,
			).toBe(403);
			const promoted = await ok<Staff>(
				call("owner", "PATCH", `/staff/${h.A.cashier}`, { orgRole: "admin" }),
			);
			expect(promoted.orgRole).toBe("admin");
			expect(
				(
					await call("admin", "PATCH", `/staff/${h.A.cashier}`, {
						displayName: "x",
					})
				).status,
			).toBe(403);
			await ok(
				call("owner", "PATCH", `/staff/${h.A.cashier}`, { orgRole: "staff" }),
			);
		});

		it("nobody deactivates or demotes themselves; the owner sets their own PIN", async () => {
			const me = h.logins.A.ownerMember;
			expect(
				(await call("owner", "POST", `/staff/${me}/deactivate`)).status,
			).toBe(403);
			expect(
				(await call("owner", "PATCH", `/staff/${me}`, { orgRole: "staff" }))
					.status,
			).toBe(403);
			const s = await ok<Staff>(
				call("owner", "POST", `/staff/${me}/reset-pin`, { pin: "2468" }),
			);
			expect(s.hasPin).toBe(true);
		});

		it("deactivation locks a member out of the till at once", async () => {
			const s = await ok<Staff>(
				call("owner", "POST", "/staff", {
					displayName: "Temp",
					pin: PIN,
					locations: [{ locationId: h.A.loc, role: "cashier" }],
				}),
				201,
			);
			const staff = await staffLogin(h, h.A, s.id);
			await ok(call("manager", "POST", `/staff/${s.id}/deactivate`));
			// The already-issued staff token dies too (member re-checked per request).
			const res = await h.app.request(
				`/v1/device/products/${h.A.prod}/availability`,
				{
					method: "PUT",
					headers: { ...staff, "content-type": "application/json" },
					body: JSON.stringify({ isAvailable: true }),
				},
			);
			expect(res.status).toBe(401);
			await expect(staffLogin(h, h.A, s.id)).rejects.toThrow();

			// Reactivating restores them with the same roles and PIN.
			const back = await ok<Staff>(
				call("manager", "POST", `/staff/${s.id}/reactivate`),
			);
			expect(back.isActive).toBe(true);
			expect(back.hasPin).toBe(true);
			expect(back.locations).toEqual([
				{ locationId: h.A.loc, role: "cashier" },
			]);
			await staffLogin(h, h.A, s.id);
		});
	});

	describe("invites", () => {
		it("invite, sign up with that email, accept, land in the back office", async () => {
			const inv = await ok<{ inviteToken: string; staff: Staff }>(
				call("owner", "POST", "/staff/invite", {
					email: "New.Manager@Test.Bite",
					displayName: "New manager",
					orgRole: "staff",
					locations: [{ locationId: h.A.otherLoc, role: "manager" }],
				}),
				201,
			);
			expect(inv.staff.email).toBe("new.manager@test.bite");
			const dup = await call("owner", "POST", "/staff/invite", {
				email: "new.manager@test.bite",
				displayName: "Again",
				orgRole: "staff",
			});
			expect(dup.status).toBe(409);

			const stranger = await signUp(h.app, "stranger@test.bite", "Stranger");
			const wrong = await h.app.request(
				"/v1/account/invites/accept",
				json({ token: inv.inviteToken }, { cookie: stranger.cookie }),
			);
			expect(wrong.status).toBe(403);

			const invitee = await signUp(h.app, "new.manager@test.bite", "New");
			const accepted = await ok<{ orgId: string; memberId: string }>(
				h.app.request(
					"/v1/account/invites/accept",
					json({ token: inv.inviteToken }, { cookie: invitee.cookie }),
				),
			);
			expect(accepted).toEqual({ orgId: h.A.org, memberId: inv.staff.id });
			const me = await ok<{ locations: { location: { id: string } }[] }>(
				h.app.request("/v1/admin/me", { headers: { cookie: invitee.cookie } }),
			);
			expect(me.locations.map((l) => l.location.id)).toEqual([h.A.otherLoc]);

			const again = await h.app.request(
				"/v1/account/invites/accept",
				json({ token: inv.inviteToken }, { cookie: invitee.cookie }),
			);
			expect(again.status).toBe(404);
		});

		it("re-issuing an invite kills the old link", async () => {
			const inv = await ok<{ inviteToken: string; staff: Staff }>(
				call("owner", "POST", "/staff/invite", {
					email: "slow@test.bite",
					displayName: "Slow",
					orgRole: "staff",
				}),
				201,
			);
			const fresh = await ok<{ inviteToken: string }>(
				call("owner", "POST", `/staff/${inv.staff.id}/invite`),
			);
			const u = await signUp(h.app, "slow@test.bite", "Slow");
			const old = await h.app.request(
				"/v1/account/invites/accept",
				json({ token: inv.inviteToken }, { cookie: u.cookie }),
			);
			expect(old.status).toBe(404);
			await ok(
				h.app.request(
					"/v1/account/invites/accept",
					json({ token: fresh.inviteToken }, { cookie: u.cookie }),
				),
			);
		});
	});

	describe("locations", () => {
		it("managers can't touch tax or identity settings", async () => {
			const res = await call("manager", "PATCH", `/locations/${h.A.loc}`, {
				taxBps: 0,
			});
			expect(res.status).toBe(403);
			expect(
				(
					await call("manager", "PATCH", `/locations/${h.A.otherLoc}`, {
						phone: "1",
					})
				).status,
			).toBe(404);
		});

		it("pausing orders closes the guest menu until the pause ends", async () => {
			const until = new Date(Date.now() + 20 * 60_000).toISOString();
			const loc = await ok<{ ordersPausedUntil: string | null }>(
				call("manager", "PATCH", `/locations/${h.A.loc}`, {
					ordersPausedUntil: until,
				}),
			);
			expect(loc.ordersPausedUntil).toBe(until);
			const menu = await ok<{ location: { isAcceptingOrders: boolean } }>(
				h.app.request("/v1/public/locations/a-main/menu"),
			);
			expect(menu.location.isAcceptingOrders).toBe(false);
			await ok(
				call("manager", "PATCH", `/locations/${h.A.loc}`, {
					ordersPausedUntil: null,
				}),
			);
			const open = await ok<{ location: { isAcceptingOrders: boolean } }>(
				h.app.request("/v1/public/locations/a-main/menu"),
			);
			expect(open.location.isAcceptingOrders).toBe(true);
		});

		it("lists only locations in reach", async () => {
			const { items } = await ok<{ items: { id: string }[] }>(
				call("manager", "GET", "/locations"),
			);
			expect(items.map((l) => l.id)).toEqual([h.A.loc]);
		});
	});

	describe("devices", () => {
		it("register shows the token once; it works; revoke kills it", async () => {
			const reg = await ok<{ deviceId: string; token: string }>(
				call("manager", "POST", "/devices", {
					locationId: h.A.loc,
					name: "Bar tablet",
					kind: "kds",
					ticketPrefix: "K",
				}),
				201,
			);
			const auth = { authorization: `Bearer ${reg.token}` };
			expect(
				(await h.app.request("/v1/device/me", { headers: auth })).status,
			).toBe(200);
			const [row] = await h.owner<{ token_hash: string }[]>`
				select token_hash from devices where id = ${reg.deviceId}`;
			expect(row?.token_hash).not.toContain(reg.token);

			const dup = await call("manager", "POST", "/devices", {
				locationId: h.A.loc,
				name: "Dup",
				kind: "pos",
				ticketPrefix: "K",
			});
			expect(dup.status).toBe(409);
			for (const p of ["G", "Q"]) {
				const r = await call("manager", "POST", "/devices", {
					locationId: h.A.loc,
					name: "Reserved",
					kind: "pos",
					ticketPrefix: p,
				});
				expect(r.status).toBe(400);
			}

			const list = await ok<{ items: { id: string }[] }>(
				call("manager", "GET", `/locations/${h.A.loc}/devices`),
			);
			expect(list.items.map((d) => d.id)).toContain(reg.deviceId);

			const revoked = await ok<{ revokedAt: string | null }>(
				call("manager", "POST", `/devices/${reg.deviceId}/revoke`),
			);
			expect(revoked.revokedAt).not.toBeNull();
			expect(
				(await h.app.request("/v1/device/me", { headers: auth })).status,
			).toBe(401);
		});
	});
});
