import { redirect } from "react-router";
import { negotiateLang } from "../lib/i18n";
import type { Route } from "./+types/lang-redirect";

/** QR codes point at /:slug; send the guest to their language. */
export function loader({ request, params }: Route.LoaderArgs) {
	const lang = negotiateLang(request.headers.get("accept-language"));
	const url = new URL(request.url);
	return redirect(`/${lang}/${encodeURIComponent(params.slug)}${url.search}`, {
		headers: { vary: "accept-language", "cache-control": "private, max-age=0" },
	});
}
