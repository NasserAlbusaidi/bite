import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	/** primary = lime (the one main action on screen), secondary = forest. */
	variant?: ButtonVariant;
	size?: "sm" | "md" | "lg";
	/** Full width. */
	block?: boolean;
	/** Shows a spinner and blocks clicks, keeping the label for width. */
	busy?: boolean;
	icon?: IconName;
	iconEnd?: IconName;
	ref?: Ref<HTMLButtonElement>;
	children?: ReactNode;
};

export function Button({
	variant = "primary",
	size = "md",
	block = false,
	busy = false,
	icon,
	iconEnd,
	className,
	children,
	disabled,
	type = "button",
	...rest
}: ButtonProps) {
	return (
		<button
			type={type}
			className={cx(
				"bite-btn",
				`bite-btn--${variant}`,
				`bite-btn--${size}`,
				block && "bite-btn--block",
				className,
			)}
			disabled={disabled || busy}
			aria-busy={busy || undefined}
			{...rest}
		>
			{busy ? <Spinner /> : icon && <Icon name={icon} />}
			{children}
			{iconEnd && <Icon name={iconEnd} />}
		</button>
	);
}

/** Square button with only an icon. `label` is its accessible name. */
export function IconButton({
	icon,
	label,
	variant = "ghost",
	size = "md",
	className,
	type = "button",
	...rest
}: Omit<ButtonProps, "children" | "icon" | "iconEnd" | "block" | "busy"> & {
	icon: IconName;
	label: string;
}) {
	return (
		<button
			type={type}
			aria-label={label}
			title={label}
			className={cx(
				"bite-btn",
				"bite-btn--icon",
				`bite-btn--${variant}`,
				`bite-btn--${size}`,
				className,
			)}
			{...rest}
		>
			<Icon name={icon} />
		</button>
	);
}
