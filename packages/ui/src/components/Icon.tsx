import type { SVGProps } from "react";
import { cx } from "./cx";

/**
 * A small stroke icon set drawn to match the brand pack's rounded line icons.
 * Directional icons flip in RTL. Decorative by default: give the button or
 * link the accessible name, not the icon.
 */
const paths = {
	plus: "M12 5v14M5 12h14",
	minus: "M5 12h14",
	close: "M6 6l12 12M18 6L6 18",
	check: "M5 12.5l4.5 4.5L19 7",
	"chevron-forward": "M9 5l7 7-7 7",
	"chevron-back": "M15 5l-7 7 7 7",
	"arrow-forward": "M5 12h14M13 6l6 6-6 6",
	"arrow-back": "M19 12H5M11 6l-6 6 6 6",
	backspace:
		"M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7zM12 9.5l5 5M17 9.5l-5 5",
	search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.5-4.5",
	bag: "M6 8h12l-1 12H7L6 8zM9 8V7a3 3 0 0 1 6 0v1",
	trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
	clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
	alert: "M12 3l9.5 17h-19L12 3zM12 10v4M12 17.5v.01",
	info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01",
	printer:
		"M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z",
	"wifi-off":
		"M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-2.5-1.8M2 8.8a15 15 0 0 1 4.5-2.6M22 8.8A15 15 0 0 0 11 5M12 20h.01",
	user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
	settings:
		"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
} as const;

export type IconName = keyof typeof paths;

const MIRRORED: ReadonlySet<IconName> = new Set([
	"chevron-forward",
	"chevron-back",
	"arrow-forward",
	"arrow-back",
	"backspace",
]);

export const iconNames = Object.keys(paths) as IconName[];

export function Icon({
	name,
	size = "1.25em",
	className,
	...rest
}: { name: IconName; size?: string | number } & Omit<
	SVGProps<SVGSVGElement>,
	"name"
>) {
	return (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			className={cx(
				"bite-icon",
				MIRRORED.has(name) && "bite-icon--mirror",
				className,
			)}
			{...rest}
		>
			<path d={paths[name]} />
		</svg>
	);
}
