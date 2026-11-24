import { useState } from "react";
import { initial } from "../lib/menu-view";

/** Product photo, or the name's first letter when there is none or it fails to load. */
export function Thumb({
	url,
	name,
	className = "",
}: {
	url: string | null;
	name: string;
	className?: string;
}) {
	// Remember which URL failed, so a new URL gets a fresh try.
	const [failed, setFailed] = useState<string | null>(null);
	const broken = failed !== null && failed === url;
	if (!url || broken)
		return (
			<span
				className={`menu-thumb menu-thumb--empty ${className}`}
				aria-hidden="true"
			>
				{initial(name)}
			</span>
		);
	return (
		<img
			className={`menu-thumb ${className}`}
			src={url}
			alt=""
			loading="lazy"
			onError={() => setFailed(url)}
		/>
	);
}
