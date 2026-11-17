import { useUi } from "../context";
import { IconButton } from "./Button";
import { cx } from "./cx";

/** − 2 + for cart lines. The minus becomes a bin at the minimum when onRemove is set. */
export function QuantityStepper({
	value,
	onChange,
	min = 1,
	max = 99,
	onRemove,
	size = "sm",
	className,
}: {
	value: number;
	onChange: (next: number) => void;
	min?: number;
	max?: number;
	onRemove?: () => void;
	/** "sm" for phone carts; "md" or "lg" for a till touchscreen. */
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	const { t } = useUi();
	const atMin = value <= min;
	return (
		<fieldset
			className={cx("bite-stepper", className)}
			aria-label={t("quantity")}
		>
			<IconButton
				icon={atMin && onRemove ? "trash" : "minus"}
				label={t("decrease")}
				size={size}
				variant="secondary"
				disabled={atMin && !onRemove}
				onClick={() => (atMin ? onRemove?.() : onChange(value - 1))}
			/>
			<output className="bite-stepper__value" aria-live="polite">
				{value}
			</output>
			<IconButton
				icon="plus"
				label={t("increase")}
				size={size}
				variant="secondary"
				disabled={value >= max}
				onClick={() => onChange(value + 1)}
			/>
		</fieldset>
	);
}
