import { createCookie } from "react-router";

/**
 * The remembered-guest token per shop, in an httpOnly cookie: page scripts
 * never see it, our server routes forward it to the API. One map so a guest
 * of several shops keeps each (oldest dropped past the cap).
 */
const MAX = 8;
const cookie = createCookie("bite_guest", {
	httpOnly: true,
	sameSite: "lax",
	path: "/",
	secure: process.env.NODE_ENV === "production",
	maxAge: 365 * 86_400,
});

const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

async function readAll(request: Request): Promise<Record<string, string>> {
	try {
		const raw: unknown = await cookie.parse(request.headers.get("cookie"));
		if (!raw || typeof raw !== "object") return {};
		return Object.fromEntries(
			Object.entries(raw as Record<string, unknown>).filter(
				(e): e is [string, string] =>
					typeof e[1] === "string" && TOKEN.test(e[1]),
			),
		);
	} catch {
		return {};
	}
}

export async function guestToken(
	request: Request,
	slug: string,
): Promise<string | null> {
	return (await readAll(request))[slug] ?? null;
}

/** Set-Cookie value that remembers this shop's token (newest last). */
export async function rememberGuest(
	request: Request,
	slug: string,
	token: string,
): Promise<string> {
	const all = await readAll(request);
	delete all[slug];
	const kept = Object.entries(all).slice(-(MAX - 1));
	return cookie.serialize(Object.fromEntries([...kept, [slug, token]]));
}

/** Set-Cookie value that forgets this shop's token ("not you?"). */
export async function forgetGuest(
	request: Request,
	slug: string,
): Promise<string> {
	const all = await readAll(request);
	delete all[slug];
	return cookie.serialize(all);
}
