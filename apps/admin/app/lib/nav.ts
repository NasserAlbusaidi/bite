import type { IconName } from "@bite/ui";
import type { MessageKey } from "./i18n";

export type NavGroup = "home" | "sales" | "menu" | "people" | "branch";

export type NavItem = {
	key: MessageKey;
	to: string;
	icon: IconName;
	group: NavGroup;
	/** Only active on the exact address (the overview at "/"). */
	end?: boolean;
	/** Keyboard shortcut: press G, then this key. */
	go?: string;
	/** Not listed in the panel (it has its own spot); search and G still reach it. */
	unlisted?: boolean;
};

/**
 * The rail: one labelled button per group, in order. Picking one shows that
 * group's pages in the panel next to it.
 */
export const NAV_GROUPS: readonly {
	id: NavGroup;
	label: MessageKey;
	icon: IconName;
}[] = [
	{ id: "home", label: "overview", icon: "home" },
	{ id: "sales", label: "nav_group_sales", icon: "receipt" },
	{ id: "menu", label: "menu", icon: "book" },
	{ id: "people", label: "nav_group_people", icon: "users" },
	{ id: "branch", label: "branch", icon: "store" },
];

/** The sidebar pages, in order. Branch pages need a branch. */
export function navItems(locationId: string | undefined): NavItem[] {
	const items: (NavItem | false)[] = [
		{
			key: "overview",
			to: "/",
			icon: "home",
			group: "home",
			end: true,
			go: "h",
		},
		{
			key: "setup_guide",
			to: "/setup",
			icon: "check",
			group: "home",
			go: "u",
			unlisted: true,
		},
		{
			key: "orders_title",
			to: "/orders",
			icon: "receipt",
			group: "sales",
			go: "o",
		},
		{
			key: "drawers_title",
			to: "/drawers",
			icon: "cash",
			group: "sales",
			go: "c",
		},
		{ key: "reports", to: "/reports", icon: "chart", group: "sales", go: "r" },
		{
			key: "menu",
			to: "/menu",
			icon: "book",
			group: "menu",
			end: true,
			go: "m",
		},
		{
			key: "modifier_groups",
			to: "/menu/modifiers",
			icon: "sliders",
			group: "menu",
			go: "x",
		},
		!!locationId && {
			key: "prices_availability",
			to: `/locations/${locationId}/menu`,
			icon: "tag",
			group: "menu",
			go: "p",
		},
		{
			key: "promotions",
			to: "/promotions",
			icon: "percent",
			group: "menu",
			go: "d",
		},
		{
			key: "guests_title",
			to: "/guests",
			icon: "user",
			group: "people",
			go: "g",
		},
		{
			key: "loyalty_title",
			to: "/loyalty",
			icon: "star",
			group: "people",
			go: "l",
		},
		{ key: "staff", to: "/staff", icon: "users", group: "people", go: "s" },
		!!locationId && {
			key: "floor_nav",
			to: `/locations/${locationId}/floor`,
			icon: "layout",
			group: "branch",
			go: "t",
		},
		!!locationId && {
			key: "dv_nav",
			to: "/devices",
			icon: "tablet",
			group: "branch",
			go: "v",
		},
		!!locationId && {
			key: "location_nav",
			to: `/locations/${locationId}/settings`,
			icon: "store",
			group: "branch",
			go: "b",
		},
	];
	return items.filter((x): x is NavItem => x !== false);
}

/** The rail groups that have pages, each with its pages in order. */
export function navGroups(items: readonly NavItem[]) {
	return NAV_GROUPS.flatMap((g) => {
		const list = items.filter((i) => i.group === g.id && !i.unlisted);
		const [first] = list;
		return first ? [{ ...g, items: list, first }] : [];
	});
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

/** Account is not in the sidebar but has its own shortcut. */
export const ACCOUNT_GO = "a";

/** Where G then `key` goes, or undefined. */
export function goTarget(
	items: readonly NavItem[],
	key: string,
): string | undefined {
	const k = key.toLowerCase();
	if (k === ACCOUNT_GO) return "/account";
	return items.find((i) => i.go === k)?.to;
}

/** True when a key press belongs to a text field, not to the shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	if (tag === "TEXTAREA" || tag === "SELECT") return true;
	if (tag !== "INPUT") return false;
	const type = (target as HTMLInputElement).type;
	return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
}
