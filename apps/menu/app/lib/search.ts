import type { MenuProduct } from "./contracts";

/**
 * Fold text for forgiving search: case, Latin accents, Arabic diacritics and
 * tatweel, and the letter variants guests type interchangeably
 * (أ إ آ → ا, ة → ه, ى → ي).
 */
export function fold(s: string): string {
	return s
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[ً-ٰٟـ]/g, "")
		.replace(/[أإآٱ]/g, "ا")
		.replace(/ة/g, "ه")
		.replace(/ى/g, "ي")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/** Every word of the query must appear in the product's names or descriptions. */
export function matcher(query: string): ((p: MenuProduct) => boolean) | null {
	const words = fold(query).split(" ").filter(Boolean);
	if (words.length === 0) return null;
	const cache = new WeakMap<MenuProduct, string>();
	return (p) => {
		let hay = cache.get(p);
		if (hay === undefined) {
			hay = fold(
				[p.name.en, p.name.ar, p.description?.en, p.description?.ar]
					.filter(Boolean)
					.join(" "),
			);
			cache.set(p, hay);
		}
		return words.every((w) => hay.includes(w));
	};
}
