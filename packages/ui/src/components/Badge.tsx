import type { ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

/** A short status label. Colour is never the only signal: keep the words. */
export function Badge({
	tone = "neutral",
	className,
	children,
}: {
	tone?: BadgeTone;
	className?: string;
	children: ReactNode;
}) {
	return (
		<span className={cx("bite-badge", `bite-badge--${tone}`, className)}>
			{children}
		</span>
	);
}
