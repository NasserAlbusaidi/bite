import { data } from "react-router";
import { guestApi } from "../lib/api.server";
import { isLang } from "../lib/i18n";
import { cleanTable } from "../lib/table";
import type { Route } from "./+types/service";

export type ServiceActionResult =
	| { ok: true; kind: "waiter" | "bill"; at: string }
	| { ok: false };

/** POST only: a guest calls a waiter or asks for the bill at their table. */
export async function action({
	request,
	params,
}: Route.ActionArgs): Promise<ServiceActionResult> {
	if (!isLang(params.lang)) throw data(null, { status: 404 });
	const form = await request.formData();
	const kind = form.get("kind");
	const table = cleanTable(String(form.get("table") ?? ""));
	if ((kind !== "waiter" && kind !== "bill") || !table) return { ok: false };
	try {
		const r = await guestApi().callService(params.slug, kind, table);
		return { ok: true, kind, at: r.createdAt };
	} catch (e) {
		console.error("service call failed", e);
		return { ok: false };
	}
}
