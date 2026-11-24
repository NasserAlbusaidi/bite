import { PlatformCreateOrg } from "@bite/contracts";
import { useState } from "react";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { AdminApiError } from "../lib/api-types";
import { platform } from "../lib/platform";
import type { PlatformKey } from "../lib/platform-i18n";
import type { Route } from "./+types/platform-new";
import { usePlatform } from "./platform";

const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);

export async function clientAction({ request }: Route.ClientActionArgs) {
	const api = platform();
	if (!api) return { error: "error" as PlatformKey };
	const f = await request.formData();
	const str = (k: string) => String(f.get(k) ?? "").trim();
	const parsed = PlatformCreateOrg.safeParse({
		orgName: str("orgName"),
		orgSlug: str("orgSlug").toLowerCase(),
		locationName: str("locationName"),
		locationSlug: str("locationSlug").toLowerCase(),
		timezone: str("timezone") || "Asia/Muscat",
		ownerName: str("ownerName"),
		ownerEmail: str("ownerEmail"),
		trialDays: Number(str("trialDays") || 30),
	});
	if (!parsed.success)
		return {
			error: "error" as PlatformKey,
			fields: parsed.error.issues.map((i) => String(i.path[0])),
		};
	try {
		const created = await api.createOrg(parsed.data);
		return { created, name: parsed.data.orgName };
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 409) {
			const field = (e.details as { field?: string } | undefined)?.field;
			return {
				error: "slug_taken" as PlatformKey,
				fields: field ? [field] : [],
			};
		}
		return { error: "error" as PlatformKey };
	}
}

export default function PlatformNew() {
	const { t, lang } = usePlatform();
	const res = useActionData<typeof clientAction>();
	const busy = useNavigation().state === "submitting";
	const [orgName, setOrgName] = useState("");
	const [branch, setBranch] = useState("");
	const [copied, setCopied] = useState(false);

	if (res && "created" in res && res.created) {
		const link = new URL(
			`/accept-invite?token=${encodeURIComponent(res.created.inviteToken)}`,
			window.location.origin,
		).toString();
		return (
			<section className="card form pf-created">
				<h1>{t("created_title", { name: res.name })}</h1>
				<label className="pf-field">
					<span className="small">{t("invite_link")}</span>
					<span className="pf-copy">
						<input className="input" readOnly value={link} dir="ltr" />
						<button
							type="button"
							className="btn"
							onClick={async () => {
								await navigator.clipboard?.writeText(link).catch(() => {});
								setCopied(true);
							}}
						>
							{copied ? t("copied") : t("copy")}
						</button>
					</span>
				</label>
				<p className="muted small">
					{t("invite_expires", {
						date: new Date(res.created.inviteExpiresAt).toLocaleDateString(
							lang === "ar" ? "ar-OM" : "en-GB",
						),
					})}
				</p>
				<div className="form-actions">
					<Link
						className="btn btn--primary"
						to={`/platform/orgs/${res.created.orgId}`}
					>
						{t("view_business")}
					</Link>
					<Link className="btn" to="/platform" reloadDocument>
						{t("back_to_list")}
					</Link>
				</div>
			</section>
		);
	}

	const bad = new Set(res && "fields" in res ? res.fields : []);
	const cls = (f: string) => `input${bad.has(f) ? " input--bad" : ""}`;
	return (
		<>
			<div className="page-head">
				<h1>{t("create_title")}</h1>
			</div>
			<p className="muted">{t("create_hint")}</p>
			<Form method="post" className="card form pf-form">
				<div className="grid2">
					<label className="pf-field">
						<span className="small">{t("org_name")}</span>
						<input
							className={cls("orgName")}
							name="orgName"
							required
							maxLength={80}
							value={orgName}
							onChange={(e) => setOrgName(e.target.value)}
						/>
					</label>
					<label className="pf-field">
						<span className="small">{t("org_slug")}</span>
						<input
							className={cls("orgSlug")}
							name="orgSlug"
							required
							dir="ltr"
							key={`o-${slugify(orgName)}`}
							defaultValue={slugify(orgName)}
						/>
					</label>
					<label className="pf-field">
						<span className="small">{t("location_name")}</span>
						<input
							className={cls("locationName")}
							name="locationName"
							required
							maxLength={80}
							value={branch}
							onChange={(e) => setBranch(e.target.value)}
						/>
					</label>
					<label className="pf-field">
						<span className="small">{t("location_slug")}</span>
						<input
							className={cls("locationSlug")}
							name="locationSlug"
							required
							dir="ltr"
							key={`l-${slugify(branch)}`}
							defaultValue={slugify(branch)}
						/>
					</label>
					<label className="pf-field">
						<span className="small">{t("owner_name")}</span>
						<input
							className={cls("ownerName")}
							name="ownerName"
							required
							maxLength={80}
						/>
					</label>
					<label className="pf-field">
						<span className="small">{t("owner_email")}</span>
						<input
							className={cls("ownerEmail")}
							name="ownerEmail"
							type="email"
							required
							dir="ltr"
						/>
					</label>
					<label className="pf-field">
						<span className="small">{t("timezone")}</span>
						<input
							className={cls("timezone")}
							name="timezone"
							defaultValue="Asia/Muscat"
							dir="ltr"
						/>
					</label>
					<label className="pf-field">
						<span className="small">{t("trial_days")}</span>
						<input
							className={cls("trialDays")}
							name="trialDays"
							type="number"
							min={0}
							max={365}
							defaultValue={30}
						/>
					</label>
				</div>
				{res && "error" in res && res.error && (
					<p className="error" role="alert">
						{t(res.error)}
					</p>
				)}
				<div className="form-actions">
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{t("create")}
					</button>
				</div>
			</Form>
		</>
	);
}
