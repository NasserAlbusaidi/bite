import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * The table a guest is sitting at, from the table QR (`/<slug>?table=7`).
 * Kept in sessionStorage per shop: it survives moving between the menu and
 * checkout, and is gone when the guest closes the tab (the next visit scans
 * a new table). Never sent anywhere but the order.
 */
const key = (slug: string) => `bite.table.${slug}`;

/** Trim, collapse spaces, 1-20 chars; anything else is not a table label. */
export function cleanTable(raw: string | null | undefined): string | null {
	const v = (raw ?? "").replace(/\s+/g, " ").trim();
	return v.length >= 1 && v.length <= 20 ? v : null;
}

function read(slug: string): string | null {
	try {
		return cleanTable(sessionStorage.getItem(key(slug)));
	} catch {
		return null;
	}
}

export function rememberTable(slug: string, label: string | null) {
	try {
		if (label) sessionStorage.setItem(key(slug), label);
		else sessionStorage.removeItem(key(slug));
	} catch {
		// Private mode or blocked storage: the guest can still type the table.
	}
}

/**
 * The guest's table: `?table=` in the address wins (and is remembered), so it
 * is known on the server render too; otherwise what this tab remembered,
 * which only arrives after hydration.
 */
export function useTable(slug: string): string | null {
	const [params] = useSearchParams();
	const fromUrl = cleanTable(params.get("table"));
	const [stored, setStored] = useState<string | null>(null);
	useEffect(() => {
		if (fromUrl) rememberTable(slug, fromUrl);
		else setStored(read(slug));
	}, [slug, fromUrl]);
	return fromUrl ?? stored;
}
