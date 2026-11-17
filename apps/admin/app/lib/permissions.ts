import type { AdminMe, AdminStaff } from "./contracts";
import { LOCATION_ROLES, type LocationRole } from "./staff-form";

/**
 * What the signed-in member may do to staff. Mirrors the API's rules so the UI
 * doesn't offer what the server will refuse; the server stays the real guard.
 * Owner: everything. Admin: everything except granting or removing admin.
 * Manager (orgRole staff): only per-location staff, never the manager role.
 */
export function staffPowers(me: AdminMe) {
	const mine = me.member.orgRole;
	return {
		canInvite: mine !== "staff",
		canSetOrgRole: mine !== "staff",
		canGrantAdmin: mine === "owner",
		grantable: (mine === "staff"
			? LOCATION_ROLES.filter((r) => r !== "manager")
			: [...LOCATION_ROLES]) as LocationRole[],
		canEdit(m: AdminStaff): boolean {
			if (mine === "owner") return true;
			if (m.orgRole === "owner") return false;
			if (mine === "admin") return true;
			return m.orgRole === "staff";
		},
		canChangeOrgRoleOf(m: AdminStaff): boolean {
			if (m.orgRole === "owner" || !m.email) return false;
			if (mine === "owner") return true;
			return mine === "admin" && m.orgRole !== "admin";
		},
	};
}

/**
 * The shared menu, categories and org-wide promotions belong to owners and
 * admins (the API's requireOrgWide). A branch manager sets their branch's
 * prices and sold-out items, and promotions for their own branches.
 */
export function catalogPowers(me: AdminMe) {
	const orgWide = me.member.orgRole !== "staff";
	return {
		canEditMenu: orgWide,
		canEditPromotion: (p: { locationId: string | null }) =>
			orgWide || p.locationId !== null,
		canPickAllLocations: orgWide,
	};
}
