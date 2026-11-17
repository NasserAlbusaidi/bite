import { describe, expect, it } from "vitest";
import type { AdminMe, AdminStaff } from "./contracts";
import { DEMO_ME } from "./fixtures";
import { staffPowers } from "./permissions";

const as = (orgRole: AdminMe["member"]["orgRole"]): AdminMe => ({
	...DEMO_ME,
	member: { ...DEMO_ME.member, orgRole },
});
const member = (
	orgRole: AdminStaff["orgRole"],
	email: string | null = "x@example.com",
): AdminStaff => ({
	id: "m",
	displayName: "M",
	email,
	orgRole,
	hasPin: true,
	isActive: true,
	locations: [],
});

describe("staff powers mirror the API rules", () => {
	it("owner can do everything except demote the owner", () => {
		const p = staffPowers(as("owner"));
		expect(p.canGrantAdmin).toBe(true);
		expect(p.canEdit(member("admin"))).toBe(true);
		expect(p.canChangeOrgRoleOf(member("owner"))).toBe(false);
	});

	it("admin can't grant or remove admin and can't touch the owner", () => {
		const p = staffPowers(as("admin"));
		expect(p.canGrantAdmin).toBe(false);
		expect(p.canChangeOrgRoleOf(member("admin"))).toBe(false);
		expect(p.canChangeOrgRoleOf(member("staff"))).toBe(true);
		expect(p.canEdit(member("owner"))).toBe(false);
	});

	it("a manager only edits per-location staff and never grants manager", () => {
		const p = staffPowers(as("staff"));
		expect(p.canInvite).toBe(false);
		expect(p.canSetOrgRole).toBe(false);
		expect(p.grantable).not.toContain("manager");
		expect(p.canEdit(member("staff", null))).toBe(true);
		expect(p.canEdit(member("admin"))).toBe(false);
	});

	it("PIN-only staff have no org role to change", () => {
		expect(
			staffPowers(as("owner")).canChangeOrgRoleOf(member("staff", null)),
		).toBe(false);
	});
});
