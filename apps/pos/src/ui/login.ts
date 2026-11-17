import type { ApiClient } from "../api/client.js";
import { type LoginResult, pinLogin } from "../auth/staff.js";
import type { SqlDriver } from "../db/driver.js";
import type { MessageKey } from "../i18n/messages.js";

/** PIN check: online first, the tablet's own verifier when the server can't be reached. */
export function loginWithPin(
	db: SqlDriver,
	api: ApiClient,
	memberId: string,
	pin: string,
): Promise<LoginResult> {
	return pinLogin(
		db,
		async (id, value) => {
			const r = await api.pinLogin(id, value);
			return {
				memberId: r.member.memberId,
				displayName: r.member.displayName,
				role: r.member.role,
			};
		},
		memberId,
		pin,
	);
}

export function loginError(
	t: (k: MessageKey, vars?: Record<string, string | number>) => string,
	res: Extract<LoginResult, { ok: false }>,
	name: string,
): string {
	switch (res.reason) {
		case "wrong_pin":
			return t("lock.wrong");
		case "offline_unknown":
			return t("lock.offlineUnknown", { name });
		case "offline_expired":
			return t("lock.offlineExpired");
		case "rate_limited":
			return t("lock.rateLimited");
		default:
			return res.message ?? "error";
	}
}
