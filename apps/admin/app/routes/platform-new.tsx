import { PlatformCreateOrg } from "@bite/contracts";
import { Icon } from "@bite/ui";
import { type ReactNode, useState } from "react";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { Monogram } from "../components/platform-ui";
import { AdminApiError } from "../lib/api-types";
import { guestMenuUrl } from "../lib/links";
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
		return {
			created,
			name: parsed.data.orgName,
			email: parsed.data.ownerEmail,
		};
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
	const [orgSlug, setOrgSlug] = useState<string | null>(null);
	const [branch, setBranch] = useState("");
	const [branchSlug, setBranchSlug] = useState<string | null>(null);
	const [owner, setOwner] = useState("");
	const [email, setEmail] = useState("");
	const [trial, setTrial] = useState(30);
	const [copied, setCopied] = useState(false);

	if (res && "created" in res && res.created) {
		const link = new URL(
			`/accept-invite?token=${encodeURIComponent(res.created.inviteToken)}`,
			window.location.origin,
		).toString();
		return (
			<section className="pf-panel pf-created">
				<span className="pf-created__icon">
					<Icon name="check" />
				</span>
				<h1>{t("created_title", { name: res.name })}</h1>
				<label className="pf-field">
					<span>{t("invite_link")}</span>
					<span className="pf-copy">
						<input className="input" readOnly value={link} dir="ltr" />
						<button
							type="button"
							className="btn btn--primary pf-btn-icon"
							onClick={async () => {
								await navigator.clipboard?.writeText(link).catch(() => {});
								setCopied(true);
							}}
						>
							<Icon name={copied ? "check" : "copy"} />
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
				<h2 className="pf-sub">{t("next_steps")}</h2>
				<ol className="pf-steps">
					<li>{t("next_send", { email: res.email })}</li>
					<li>{t("next_signup")}</li>
					<li>{t("next_setup")}</li>
				</ol>
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
	const oSlug = orgSlug ?? slugify(orgName);
	const lSlug = branchSlug ?? slugify(branch);
	const menu = lSlug ? (guestMenuUrl(lSlug) ?? `/${lSlug}`) : null;

	return (
		<>
			<Link className="pf-back" to="/platform">
				<Icon name="arrow-back" />
				{t("back_to_list")}
			</Link>
			<div className="pf-head">
				<div>
					<h1>{t("create_title")}</h1>
					<p className="muted">{t("create_hint")}</p>
				</div>
			</div>
			<div className="pf-create">
				<Form method="post" className="pf-panel pf-form">
					<Section icon="store" title={t("section_business")}>
						<Field label={t("org_name")}>
							<input
								className={cls("orgName")}
								name="orgName"
								required
								maxLength={80}
								value={orgName}
								onChange={(e) => setOrgName(e.target.value)}
							/>
						</Field>
						<Field label={t("org_slug")}>
							<input
								className={cls("orgSlug")}
								name="orgSlug"
								required
								dir="ltr"
								value={oSlug}
								onChange={(e) => setOrgSlug(e.target.value)}
							/>
						</Field>
					</Section>
					<Section icon="home" title={t("section_branch")}>
						<Field label={t("location_name")}>
							<input
								className={cls("locationName")}
								name="locationName"
								required
								maxLength={80}
								value={branch}
								onChange={(e) => setBranch(e.target.value)}
							/>
						</Field>
						<Field label={t("location_slug")}>
							<input
								className={cls("locationSlug")}
								name="locationSlug"
								required
								dir="ltr"
								value={lSlug}
								onChange={(e) => setBranchSlug(e.target.value)}
							/>
						</Field>
						<Field label={t("timezone")}>
							<input
								className={cls("timezone")}
								name="timezone"
								defaultValue="Asia/Muscat"
								dir="ltr"
							/>
						</Field>
					</Section>
					<Section icon="user" title={t("section_owner")}>
						<Field label={t("owner_name")}>
							<input
								className={cls("ownerName")}
								name="ownerName"
								required
								maxLength={80}
								value={owner}
								onChange={(e) => setOwner(e.target.value)}
							/>
						</Field>
						<Field label={t("owner_email")}>
							<input
								className={cls("ownerEmail")}
								name="ownerEmail"
								type="email"
								required
								dir="ltr"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
							/>
						</Field>
					</Section>
					<Section icon="clock" title={t("section_start")}>
						<Field label={t("trial_days")}>
							<input
								className={cls("trialDays")}
								name="trialDays"
								type="number"
								min={0}
								max={365}
								value={trial}
								onChange={(e) => setTrial(Number(e.target.value) || 0)}
							/>
						</Field>
					</Section>
					{res && "error" in res && res.error && (
						<p className="error" role="alert">
							{t(res.error)}
						</p>
					)}
					<div className="form-actions">
						<button
							type="submit"
							className="btn btn--primary pf-btn-icon"
							disabled={busy}
						>
							<Icon name="plus" />
							{t("create")}
						</button>
					</div>
				</Form>

				<aside className="pf-panel pf-preview" aria-live="polite">
					<h2 className="pf-sub">{t("preview_title")}</h2>
					{orgName ? (
						<>
							<div className="pf-who">
								<Monogram id={oSlug || "x"} name={orgName} size="lg" />
								<span>
									<strong className="pf-preview__name">{orgName}</strong>
									<span className="pf-who__sub" dir="ltr">
										{oSlug}
									</span>
								</span>
							</div>
							<dl className="pf-preview__list">
								{branch && (
									<div>
										<dt>
											<Icon name="home" />
											{t("section_branch")}
										</dt>
										<dd>{branch}</dd>
									</div>
								)}
								{menu && (
									<div>
										<dt>
											<Icon name="qr" />
											{t("preview_menu")}
										</dt>
										<dd dir="ltr">{menu}</dd>
									</div>
								)}
								{(owner || email) && (
									<div>
										<dt>
											<Icon name="user" />
											{t("preview_owner")}
										</dt>
										<dd>
											{owner}
											{email && (
												<span className="pf-who__sub" dir="ltr">
													{email}
												</span>
											)}
											<span className="pf-who__sub">
												{t("preview_owner_hint")}
											</span>
										</dd>
									</div>
								)}
								<div>
									<dt>
										<Icon name="tag" />
										{t("plan")}
									</dt>
									<dd>
										{trial > 0
											? t("preview_trial", { n: trial })
											: t("preview_free")}
									</dd>
								</div>
							</dl>
						</>
					) : (
						<p className="muted small">{t("preview_empty")}</p>
					)}
				</aside>
			</div>
		</>
	);
}

function Section({
	icon,
	title,
	children,
}: {
	icon: "store" | "home" | "user" | "clock";
	title: string;
	children: ReactNode;
}) {
	return (
		<fieldset className="pf-section">
			<legend>
				<Icon name={icon} />
				{title}
			</legend>
			<div className="pf-section__fields">{children}</div>
		</fieldset>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is the child input
		<label className="pf-field">
			<span>{label}</span>
			{children}
		</label>
	);
}
