import { data } from "react-router";
import { createGroup } from "../lib/group.server";
import { isLang } from "../lib/i18n";
import type { Route } from "./+types/group-new";

/** POST only: start a group cart. The caller becomes the host. */
export async function action({ request, params }: Route.ActionArgs) {
	if (!isLang(params.lang)) throw data(null, { status: 404 });
	const form = await request.formData();
	const name = form.get("displayName");
	return createGroup(
		request,
		params.slug,
		typeof name === "string" ? name : "",
	);
}
