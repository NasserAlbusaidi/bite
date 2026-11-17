import type { ErrorCode, GuestOrderRejectReason } from "./contracts";
import type { MessageKey } from "./i18n";

/** Map an API error to guest copy. Never show raw API messages to guests. */
export function errorMessageKey(
	code: ErrorCode,
	reason?: GuestOrderRejectReason,
): MessageKey {
	if (code === "unprocessable" && reason) {
		switch (reason) {
			case "not_accepting_orders":
				return "shop_closed";
			case "items_unavailable":
				return "items_unavailable";
			case "invalid_modifiers":
				return "invalid_modifiers";
			case "total_too_high":
				return "total_too_high";
			default:
				return "generic_error";
		}
	}
	if (code === "rate_limited") return "rate_limited";
	if (code === "idempotency_mismatch") return "idempotency_conflict";
	return "generic_error";
}
