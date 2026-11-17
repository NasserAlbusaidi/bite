import { data } from "react-router";
import { guestApi } from "../lib/api.server";
import type { Route } from "./+types/group-state";

/** Cheap poll target: the cart only, never cached. */
export async function loader({ params }: Route.LoaderArgs) {
	const cart = await guestApi().getGroupCart(params.token);
	if (!cart) throw data(null, { status: 404 });
	return data({ cart }, { headers: { "cache-control": "private, no-store" } });
}
