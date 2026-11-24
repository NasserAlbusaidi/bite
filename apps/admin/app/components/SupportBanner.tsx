import { Icon } from "@bite/ui";
import { useNavigate } from "react-router";
import { saveOrg } from "../lib/account";
import type { Lang } from "../lib/i18n";
import { platformT } from "../lib/platform-i18n";
import "../platform.css";

/**
 * Shown across the back office while a platform admin is in an org's
 * support view (GET /v1/admin/me says `support`). The API refuses writes.
 */
export function SupportBanner({
	orgId,
	orgName,
	lang,
}: {
	orgId: string;
	orgName: string;
	lang: Lang;
}) {
	const t = platformT(lang);
	const navigate = useNavigate();
	return (
		<p className="pf-support" role="status">
			<span className="pf-support__text">
				<Icon name="eye" />
				{t("support_banner", { name: orgName })}
			</span>
			<button
				type="button"
				onClick={() => {
					saveOrg(null);
					navigate(`/platform/orgs/${orgId}`);
				}}
			>
				<Icon name="arrow-back" />
				{t("support_exit")}
			</button>
		</p>
	);
}
