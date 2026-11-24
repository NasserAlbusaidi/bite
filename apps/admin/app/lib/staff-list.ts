import type { AdminStaff } from "./contracts";
import { matchScore } from "./nav";

export type StaffFilter =
	| "all"
	| "branch"
	| "office"
	| "floor"
	| "pending"
	| "off";
export const STAFF_FILTERS: readonly StaffFilter[] = [
	"all",
	"branch",
	"office",
	"floor",
	"pending",
	"off",
];

/** Signed up through an invite link that nobody has opened yet. */
export const isPending = (s: AdminStaff) => s.isActive && !s.email && !s.hasPin;
/** Signs in to the back office: owner, admin, or manager somewhere. */
export const isOffice = (s: AdminStaff) =>
	s.orgRole !== "staff" || s.locations.some((l) => l.role === "manager");
const worksAt = (s: AdminStaff, locationId: string | undefined) =>
	s.orgRole !== "staff" || s.locations.some((l) => l.locationId === locationId);

/**
 * The staff list after the search box and the filter chips. Deactivated
 * people only show under their own chip, so the default list is who works
 * here today. Active first, then by name.
 */
export function filterStaff(
	staff: readonly AdminStaff[],
	opts: { q: string; filter: StaffFilter; locationId: string | undefined },
): AdminStaff[] {
	const { q, filter, locationId } = opts;
	return staff
		.filter((s) => {
			if (filter === "off") return !s.isActive;
			if (!s.isActive) return false;
			if (filter === "branch") return worksAt(s, locationId);
			if (filter === "office") return isOffice(s);
			if (filter === "floor") return !isOffice(s);
			if (filter === "pending") return isPending(s);
			return true;
		})
		.filter((s) => matchScore(q, s.displayName, s.email ?? "") > 0)
		.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function staffCounts(
	staff: readonly AdminStaff[],
	locationId: string | undefined,
): Record<StaffFilter, number> {
	const active = staff.filter((s) => s.isActive);
	return {
		all: active.length,
		branch: active.filter((s) => worksAt(s, locationId)).length,
		office: active.filter(isOffice).length,
		floor: active.filter((s) => !isOffice(s)).length,
		pending: active.filter(isPending).length,
		off: staff.length - active.length,
	};
}

/** Too easy to guess: one digit repeated, or a run up or down. */
export function weakPin(pin: string): boolean {
	if (/^(\d)\1+$/.test(pin)) return true;
	const d = [...pin].map(Number);
	const step = (d[1] ?? 0) - (d[0] ?? 0);
	return (
		Math.abs(step) === 1 &&
		d.every((x, i) => i === 0 || x - (d[i - 1] ?? 0) === step)
	);
}

/** A random 4-digit PIN that isn't a trivially guessable one. */
export function randomPin(
	rand: () => number = () => {
		const a = new Uint32Array(1);
		crypto.getRandomValues(a);
		return (a[0] ?? 0) / 2 ** 32;
	},
): string {
	for (;;) {
		const pin = Array.from({ length: 4 }, () =>
			Math.floor(rand() * 10).toString(),
		).join("");
		if (!weakPin(pin)) return pin;
	}
}

export const initials = (name: string) =>
	name
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((w) => [...w][0] ?? "")
		.join("")
		.toLocaleUpperCase();
