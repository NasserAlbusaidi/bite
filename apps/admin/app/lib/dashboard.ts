import type {
	AdminMenu,
	AdminOrderRow,
	LocationProduct,
	SalesReport,
} from "./contracts";
import { missingChoices } from "./modifier-form";
import type { Place } from "./places";

/** One branch's numbers for the overview: today so far, yesterday, last 7 days. */
export type BranchDay = {
	place: Place;
	/** The branch's business date right now. */
	date: string;
	today: SalesReport;
	yesterday: SalesReport;
	week: SalesReport;
};

/** Money actually taken, all methods, refunds already netted. */
export const taken = (r: SalesReport) =>
	r.byMethod.reduce((s, m) => s + m.amount, 0);

/** Average order from the charged total. Integer minor units. */
export const averageOrder = (r: SalesReport) =>
	r.orderCount ? Math.trunc(r.total / r.orderCount) : 0;

/**
 * All branches added up. Null when they don't share a currency: adding rials
 * to dirhams is a number that means nothing.
 */
export function totals(rows: readonly BranchDay[]) {
	const first = rows[0];
	if (!first) return null;
	if (rows.some((r) => r.place.currencyCode !== first.place.currencyCode))
		return null;
	const sum = (f: (r: BranchDay) => number) =>
		rows.reduce((s, r) => s + f(r), 0);
	return {
		currencyCode: first.place.currencyCode,
		decimals: first.place.decimals,
		net: sum((r) => r.today.net),
		orders: sum((r) => r.today.orderCount),
		yesterday: sum((r) => r.yesterday.net),
		week: sum((r) => r.week.net),
	};
}

/** Bar length, 0 to 100, against the best branch. */
export function share(value: number, max: number): number {
	if (max <= 0 || value <= 0) return 0;
	return Math.min(100, Math.max(2, Math.round((value / max) * 100)));
}

export type Attention =
	| { kind: "unpaid"; count: number; more: boolean; to: string }
	| { kind: "sold_out"; count: number; to: string }
	| { kind: "choices_out"; count: number; to: string }
	| { kind: "blocked"; count: number; to: string };

/** Things at the selected branch somebody should look at, worst first. */
export function attention(input: {
	locationId: string;
	date: string;
	unpaid: { items: readonly AdminOrderRow[]; nextCursor?: string | undefined };
	products: readonly LocationProduct[];
	menu: AdminMenu;
}): Attention[] {
	const out: Attention[] = [];
	const live = input.menu.products.filter((p) => !p.archivedAt);
	const blocked = input.menu.modifierGroups.filter(
		(g) =>
			missingChoices(g) > 0 &&
			live.some((p) => p.modifierGroupIds.includes(g.id)),
	).length;
	if (blocked > 0)
		out.push({ kind: "blocked", count: blocked, to: "/menu/modifiers" });
	const waiting = input.unpaid.items.filter(
		(o) => o.fulfillmentStatus !== "cancelled",
	).length;
	if (waiting > 0)
		out.push({
			kind: "unpaid",
			count: waiting,
			more: Boolean(input.unpaid.nextCursor),
			to: `/reports?from=${input.date}&to=${input.date}&payment=unpaid`,
		});
	const soldOut = input.products.filter((p) => !p.isAvailable).length;
	if (soldOut > 0)
		out.push({
			kind: "sold_out",
			count: soldOut,
			to: `/locations/${input.locationId}/menu`,
		});
	const choicesOut = input.menu.modifierGroups
		.flatMap((g) => g.options)
		.filter((o) => !o.isAvailable).length;
	if (choicesOut > 0)
		out.push({ kind: "choices_out", count: choicesOut, to: "/menu/modifiers" });
	return out;
}
