import { Icon, type IconName } from "@bite/ui";
import type { ReactNode } from "react";
import type { PT } from "../lib/platform-i18n";

/** Two letters for a business or person, from its name. */
export function initials(name: string): string {
	const words = name
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.filter(Boolean);
	const first = words[0]?.[0] ?? "?";
	const second =
		words.length > 1 ? (words[1]?.[0] ?? "") : (words[0]?.[1] ?? "");
	return (first + second).toUpperCase();
}

/** One of four token tints, stable per id, so rows are easy to tell apart. */
export function tintOf(id: string): number {
	let h = 0;
	for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return h % 4;
}

export function Monogram({
	id,
	name,
	size = "md",
}: {
	id: string;
	name: string;
	size?: "sm" | "md" | "lg";
}) {
	return (
		<span
			className={`pf-mono pf-mono--${size} pf-mono--t${tintOf(id)}`}
			aria-hidden="true"
		>
			{initials(name)}
		</span>
	);
}

export type Pulse = "live" | "today" | "quiet" | "never";

/** How recently the business took an order. */
export function pulseOf(lastOrderAt: string | null, now = Date.now()): Pulse {
	if (!lastOrderAt) return "never";
	const min = (now - new Date(lastOrderAt).getTime()) / 60_000;
	if (min < 60) return "live";
	if (min < 24 * 60) return "today";
	return "quiet";
}

/** "12 min ago", "3 h ago", "4 days ago". */
export function agoText(t: PT, iso: string, now = Date.now()): string {
	const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
	if (min < 60) return t("ago_m", { n: min });
	const h = Math.round(min / 60);
	if (h < 48) return t("ago_h", { n: h });
	return t("ago_d", { n: Math.round(h / 24) });
}

export function PulseLabel({
	t,
	lastOrderAt,
}: {
	t: PT;
	lastOrderAt: string | null;
}) {
	const p = pulseOf(lastOrderAt);
	return (
		<span className={`pf-pulse pf-pulse--${p}`}>
			<span className="pf-pulse__dot" aria-hidden="true" />
			<span>{lastOrderAt ? agoText(t, lastOrderAt) : t("pulse_never")}</span>
		</span>
	);
}

export function Kpi({
	icon,
	label,
	value,
	children,
}: {
	icon: IconName;
	label: string;
	value: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="pf-kpi">
			<span className="pf-kpi__label">
				<Icon name={icon} />
				{label}
			</span>
			<strong className="pf-kpi__value">{value}</strong>
			{children && <span className="pf-kpi__sub">{children}</span>}
		</div>
	);
}

/** A thin bar for a share of a total, 0..1. */
export function ShareBar({ share, label }: { share: number; label?: string }) {
	const pct = Math.max(0, Math.min(1, share)) * 100;
	return (
		<span
			className="pf-share"
			title={label}
			aria-hidden={label ? undefined : true}
		>
			<span style={{ inlineSize: `${pct}%` }} />
		</span>
	);
}
