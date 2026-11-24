import { Badge, Icon } from "@bite/ui";
import type { AdminStaff } from "../lib/contracts";
import type { T } from "../lib/i18n";
import { isPending } from "../lib/staff-list";

/** Where someone works, current branch first. */
export function Roles({
	s,
	names,
	current,
	t,
}: {
	s: AdminStaff;
	names: Map<string, string>;
	current: string | undefined;
	t: T;
}) {
	if (s.orgRole === "owner" || s.orgRole === "admin")
		return (
			<Badge tone="brand">
				{t(`role_${s.orgRole}_short`)} · {t("staff_everywhere")}
			</Badge>
		);
	if (s.locations.length === 0) return <span className="muted">—</span>;
	const sorted = [...s.locations].sort(
		(a, b) =>
			Number(b.locationId === current) - Number(a.locationId === current),
	);
	return (
		<>
			{sorted.map((l) => (
				<Badge
					key={l.locationId}
					tone={l.locationId === current ? "success" : "neutral"}
				>
					{t("role_at", {
						role: t(`role_${l.role}`),
						place: names.get(l.locationId) ?? "?",
					})}
				</Badge>
			))}
		</>
	);
}

/** How they sign in, or why they can't. */
export function SignIn({ s, t }: { s: AdminStaff; t: T }) {
	if (!s.isActive) return <Badge tone="danger">{t("deactivated")}</Badge>;
	if (isPending(s)) return <Badge tone="warning">{t("invite_pending")}</Badge>;
	return (
		<>
			{s.email && (
				<span className="signin-tag">
					<Icon name="user" size={14} />
					{t("login")}
				</span>
			)}
			{s.hasPin && (
				<span className="signin-tag">
					<Icon name="key" size={14} />
					{t("pin")}
				</span>
			)}
		</>
	);
}
