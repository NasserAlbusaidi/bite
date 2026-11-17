import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { useUi } from "../context";
import { cx } from "./cx";

export type TabItem<T extends string> = { id: T; label: ReactNode };

/**
 * Where focus goes for a key press, or null if the key isn't for us. Arrow
 * keys follow reading direction: in Arabic, ArrowLeft moves forward.
 */
export function nextTab(
	current: number,
	key: string,
	count: number,
	dir: "ltr" | "rtl",
): number | null {
	const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
	const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
	if (key === forward) return (current + 1) % count;
	if (key === back) return (current - 1 + count) % count;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	return null;
}

/**
 * A segmented tab bar (categories, order filters). Renders the tablist only;
 * the app renders the panel for `value`, with id `${idPrefix}-panel`.
 */
export function Tabs<T extends string>({
	items,
	value,
	onChange,
	label,
	idPrefix,
	className,
}: {
	items: ReadonlyArray<TabItem<T>>;
	value: T;
	onChange: (id: T) => void;
	/** Accessible name of the tab list. */
	label: string;
	idPrefix: string;
	className?: string;
}) {
	const { dir } = useUi();
	const refs = useRef<Array<HTMLButtonElement | null>>([]);
	const onKeyDown = (e: KeyboardEvent, index: number) => {
		const next = nextTab(index, e.key, items.length, dir);
		const item = next === null ? undefined : items[next];
		if (next === null || !item) return;
		e.preventDefault();
		onChange(item.id);
		refs.current[next]?.focus();
	};
	return (
		<div
			role="tablist"
			aria-label={label}
			className={cx("bite-tabs", className)}
		>
			{items.map((item, i) => {
				const selected = item.id === value;
				return (
					<button
						key={item.id}
						ref={(el) => {
							refs.current[i] = el;
						}}
						type="button"
						role="tab"
						id={`${idPrefix}-tab-${item.id}`}
						aria-selected={selected}
						aria-controls={`${idPrefix}-panel`}
						tabIndex={selected ? 0 : -1}
						className="bite-tabs__tab"
						onClick={() => onChange(item.id)}
						onKeyDown={(e) => onKeyDown(e, i)}
					>
						{item.label}
					</button>
				);
			})}
		</div>
	);
}
