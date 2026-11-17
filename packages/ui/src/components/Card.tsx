import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** A raised surface. Use it to set one thing apart, not to box every block. */
export function Card({
	as: Tag = "section",
	flat = false,
	className,
	children,
	...rest
}: HTMLAttributes<HTMLElement> & {
	as?: "section" | "article" | "div" | "li";
	/** Border instead of shadow, for cards inside cards or dense lists. */
	flat?: boolean;
	children?: ReactNode;
}) {
	return (
		<Tag
			className={cx("bite-card", flat && "bite-card--flat", className)}
			{...rest}
		>
			{children}
		</Tag>
	);
}
