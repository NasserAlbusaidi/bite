import type { AdminApi } from "./api-types";
import { fixtureAdminApi } from "./fixtures";
import { httpAdminApi } from "./http";

export { type AdminApi, AdminApiError } from "./api-types";

let instance: AdminApi | undefined;

/** VITE_API_URL set: real API with the session cookie. Unset: in-browser demo data. */
export function adminApi(): AdminApi {
	if (!instance) {
		const base = import.meta.env.VITE_API_URL as string | undefined;
		instance = base ? httpAdminApi(base) : fixtureAdminApi();
	}
	return instance;
}

export const isDemo = () => !import.meta.env.VITE_API_URL;
