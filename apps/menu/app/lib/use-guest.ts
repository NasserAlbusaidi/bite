import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { GuestProfile } from "./contracts";

/**
 * The remembered guest for this shop, loaded after hydration from our own
 * no-store route (the menu HTML is cached and shared, so it can't carry it).
 * null while loading and for a guest we don't know.
 */
export function useGuest(lang: string, slug: string) {
	const fetcher = useFetcher<{ guest: GuestProfile | null }>();
	const href = `/${lang}/${slug}/me`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: load once per shop
	useEffect(() => {
		if (fetcher.state === "idle" && !fetcher.data) fetcher.load(href);
	}, [href]);
	return {
		guest: fetcher.data?.guest ?? null,
		forget: () => fetcher.submit(null, { method: "post", action: href }),
	};
}
