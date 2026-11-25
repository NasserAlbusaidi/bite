import { describe, expect, it } from "vitest";
import { AdminApiError } from "./api-types";
import { DEMO_ME, demoState, fixtureAdminApi } from "./fixtures";
import {
	inviteLink,
	mergeRoles,
	parseAddPerson,
	parseNewStaff,
	parseRoles,
} from "./staff-form";

const A = DEMO_ME.locations[0]?.location.id ?? "a";
const B = DEMO_ME.locations[1]?.location.id ?? "b";

const form = (entries: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.append(k, v);
	return f;
};

describe("staff form", () => {
	it("reads one role per visible location and ignores the rest", () => {
		const f = form({
			[`role:${A}`]: "cashier",
			[`role:${B}`]: "",
			"role:other": "manager",
		});
		expect(parseRoles(f, [A, B])).toEqual([{ locationId: A, role: "cashier" }]);
	});

	it("keeps roles at locations this manager can't see", () => {
		const merged = mergeRoles(
			[
				{ locationId: A, role: "cashier" },
				{ locationId: B, role: "kitchen" },
			],
			[{ locationId: A, role: "server" }],
			[A],
		);
		expect(merged).toEqual([
			{ locationId: B, role: "kitchen" },
			{ locationId: A, role: "server" },
		]);
	});

	it("needs a 4-8 digit PIN and a location for floor staff", () => {
		const r = parseNewStaff(
			form({ kind: "pin", displayName: "Sara", pin: "12a" }),
			[A],
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(Object.keys(r.errors).sort()).toEqual(["locations", "pin"]);
	});

	it("lets an admin invite go out without location roles", () => {
		const r = parseNewStaff(
			form({
				kind: "invite",
				displayName: "Huda",
				email: "huda@example.com",
				orgRole: "admin",
			}),
			[A],
		);
		expect(r.ok && r.value).toMatchObject({
			kind: "invite",
			orgRole: "admin",
			locations: [],
		});
	});
});

describe("demo staff api", () => {
	const api = () => fixtureAdminApi(demoState(), null);

	it("invites, rejects a duplicate email and adds PIN staff", async () => {
		const a = api();
		const invited = await a.inviteStaff({
			email: "new@example.com",
			displayName: "New",
			orgRole: "staff",
			locations: [{ locationId: A, role: "manager" }],
		});
		expect(invited.staff).toMatchObject({ hasPin: false, isActive: true });
		expect(invited.inviteToken.length).toBeGreaterThanOrEqual(40);
		expect(Date.parse(invited.expiresAt)).toBeGreaterThan(Date.now());
		await expect(
			a.inviteStaff({
				email: "NEW@example.com",
				displayName: "Dup",
				orgRole: "staff",
				locations: [],
			}),
		).rejects.toMatchObject({ status: 409 });
		const floor = await a.createPinStaff({
			displayName: "Floor",
			pin: "4321",
			locations: [{ locationId: B, role: "server" }],
		});
		expect(floor).toMatchObject({
			email: null,
			hasPin: true,
			orgRole: "staff",
		});
	});

	it("never demotes or deactivates the owner", async () => {
		const a = api();
		await expect(
			a.updateStaff(DEMO_ME.member.id, { orgRole: "staff" }),
		).rejects.toBeInstanceOf(AdminApiError);
		await expect(a.deactivateStaff(DEMO_ME.member.id)).rejects.toMatchObject({
			status: 403,
		});
	});

	it("deactivates and rejects a bad PIN reset", async () => {
		const a = api();
		const someone = (await a.staff()).find((s) => s.orgRole === "staff");
		expect(someone).toBeDefined();
		if (!someone) return;
		await expect(a.resetPin(someone.id, "12")).rejects.toBeInstanceOf(
			AdminApiError,
		);
		await a.deactivateStaff(someone.id);
		expect((await a.staff()).find((s) => s.id === someone.id)?.isActive).toBe(
			false,
		);
		await a.reactivateStaff(someone.id);
		const back = (await a.staff()).find((s) => s.id === someone.id);
		expect(back?.isActive).toBe(true);
		expect(back?.locations).toEqual(someone.locations);
	});
});

describe("invite links", () => {
	it("re-issues a pending invite with a new token, never for others", async () => {
		const a = fixtureAdminApi(demoState(), null);
		const first = await a.inviteStaff({
			email: "late@example.com",
			displayName: "Late",
			orgRole: "staff",
			locations: [{ locationId: A, role: "cashier" }],
		});
		const again = await a.reissueInvite(first.staff.id);
		expect(again.staff.id).toBe(first.staff.id);
		expect(again.inviteToken).not.toBe(first.inviteToken);
		const owner = (await a.staff()).find((x) => x.orgRole === "owner");
		await expect(a.reissueInvite(owner?.id ?? "")).rejects.toMatchObject({
			status: 409,
		});
	});

	it("puts the token in the query, URL-encoded, on the admin origin", () => {
		expect(inviteLink("ab+c/d=", "https://admin.bite.om")).toBe(
			"https://admin.bite.om/accept-invite?token=ab%2Bc%2Fd%3D",
		);
	});
});

describe("parseAddPerson", () => {
	const form = (o: Record<string, string | string[]>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o))
			for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
		return f;
	};
	const never = () => false;

	it("a cashier at the only branch needs just a name and a PIN", () => {
		expect(
			parseAddPerson(
				form({ displayName: " Aisha ", job: "cashier", pin: "4821" }),
				["b1"],
				never,
			),
		).toEqual({
			ok: true,
			value: {
				kind: "pin",
				displayName: "Aisha",
				pin: "4821",
				locations: [{ locationId: "b1", role: "cashier" }],
			},
		});
	});

	it("uses the ticked branches, and only ones this person may manage", () => {
		const r = parseAddPerson(
			form({
				displayName: "Omar",
				job: "kitchen",
				pin: "7390",
				loc: ["b2", "zz"],
			}),
			["b1", "b2"],
			never,
		);
		expect(r.ok && r.value.locations).toEqual([
			{ locationId: "b2", role: "kitchen" },
		]);
		const none = parseAddPerson(
			form({ displayName: "Omar", job: "kitchen", pin: "7390" }),
			["b1", "b2"],
			never,
		);
		expect(!none.ok && none.errors.locations?.key).toBe("pick_a_location");
	});

	it("a manager with an email gets a login and keeps the PIN", () => {
		const r = parseAddPerson(
			form({
				displayName: "Sara",
				job: "manager",
				pin: "5172",
				email: "sara@cafe.om",
			}),
			["b1"],
			never,
		);
		expect(r).toMatchObject({
			ok: true,
			value: { kind: "invite", orgRole: "staff", pin: "5172" },
		});
	});

	it("an admin needs an email and no PIN or branch", () => {
		const bad = parseAddPerson(
			form({ displayName: "Ali", job: "admin" }),
			["b1", "b2"],
			never,
		);
		expect(!bad.ok && Object.keys(bad.errors)).toEqual(["email"]);
		const ok = parseAddPerson(
			form({ displayName: "Ali", job: "admin", email: "ali@cafe.om" }),
			["b1", "b2"],
			never,
		);
		expect(ok).toMatchObject({
			ok: true,
			value: { kind: "invite", orgRole: "admin", locations: [] },
		});
	});

	it("refuses an easy PIN and a missing job", () => {
		const r = parseAddPerson(
			form({ displayName: "X", pin: "1234" }),
			["b1"],
			(p) => p === "1234",
		);
		expect(!r.ok && r.errors).toMatchObject({
			job: { key: "ap_pick_job" },
			pin: { key: "pin_weak" },
		});
	});
});
