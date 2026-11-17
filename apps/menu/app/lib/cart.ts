import { add, type Minor, minor, sum, times, ZERO } from "@bite/core";
import type {
	MenuModifierGroup,
	MenuProduct,
	MenuSnapshot,
	OrderLineInput,
} from "./contracts";
import { uuidv7 } from "./uuid";

/**
 * Guest cart. Holds ids and quantities only, never prices: the server
 * re-prices on quote and submit. Estimates shown in the UI are computed
 * from the menu the guest is looking at and are labelled as such.
 */
export type CartLine = {
	key: string;
	productId: string;
	quantity: number;
	modifierOptionIds: string[];
	note?: string;
};

export type Cart = { lines: CartLine[] };

export const EMPTY_CART: Cart = { lines: [] };
export const MAX_QTY = 99;

export function lineKey(
	productId: string,
	modifierOptionIds: readonly string[],
	note?: string,
): string {
	return [
		productId,
		[...modifierOptionIds].sort().join("+"),
		note?.trim() ?? "",
	].join("|");
}

export type CartAction =
	| {
			type: "add";
			productId: string;
			modifierOptionIds: string[];
			note?: string;
			quantity?: number;
	  }
	| { type: "increment"; key: string }
	| { type: "decrement"; key: string }
	| { type: "remove"; key: string }
	| { type: "removeMany"; keys: string[] }
	| { type: "clear" };

export function cartReducer(cart: Cart, action: CartAction): Cart {
	switch (action.type) {
		case "add": {
			const note = action.note?.trim() || undefined;
			const key = lineKey(action.productId, action.modifierOptionIds, note);
			const qty = action.quantity ?? 1;
			const existing = cart.lines.find((l) => l.key === key);
			if (existing) {
				return {
					lines: cart.lines.map((l) =>
						l.key === key
							? { ...l, quantity: Math.min(MAX_QTY, l.quantity + qty) }
							: l,
					),
				};
			}
			const line: CartLine = {
				key,
				productId: action.productId,
				quantity: Math.min(MAX_QTY, qty),
				modifierOptionIds: [...action.modifierOptionIds].sort(),
				...(note ? { note } : {}),
			};
			return { lines: [...cart.lines, line] };
		}
		case "increment":
			return {
				lines: cart.lines.map((l) =>
					l.key === action.key
						? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) }
						: l,
				),
			};
		case "decrement":
			return {
				lines: cart.lines
					.map((l) =>
						l.key === action.key ? { ...l, quantity: l.quantity - 1 } : l,
					)
					.filter((l) => l.quantity > 0),
			};
		case "remove":
			return { lines: cart.lines.filter((l) => l.key !== action.key) };
		case "removeMany":
			return { lines: cart.lines.filter((l) => !action.keys.includes(l.key)) };
		case "clear":
			return EMPTY_CART;
	}
}

export function itemCount(cart: Cart): number {
	return cart.lines.reduce((n, l) => n + l.quantity, 0);
}

/** Order lines with fresh client ids, plus a map back to cart keys for errors. */
export function toLineInputs(cart: Cart): {
	lines: OrderLineInput[];
	keyById: Map<string, string>;
} {
	const keyById = new Map<string, string>();
	const lines = cart.lines.map((l) => {
		const id = uuidv7();
		keyById.set(id, l.key);
		return {
			id,
			productId: l.productId,
			quantity: l.quantity,
			modifierOptionIds: l.modifierOptionIds,
			...(l.note ? { note: l.note } : {}),
		};
	});
	return { lines, keyById };
}

export type MenuIndex = {
	products: Map<string, MenuProduct>;
	groups: Map<string, MenuModifierGroup>;
	optionGroup: Map<string, string>;
};

export function indexMenu(menu: MenuSnapshot): MenuIndex {
	const optionGroup = new Map<string, string>();
	for (const g of menu.modifierGroups)
		for (const o of g.options) optionGroup.set(o.id, g.id);
	return {
		products: new Map(menu.products.map((p) => [p.id, p])),
		groups: new Map(menu.modifierGroups.map((g) => [g.id, g])),
		optionGroup,
	};
}

export type SelectionError =
	| { kind: "min"; groupId: string; count: number }
	| { kind: "max"; groupId: string; count: number }
	| { kind: "invalid" };

/** Same rules the server enforces; checked client-side for fast feedback. */
export function validateSelection(
	product: MenuProduct,
	idx: MenuIndex,
	optionIds: readonly string[],
): SelectionError | null {
	if (new Set(optionIds).size !== optionIds.length) return { kind: "invalid" };
	for (const id of optionIds) {
		const gid = idx.optionGroup.get(id);
		if (!gid || !product.modifierGroupIds.includes(gid))
			return { kind: "invalid" };
		const opt = idx.groups.get(gid)?.options.find((o) => o.id === id);
		if (!opt?.isAvailable) return { kind: "invalid" };
	}
	for (const gid of product.modifierGroupIds) {
		const g = idx.groups.get(gid);
		if (!g) continue;
		const n = optionIds.filter((id) => idx.optionGroup.get(id) === gid).length;
		if (n < g.minSelect)
			return { kind: "min", groupId: gid, count: g.minSelect };
		if (n > g.maxSelect)
			return { kind: "max", groupId: gid, count: g.maxSelect };
	}
	return null;
}

/**
 * Display estimate only: list price + modifier deltas, no promotions yet.
 * TODO: switch to @bite/core pricing (promotions, tax) once it lands. The
 * order response from the server is the authoritative price either way.
 */
export function estimateUnit(
	product: MenuProduct,
	idx: MenuIndex,
	optionIds: readonly string[],
): Minor {
	const base = minor(product.price);
	const deltas = optionIds.map((id) => {
		const gid = idx.optionGroup.get(id);
		const opt = gid
			? idx.groups.get(gid)?.options.find((o) => o.id === id)
			: undefined;
		return minor(opt?.priceDelta ?? 0);
	});
	const unit = add(base, sum(deltas));
	return unit < 0 ? ZERO : unit;
}

/** Display estimate only. Unknown products count as zero. */
export function estimateCart(cart: Cart, idx: MenuIndex): Minor {
	return sum(
		cart.lines.map((l) => {
			const p = idx.products.get(l.productId);
			return p
				? times(estimateUnit(p, idx, l.modifierOptionIds), l.quantity)
				: ZERO;
		}),
	);
}

/** Parse an untrusted stored cart (localStorage); drop anything malformed. */
export function parseStoredCart(raw: string | null): Cart {
	if (!raw) return EMPTY_CART;
	try {
		const data: unknown = JSON.parse(raw);
		if (
			!data ||
			typeof data !== "object" ||
			!Array.isArray((data as Cart).lines)
		) {
			return EMPTY_CART;
		}
		let cart = EMPTY_CART;
		for (const l of (data as { lines: unknown[] }).lines) {
			if (!l || typeof l !== "object") continue;
			const { productId, quantity, modifierOptionIds, note } = l as Record<
				string,
				unknown
			>;
			if (typeof productId !== "string") continue;
			if (
				typeof quantity !== "number" ||
				!Number.isInteger(quantity) ||
				quantity < 1
			)
				continue;
			if (
				!Array.isArray(modifierOptionIds) ||
				!modifierOptionIds.every((x) => typeof x === "string")
			) {
				continue;
			}
			cart = cartReducer(cart, {
				type: "add",
				productId,
				modifierOptionIds: modifierOptionIds as string[],
				quantity,
				...(typeof note === "string" ? { note } : {}),
			});
		}
		return cart;
	} catch {
		return EMPTY_CART;
	}
}
