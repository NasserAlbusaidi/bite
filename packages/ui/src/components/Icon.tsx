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
	home: "M4 11l8-7 8 7M6 9.5V20h4.5v-5h3v5H18V9.5",
	chart: "M4 20h16M7 16v-5M12 16V6M17 16v-8",
	book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5M5 4.5v15A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6",
	sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
	tag: "M3 12V4h8l9 9-8 8-9-9zM7.5 7.5v.01",
	percent:
		"M19 5L5 19M7 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
	users:
		"M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14a6.5 6.5 0 0 1 3 6",
	store:
		"M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-5h4v5",
	sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
	moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
	monitor: "M3 5h18v11H3zM8 20h8M12 16v4",
	logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
	"menu-lines": "M4 6h16M4 12h16M4 18h16",
	globe:
		"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
	"chevrons-updown": "M8 9l4-4 4 4M8 15l4 4 4-4",
	tablet: "M6 3h12v18H6zM11 18h2",
	qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2h-2",
	key: "M8 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM11.5 12H21M18 12v3M15 12v2",
	copy: "M9 9h11v11H9zM5 15H4V4h11v1",
	eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
	"eye-off":
		"M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.7 3.6M6.6 6.6A16 16 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
	refresh:
		"M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4",
	receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3",
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
