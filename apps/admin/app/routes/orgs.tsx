import { CreateOrg } from "@bite/contracts";
import { Form, redirect, useNavigation, useSearchParams } from "react-router";
import { safeNext, saveOrg } from "../lib/account";
import { account } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import { AuthFrame, useAuthLang } from "../lib/auth-page";
import type { MessageKey } from "../lib/i18n";
import type { Route } from "./+types/orgs";

/** Pick which business to work in, or set up the first one. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const acc = account();
	if (!acc) throw redirect("/");
	const url = new URL(request.url);
	const session = await acc.session().catch(() => null);
	if (!session)
		throw redirect(
			`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`,
		);
	const { items } = await acc.orgs();
	const denied = url.searchParams.get("denied") === "1";
	// One org and nothing went wrong: no point asking (unless switching).
	const switching = url.searchParams.has("switch");
	if (items.length === 1 && !denied && !switching && items[0]) {
		saveOrg(items[0].id);
		throw redirect(safeNext(url.searchParams.get("next")));
	}
	return { orgs: items, email: session.user.email, denied };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const acc = account();
	if (!acc) return redirect("/");
	const f = await request.formData();
	const next = safeNext(new URL(request.url).searchParams.get("next"));
	if (f.get("intent") === "pick") {
		saveOrg(String(f.get("orgId") ?? "") || null);
		return redirect(next);
	}
	const parsed = CreateOrg.safeParse({
		orgName: f.get("orgName"),
		orgSlug: String(f.get("orgSlug") ?? "")
			.trim()
			.toLowerCase(),
		locationName: f.get("locationName"),
		locationSlug: String(f.get("locationSlug") ?? "")
			.trim()
			.toLowerCase(),
	});
	if (!parsed.success) return { error: "check_fields" as MessageKey };
	try {
		const created = await acc.createOrg(parsed.data);
		saveOrg(created.orgId);
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 409)
			return { error: "slug_taken" as MessageKey };
		throw e;
	}
	return redirect("/");
}

export default function Orgs({ loaderData, actionData }: Route.ComponentProps) {
	const { orgs, email, denied } = loaderData;
	const { t } = useAuthLang();
	const [params] = useSearchParams();
	const busy = useNavigation().state !== "idle";
	return (
		<AuthFrame
			title={orgs.length ? t("choose_business") : t("set_up_business")}
		>
			<p className="muted small">{t("signed_in_as", { email })}</p>
			{denied && orgs.length > 0 && (
				<p className="error small" role="alert">
					{t("no_back_office_access")}
				</p>
			)}
			{orgs.map((o) => (
				<Form method="post" key={o.id} action={`?${params.toString()}`}>
					<input type="hidden" name="intent" value="pick" />
					<input type="hidden" name="orgId" value={o.id} />
					<button type="submit" className="btn org-pick" disabled={busy}>
						<strong>{o.name}</strong>
						<span className="muted small">{t(`org_${o.orgRole}`)}</span>
					</button>
				</Form>
			))}
			<details open={orgs.length === 0}>
				<summary>{t("new_business")}</summary>
				<Form method="post" className="form">
					<input type="hidden" name="intent" value="create" />
					<label>
						{t("business_name")}
						<input name="orgName" className="input" required maxLength={80} />
					</label>
					<label>
						{t("business_slug")}
						<input
							name="orgSlug"
							className="input"
							dir="ltr"
							required
							pattern="[a-z0-9]+(-[a-z0-9]+)*"
							minLength={3}
							maxLength={48}
						/>
					</label>
					<label>
						{t("first_location")}
						<input
							name="locationName"
							className="input"
							required
							maxLength={80}
						/>
					</label>
					<label>
						{t("location_slug")}
						<input
							name="locationSlug"
							className="input"
							dir="ltr"
							required
							pattern="[a-z0-9]+(-[a-z0-9]+)*"
							minLength={3}
							maxLength={48}
						/>
						<span className="muted small">{t("location_slug_hint")}</span>
					</label>
					{actionData?.error && (
						<span className="error small" role="alert">
							{t(actionData.error)}
						</span>
					)}
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{t("create_business")}
					</button>
				</Form>
			</details>
		</AuthFrame>
	);
}
