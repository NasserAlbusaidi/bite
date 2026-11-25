import type {
	AdminDevice,
	AdminLocationSettings,
	AdminMenu,
	AdminStaff,
} from "./contracts";

export type GuideStepKey =
	| "details"
	| "hours"
	| "vat"
	| "menu"
	| "team"
	| "till"
	| "kitchen"
	| "qr";

export type GuideStep = {
	key: GuideStepKey;
	done: boolean;
	/** Nice to have: doesn't hold back "ready to sell". */
	optional: boolean;
	to: string;
};

/**
 * Everything between a new branch and a smooth first day, worked out from
 * data the back office already has. Steps the data can't tell (printing the
 * QR card) are ticked by hand and remembered per browser.
 */
export function setupGuide(input: {
	location: AdminLocationSettings;
	menu: AdminMenu;
	staff: readonly AdminStaff[];
	devices: readonly AdminDevice[];
	ticked: ReadonlySet<GuideStepKey>;
}): GuideStep[] {
	const { location: l, menu, staff, devices, ticked } = input;
	const base = `/locations/${l.id}/settings`;
	const live = devices.filter((d) => !d.revokedAt);
	const floor = staff.filter(
		(s) =>
			s.isActive &&
			s.hasPin &&
			s.orgRole === "staff" &&
			s.locations.some((x) => x.locationId === l.id),
	);
	const hasHours =
		!!l.businessHours &&
		Object.values(l.businessHours).some((r) => (r?.length ?? 0) > 0);
	return [
		{
			key: "details",
			done: !!l.address && !!l.phone,
			optional: false,
			to: `${base}#details`,
		},
		{ key: "hours", done: hasHours, optional: false, to: `${base}#hours` },
		{
			key: "vat",
			done: l.taxBps === 0 || !!l.vatNumber,
			optional: false,
			to: `${base}#tax`,
		},
		{
			key: "menu",
			done: menu.products.some((p) => !p.archivedAt),
			optional: false,
			to: "/menu",
		},
		{
			key: "team",
			done: floor.length > 0,
			optional: false,
			to: "/staff/new",
		},
		{
			key: "till",
			// Connected, not just added: an added till nobody typed the code into
			// can't sell anything yet.
			done: live.some((d) => d.kind === "pos" && !!d.lastSeenAt),
			optional: false,
			to: "/devices",
		},
		{
			key: "kitchen",
			done: live.some((d) => d.kind === "kds" && !!d.lastSeenAt),
			optional: true,
			to: "/devices",
		},
		{ key: "qr", done: ticked.has("qr"), optional: true, to: `${base}#qr` },
	];
}

const key = (locationId: string) => `bite.admin.guide.${locationId}`;

export function tickedSteps(locationId: string): Set<GuideStepKey> {
	try {
		const raw = localStorage.getItem(key(locationId));
		return new Set(raw ? (JSON.parse(raw) as GuideStepKey[]) : []);
	} catch {
		return new Set();
	}
}

export function setTicked(
	locationId: string,
	step: GuideStepKey,
	on: boolean,
): void {
	const s = tickedSteps(locationId);
	if (on) s.add(step);
	else s.delete(step);
	try {
		localStorage.setItem(key(locationId), JSON.stringify([...s]));
	} catch {
		// private mode: forgotten next visit
	}
}
