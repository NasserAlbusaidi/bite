import type { MessageKey } from "./i18n";

/** Same floor and ceiling as the API's Better Auth config. */
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

export type PasswordForm =
	| { ok: true; current: string; next: string; signOutOthers: boolean }
	| {
			ok: false;
			errors: Partial<Record<"current" | "next" | "confirm", MessageKey>>;
	  };

/** Check a change-password form before it goes anywhere. */
export function parsePasswordForm(f: FormData): PasswordForm {
	const get = (k: string) => {
		const v = f.get(k);
		return typeof v === "string" ? v : "";
	};
	const current = get("current");
	const next = get("next");
	const errors: Partial<Record<"current" | "next" | "confirm", MessageKey>> =
		{};
	if (!current) errors.current = "required_field";
	if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD)
		errors.next = "password_hint";
	else if (next === current) errors.next = "password_same";
	if (get("confirm") !== next) errors.confirm = "password_mismatch";
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return {
		ok: true,
		current,
		next,
		signOutOthers: f.get("signOutOthers") === "on",
	};
}

/** What the API said about a password change, as a field error. */
export function passwordError(
	code: string,
): Partial<Record<"current" | "next", MessageKey>> {
	if (code === "INVALID_PASSWORD") return { current: "password_wrong" };
	if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG")
		return { next: "password_hint" };
	return { current: "password_change_failed" };
}
