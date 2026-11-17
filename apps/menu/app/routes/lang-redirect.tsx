import { redirect } from "react-router";
import { negotiateLang } from "../lib/i18n";
import type { Route } from "./+types/lang-redirect";

/**
 * QR codes (/:slug) and group links (/:slug/group/:token) carry no language: pick the guest's.
 * The target is rebuilt from encoded params, never from the raw path, so it can't become an open redirect.
 */
export function loader({ request, params }: Route.LoaderArgs) {
	const lang = negotiateLang(request.headers.get("accept-language"));
	const p = params as { slug: string; token?: string };
	const group =
		p.token === undefined ? "" : `/group/${encodeURIComponent(p.token)}`;
	const search = new URL(request.url).search;
	return redirect(`/${lang}/${encodeURIComponent(p.slug)}${group}${search}`, {
		headers: { vary: "accept-language", "cache-control": "private, max-age=0" },
	});
}
