import {
	AcceptedInvite,
	AccountOrgs,
	CreatedOrg,
	type CreateOrg,
	ErrorBody,
	ORG_HEADER,
} from "@bite/contracts";
import { z } from "zod";
import { AdminApiError } from "./api-types";

export { ORG_HEADER };

/** Better Auth's session shape, only the parts we read. */
const Session = z
	.object({
		user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
	})
	.nullable();
export type Session = z.infer<typeof Session>;

/**
 * Login and org choice, before /v1/admin. Better Auth lives under /v1/auth
 * (email + password, session cookie); /v1/account lists and creates orgs and
 * accepts invites. Everything goes with credentials so the cookie rides along.
 */
export function accountApi(baseUrl: string, fetchImpl: typeof fetch = fetch) {
	async function call<S extends z.ZodType>(
		schema: S,
		path: string,
		body?: unknown,
	): Promise<z.infer<S>> {
		const res = await fetchImpl(new URL(path, baseUrl), {
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
			// Better Auth errors are {code, message}, not our envelope.
			const code = err.success
				? err.data.error.code
				: typeof (json as { code?: unknown } | null)?.code === "string"
					? String((json as { code: string }).code)
					: "internal";
			throw new AdminApiError(code, res.status);
		}
		return schema.parse(json);
	}
	return {
		session: () => call(Session, "/v1/auth/get-session"),
		signIn: (email: string, password: string) =>
			call(z.unknown(), "/v1/auth/sign-in/email", { email, password }),
		signUp: (name: string, email: string, password: string) =>
			call(z.unknown(), "/v1/auth/sign-up/email", { name, email, password }),
		signOut: () => call(z.unknown(), "/v1/auth/sign-out", {}),
		orgs: () => call(AccountOrgs, "/v1/account/orgs"),
		createOrg: (o: CreateOrg) => call(CreatedOrg, "/v1/account/orgs", o),
		acceptInvite: (token: string) =>
			call(AcceptedInvite, "/v1/account/invites/accept", { token }),
	};
}
export type AccountApi = ReturnType<typeof accountApi>;

const ORG_KEY = "bite.admin.org";

/** The org this browser works in, for logins that belong to several. */
export function savedOrg(): string | undefined {
	try {
		return localStorage.getItem(ORG_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}
export function saveOrg(id: string | null) {
	try {
		if (id) localStorage.setItem(ORG_KEY, id);
		else localStorage.removeItem(ORG_KEY);
	} catch {
		// private mode: the org picker asks again next time
	}
}

/** Only same-app paths, so ?next= can't bounce a fresh login off-site. */
export function safeNext(next: string | null): string {
	if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\"))
		return "/";
	return next;
}

/** Where the shell sends you when /v1/admin refuses. */
export function adminGate(
	e: unknown,
	here: string,
): { to: string; clearOrg?: true } | null {
	if (!(e instanceof AdminApiError)) return null;
	const next = `?next=${encodeURIComponent(here)}`;
	if (e.status === 401) return { to: `/sign-in${next}` };
	if (e.status === 400 && e.code === "bad_request") {
		const d = e.details as { orgIds?: unknown } | undefined;
		if (Array.isArray(d?.orgIds)) return { to: `/orgs${next}` };
	}
	// A saved org we no longer belong to, or no org at all: pick or create one.
	if (e.status === 403) return { to: `/orgs${next}&denied=1`, clearOrg: true };
	return null;
}
