import { useUi } from "../context";
import { cx } from "./cx";
import { Icon } from "./Icon";

export type KeypadKey =
	| "0"
	| "1"
	| "2"
	| "3"
	| "4"
	| "5"
	| "6"
	| "7"
	| "8"
	| "9"
	| "."
	| "00"
	| "backspace"
	| "clear";

/**
 * Applies a key to a typed amount or PIN string. `decimals` caps digits after
 * the point (amounts); `maxLength` caps the whole string (PINs).
 */
export function applyKey(
	value: string,
	key: KeypadKey,
	opts: { decimals?: number; maxLength?: number } = {},
): string {
	if (key === "clear") return "";
	if (key === "backspace") return value.slice(0, -1);
	if (key === ".") {
		if (!opts.decimals || value.includes(".")) return value;
		return value === "" ? "0." : `${value}.`;
	}
	let next = value === "0" ? key.replace(/^0+/, "") || "0" : value + key;
	const point = next.indexOf(".");
	if (point >= 0 && opts.decimals !== undefined) {
		next = next.slice(0, point + 1 + opts.decimals);
	}
	if (opts.maxLength !== undefined) next = next.slice(0, opts.maxLength);
	return next;
}

/**
 * A 3×4 number pad for PIN entry and cash amounts. Digit order is the phone
 * layout (1-2-3 on top) in both languages, and digits stay Western, like the
 * card terminal next to it.
 */
export function Keypad({
	onKey,
	extra = "clear",
	disabled = false,
	className,
}: {
	onKey: (key: KeypadKey) => void;
	/** Bottom-left key: a decimal point, "00" for cash, or clear. */
	extra?: "." | "00" | "clear";
	disabled?: boolean;
	className?: string;
}) {
	const { t } = useUi();
	const digits: KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
	return (
		<fieldset
			className={cx("bite-keypad", className)}
			aria-label={t("keypad")}
			dir="ltr"
		>
			{digits.map((d) => (
				<button
					key={d}
					type="button"
					className="bite-keypad__key"
					disabled={disabled}
					onClick={() => onKey(d)}
				>
					{d}
				</button>
			))}
			<button
				type="button"
				className="bite-keypad__key bite-keypad__key--aux"
				disabled={disabled}
				onClick={() => onKey(extra)}
				aria-label={extra === "clear" ? t("keypad_clear") : undefined}
			>
				{extra === "clear" ? t("keypad_clear") : extra}
			</button>
			<button
				type="button"
				className="bite-keypad__key"
				disabled={disabled}
				onClick={() => onKey("0")}
			>
				0
			</button>
			<button
				type="button"
				className="bite-keypad__key bite-keypad__key--aux"
				disabled={disabled}
				onClick={() => onKey("backspace")}
				aria-label={t("keypad_backspace")}
			>
				<Icon name="backspace" />
			</button>
		</fieldset>
	);
}
