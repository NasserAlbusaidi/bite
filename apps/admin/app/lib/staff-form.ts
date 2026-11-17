import type { AdminStaff } from "./contracts";
import type { FieldError } from "./product-form";

export const LOCATION_ROLES = [
	"manager",
	"cashier",
	"server",
	"kitchen",
] as const;
export type LocationRole = (typeof LOCATION_ROLES)[number];
export type StaffLocation = { locationId: string; role: LocationRole };

const text = (f: FormData, k: string) => {
	const v = f.get(k);
	return typeof v === "string" ? v.trim() : "";
};
const isRole = (v: string): v is LocationRole =>
	(LOCATION_ROLES as readonly string[]).includes(v);

/** One select per visible location, named role:<id>. Empty = no access there. */
export function parseRoles(
	f: FormData,
	visible: readonly string[],
): StaffLocation[] {
	return visible.flatMap((locationId) => {
		const r = text(f, `role:${locationId}`);
		return isRole(r) ? [{ locationId, role: r }] : [];
	});
}

/**
 * PATCH replaces the whole set. A manager only sees their own locations, so
 * roles elsewhere are carried over untouched instead of silently dropped.
 */
export function mergeRoles(
	current: readonly StaffLocation[],
	edited: readonly StaffLocation[],
	visible: readonly string[],
): StaffLocation[] {
	const seen = new Set(visible);
	return [...current.filter((l) => !seen.has(l.locationId)), ...edited];
}

export const PIN = /^\d{4,8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StaffParse<T> =
	| { ok: true; value: T }
	| { ok: false; errors: Record<string, FieldError> };

export function parseNewStaff(
	f: FormData,
	visible: readonly string[],
):
	| StaffParse<{
			kind: "invite";
			email: string;
			displayName: string;
			orgRole: "admin" | "staff";
			locations: StaffLocation[];
	  }>
	| StaffParse<{
			kind: "pin";
			displayName: string;
			pin: string;
			locations: StaffLocation[];
	  }> {
	const errors: Record<string, FieldError> = {};
	const kind = text(f, "kind") === "invite" ? "invite" : "pin";
	const displayName = text(f, "displayName");
	if (!displayName || displayName.length > 80)
		errors.displayName = { key: "required_field" };
	const locations = parseRoles(f, visible);
	if (kind === "invite") {
		const email = text(f, "email");
		if (!EMAIL.test(email)) errors.email = { key: "invalid_email" };
		const orgRole = text(f, "orgRole") === "admin" ? "admin" : "staff";
		if (orgRole === "staff" && locations.length === 0)
			errors.locations = { key: "pick_a_location" };
		if (Object.keys(errors).length > 0) return { ok: false, errors };
		return {
			ok: true,
			value: { kind, email, displayName, orgRole, locations },
		};
	}
	const pin = text(f, "pin");
	if (!PIN.test(pin)) errors.pin = { key: "invalid_pin" };
	if (locations.length === 0) errors.locations = { key: "pick_a_location" };
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, value: { kind, displayName, pin, locations } };
}

/** "Manager at Azaiba, Kitchen at Al Mouj" */
export function rolesSummary(
	s: AdminStaff,
	names: ReadonlyMap<string, string>,
	roleLabel: (r: LocationRole) => string,
	at: (role: string, place: string) => string,
	sep: string,
): string {
	return s.locations
		.map((l) => at(roleLabel(l.role), names.get(l.locationId) ?? "—"))
		.join(sep);
}
