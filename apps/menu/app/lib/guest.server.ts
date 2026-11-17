import { data } from "react-router";
import { guestApi } from "./api.server";
import { isLang, type Lang } from "./i18n";

/** Shared loader logic: 404 for an unknown language or location. */
export async function loadMenu(params: { lang?: string; slug?: string }) {
	const lang = params.lang;
	if (!isLang(lang) || !params.slug) throw data(null, { status: 404 });
	const menu = await guestApi().getMenu(params.slug);
	if (!menu) throw data(null, { status: 404 });
	return { lang: lang as Lang, ...menu };
}

/** The menu is the same for every guest: let a CDN hold it briefly. */
export const MENU_CACHE = "public, max-age=30, stale-while-revalidate=300";
