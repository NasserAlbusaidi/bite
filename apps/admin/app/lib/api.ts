import { accountApi, savedOrg } from "./account";
import type { AdminApi } from "./api-types";
import { fixtureAdminApi } from "./fixtures";
import { httpAdminApi } from "./http";

export { type AdminApi, AdminApiError } from "./api-types";

let instance: AdminApi | undefined;

/**
 * VITE_API_URL, resolved against the page origin so "/" (dev proxy) works.
 * Unset: undefined, which means in-browser demo data.
 */
function apiBase(): string | undefined {
	const base = import.meta.env.VITE_API_URL as string | undefined;
	return base ? new URL(base, window.location.origin).toString() : undefined;
}

/** VITE_API_URL set: real API with the session cookie. Unset: in-browser demo data. */
export function adminApi(): AdminApi {
	if (!instance) {
		const base = apiBase();
		instance = base ? httpAdminApi(base, fetch, savedOrg) : fixtureAdminApi();
	}
	return instance;
}

export const isDemo = () => !import.meta.env.VITE_API_URL;

/** Sign-in and org choice. Only exists against a real API. */
export function account() {
	const base = apiBase();
	return base ? accountApi(base) : undefined;
}
