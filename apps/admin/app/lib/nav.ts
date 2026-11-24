import type { IconName } from "@bite/ui";
import type { MessageKey } from "./i18n";

export type NavGroup = "main" | "menu" | "business";

export type NavItem = {
	key: MessageKey;
	to: string;
	icon: IconName;
	group: NavGroup;
	/** Only active on the exact address (the overview at "/"). */
	end?: boolean;
};

/** The sidebar, in order. Branch pages need a branch. */
export function navItems(locationId: string | undefined): NavItem[] {
	const items: (NavItem | false)[] = [
		{ key: "overview", to: "/", icon: "home", group: "main", end: true },
		{ key: "reports", to: "/reports", icon: "chart", group: "main" },
		{ key: "menu", to: "/menu", icon: "book", group: "menu", end: true },
		{
			key: "modifier_groups",
			to: "/menu/modifiers",
			icon: "sliders",
			group: "menu",
		},
		!!locationId && {
			key: "prices_availability",
			to: `/locations/${locationId}/menu`,
			icon: "tag",
			group: "menu",
		},
		{ key: "promotions", to: "/promotions", icon: "percent", group: "menu" },
		{ key: "staff", to: "/staff", icon: "users", group: "business" },
		!!locationId && {
			key: "location_nav",
			to: `/locations/${locationId}/settings`,
			icon: "store",
			group: "business",
		},
	];
	return items.filter((x): x is NavItem => x !== false);
}

/**
 * The nav item the address belongs to: the longest matching prefix, so
 * /menu/modifiers/x is "Options", not "Menu". Branch pages match whichever
 * branch is in the address.
 */
export function currentNav(
	items: readonly NavItem[],
	pathname: string,
): NavItem | undefined {
	const norm = (p: string) =>
		p.replace(/^\/locations\/[^/]+\//, "/locations/:id/");
	const path = norm(pathname);
	let best: NavItem | undefined;
	for (const item of items) {
		const to = norm(item.to);
		const hit =
			to === "/"
				? path === "/"
				: path === to || path.startsWith(`${to}/`) || path === `${to}`;
		if (hit && (!best || to.length > norm(best.to).length)) best = item;
	}
	return best;
}

/**
 * Loose search for the command palette: every word of the query must start a
 * word in one of the texts (case and Arabic diacritics ignored). Returns a
 * score, higher is better, or 0 for no match.
 */
export function matchScore(query: string, ...texts: string[]): number {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return 1;
	let best = 0;
	for (const text of texts) {
		const t = fold(text);
		if (!t) continue;
		const starts = t.split(/[\s\-&/,.()]+/);
		let score = 0;
		for (const w of words) {
			if (t.startsWith(w)) score += 3;
			else if (starts.some((s) => s.startsWith(w))) score += 2;
			else if (t.includes(w)) score += 1;
			else {
				score = 0;
				break;
			}
		}
		best = Math.max(best, score);
	}
	return best;
}

const fold = (s: string) =>
	s
		.toLocaleLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
		.replace(/[أإآ]/g, "ا")
		.replace(/ة/g, "ه")
		.replace(/ى/g, "ي")
		.trim();
