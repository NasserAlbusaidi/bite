import {
	type InputHTMLAttributes,
	type ReactNode,
	type Ref,
	type SelectHTMLAttributes,
	type TextareaHTMLAttributes,
	useId,
} from "react";
import { cx } from "./cx";

export type ControlProps = {
	id: string;
	"aria-describedby"?: string;
	"aria-invalid"?: true;
};

type FieldProps = {
	label: ReactNode;
	hint?: ReactNode | undefined;
	/** Shown in danger colour; marks the control aria-invalid. */
	error?: ReactNode | undefined;
	className?: string | undefined;
	/** Render the control with the wiring props (id, describedby, invalid). */
	children: (control: ControlProps) => ReactNode;
};

/** Label + control + hint/error, with the accessibility wiring done. */
export function Field({ label, hint, error, className, children }: FieldProps) {
	const id = useId();
	const hintId = hint ? `${id}-hint` : undefined;
	const errorId = error ? `${id}-error` : undefined;
	const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
	return (
		<div
			className={cx("bite-field", !!error && "bite-field--invalid", className)}
		>
			<label className="bite-field__label" htmlFor={id}>
				{label}
			</label>
			{children({
				id,
				...(describedBy ? { "aria-describedby": describedBy } : {}),
				...(error ? { "aria-invalid": true as const } : {}),
			})}
			{error && (
				<p className="bite-field__error" id={errorId}>
					{error}
				</p>
			)}
			{hint && (
				<p className="bite-field__hint" id={hintId}>
					{hint}
				</p>
			)}
		</div>
	);
}

/** Phone numbers, emails and amounts read left to right even in Arabic. */
const LTR_TYPES = new Set([
	"tel",
	"email",
	"url",
	"number",
	"numeric",
	"decimal",
]);
const isLtrInput = (i: InputHTMLAttributes<HTMLInputElement>) =>
	LTR_TYPES.has(i.type ?? "") || LTR_TYPES.has(i.inputMode ?? "");

type Common = {
	label: ReactNode;
	hint?: ReactNode | undefined;
	error?: ReactNode | undefined;
};

export function TextField({
	label,
	hint,
	error,
	className,
	ref,
	...input
}: Common &
	InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
	return (
		<Field label={label} hint={hint} error={error} className={className}>
			{(control) => (
				<input
					ref={ref}
					className="bite-input"
					dir={input.dir ?? (isLtrInput(input) ? "ltr" : undefined)}
					{...input}
					{...control}
				/>
			)}
		</Field>
	);
}

export function TextArea({
	label,
	hint,
	error,
	className,
	...input
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return (
		<Field label={label} hint={hint} error={error} className={className}>
			{(control) => (
				<textarea
					className="bite-input bite-input--area"
					{...input}
					{...control}
				/>
			)}
		</Field>
	);
}

export function SelectField({
	label,
	hint,
	error,
	className,
	children,
	...select
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<Field label={label} hint={hint} error={error} className={className}>
			{(control) => (
				<select className="bite-input bite-select" {...select} {...control}>
					{children}
				</select>
			)}
		</Field>
	);
}
