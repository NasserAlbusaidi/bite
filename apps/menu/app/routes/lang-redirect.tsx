import { redirect } from "react-router";
import { negotiateLang } from "../lib/i18n";
import type { Route } from "./+types/lang-redirect";

/** QR codes (/:slug) and group links (/:slug/group/:token) carry no language: pick the guest's. */
export function loader({ request }: Route.LoaderArgs) {
	const lang = negotiateLang(request.headers.get("accept-language"));
	const url = new URL(request.url);
	return redirect(`/${lang}${url.pathname}${url.search}`, {
		headers: { vary: "accept-language", "cache-control": "private, max-age=0" },
	});
}
