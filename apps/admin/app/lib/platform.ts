import {
	ErrorBody,
	PlatformCreatedOrg,
	type PlatformCreateOrg,
	PlatformMe,
	PlatformOrgDetail,
	PlatformOrgList,
	type PlatformOrgQuery,
	type PlatformSetPlan,
	type PlatformSetStatus,
} from "@bite/contracts";
import type { z } from "zod";
import { AdminApiError } from "./api-types";

/**
 * Platform console (Bite's own operators) over /v1/platform. The API answers
 * 404 to anyone who is not a platform admin, signed in or not.
 */
export function platformApi(baseUrl: string, fetchImpl: typeof fetch = fetch) {
	async function call<S extends z.ZodType>(
		schema: S,
		path: string,
		body?: unknown,
	): Promise<z.infer<S>> {
		const res = await fetchImpl(new URL(`/v1/platform${path}`, baseUrl), {
			method: body === undefined ? "GET" : "POST",
			credentials: "include",
			headers: {
				accept: "application/json",
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const json: unknown = await res.json().catch(() => null);
		if (!res.ok) {
			const err = ErrorBody.safeParse(json);
			throw new AdminApiError(
				err.success ? err.data.error.code : "internal",
				res.status,
				err.success ? err.data.error.details : undefined,
			);
		}
		return schema.parse(json);
	}
	const enc = encodeURIComponent;
	return {
		me: () => call(PlatformMe, "/me"),
		orgs: (q: PlatformOrgQuery = {}) => {
			const p = new URLSearchParams();
			for (const [k, v] of Object.entries(q)) if (v) p.set(k, String(v));
			const s = p.toString();
			return call(PlatformOrgList, `/orgs${s ? `?${s}` : ""}`);
		},
		org: (id: string) => call(PlatformOrgDetail, `/orgs/${enc(id)}`),
		createOrg: (o: PlatformCreateOrg) => call(PlatformCreatedOrg, "/orgs", o),
		setStatus: (id: string, b: PlatformSetStatus) =>
			call(PlatformOrgDetail, `/orgs/${enc(id)}/status`, b),
		setPlan: (id: string, b: PlatformSetPlan) =>
			call(PlatformOrgDetail, `/orgs/${enc(id)}/plan`, b),
		extendTrial: (id: string, days: number) =>
			call(PlatformOrgDetail, `/orgs/${enc(id)}/trial`, { days }),
	};
}
export type PlatformApi = ReturnType<typeof platformApi>;

/** Null in demo mode (no VITE_API_URL): the console needs the real API. */
export function platform(): PlatformApi | null {
	const base = import.meta.env.VITE_API_URL as string | undefined;
	return base
		? platformApi(new URL(base, window.location.origin).toString())
		: null;
}

/** Whole days from now until `iso`, rounded up; negative once it has passed. */
export function daysUntil(iso: string, now = Date.now()): number {
	return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

/** "3 h ago", "2 d ago": compact, for the last-order column. */
export function ago(iso: string | null, now = Date.now()): string | null {
	if (!iso) return null;
	const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
	if (min < 60) return `${min}m`;
	const h = Math.round(min / 60);
	if (h < 48) return `${h}h`;
	return `${Math.round(h / 24)}d`;
}
