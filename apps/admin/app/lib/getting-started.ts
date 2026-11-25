import type { BranchDay } from "./dashboard";

export type SetupStep = {
	key: "menu" | "team" | "tablet" | "order";
	done: boolean;
	to: string;
};

/**
 * A business that has taken nothing all week is either brand new or closed.
 * Either way the overview's numbers are all zero, so it shows the way to a
 * first order instead.
 */
export const noOrdersYet = (branches: readonly BranchDay[]) =>
	branches.every((b) => b.week.orderCount === 0);

/** The four things between a new account and a first sale, in order. */
export function setupSteps(input: {
	locationId: string;
	/** Products on the menu, archived ones left out. */
	products: number;
	/** Active staff who can sign in on the tablet. */
	withPin: number;
	/** Paired tablets that are not revoked. */
	tablets: number;
	orders: number;
}): SetupStep[] {
	const branch = `/locations/${input.locationId}/settings`;
	return [
		{ key: "menu", done: input.products > 0, to: "/menu" },
		{ key: "team", done: input.withPin > 0, to: "/staff/new" },
		{ key: "tablet", done: input.tablets > 0, to: "/devices" },
		{ key: "order", done: input.orders > 0, to: branch },
	];
}

const key = (orgId: string) => `bite.admin.setup-hidden.${orgId}`;

/** "Hide this" is per business and per browser. */
export function setupHidden(orgId: string): boolean {
	try {
		return localStorage.getItem(key(orgId)) === "1";
	} catch {
		return false;
	}
}
export function hideSetup(orgId: string): void {
	try {
		localStorage.setItem(key(orgId), "1");
	} catch {
		// private mode: it comes back next visit
	}
}
