import { guestApi } from "../lib/api.server";
import type { Route } from "./+types/order-status";

/**
 * GET only, JSON: is this order still open? The menu asks so its
 * "your order · track it" link disappears once the till cancels or completes
 * the order, even if the guest never reopens the tracker.
 */
export async function loader({ params }: Route.LoaderArgs) {
	const headers = { "cache-control": "private, no-store" };
	let order: Awaited<ReturnType<ReturnType<typeof guestApi>["getOrder"]>>;
	try {
		order = await guestApi().getOrder(params.token);
	} catch {
		// API unreachable: say nothing, keep the link.
		return Response.json({ open: true }, { headers });
	}
	const open =
		!!order &&
		order.fulfillmentStatus !== "cancelled" &&
		order.fulfillmentStatus !== "completed";
	return Response.json({ open }, { headers });
}
