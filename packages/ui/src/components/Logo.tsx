import {
	ARABIC_PATH,
	ARABIC_VIEWBOX,
	LATIN_PATH,
	LATIN_VIEWBOX,
} from "../brand/paths";
import { useUi } from "../context";
import { cx } from "./cx";

/**
 * The Bite wordmark, traced from the brand pack. "auto" picks the Arabic
 * lettering in Arabic. Inherits currentColor; defaults to brand pine via CSS.
 */
export function Logo({
	script = "auto",
	height = 28,
	className,
}: {
	script?: "auto" | "latin" | "arabic";
	height?: number | string;
	className?: string;
}) {
	const { lang } = useUi();
	const arabic = script === "arabic" || (script === "auto" && lang === "ar");
	return (
		<svg
			className={cx("bite-logo", className)}
			viewBox={arabic ? ARABIC_VIEWBOX : LATIN_VIEWBOX}
			height={height}
			role="img"
			aria-label={arabic ? "بايت" : "Bite"}
		>
			<path
				d={arabic ? ARABIC_PATH : LATIN_PATH}
				fill="currentColor"
				fillRule="evenodd"
			/>
		</svg>
	);
}
