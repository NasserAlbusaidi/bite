import { data } from "react-router";
import { guestApi } from "../lib/api.server";
import type { GuestProfile } from "../lib/contracts";
import { forgetGuest, guestToken } from "../lib/guest-token.server";
import { isLang } from "../lib/i18n";
import type { Route } from "./+types/guest";

/**
 * The remembered guest for this shop, as JSON for the menu and checkout to
 * load after hydration. Never cached: the menu HTML itself is public.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
	if (!isLang(params.lang)) throw data(null, { status: 404 });
	const token = await guestToken(request, params.slug);
	const guest: GuestProfile | null = token
		? await guestApi()
				.getGuest(params.slug, token)
				.catch(() => null)
		: null;
	return data({ guest }, { headers: { "cache-control": "private, no-store" } });
}

/** "Not you?": forget this phone's link to the guest. */
export async function action({ request, params }: Route.ActionArgs) {
	return data(
		{ guest: null },
		{ headers: { "set-cookie": await forgetGuest(request, params.slug) } },
	);
}
