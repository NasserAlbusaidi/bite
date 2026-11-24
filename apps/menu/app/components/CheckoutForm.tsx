import { useEffect, useRef, useState } from "react";
import type { T } from "../lib/i18n";
import { toE164 } from "../lib/phone";
import { cleanTable } from "../lib/table";

export type CheckoutFields = {
	type: "dine_in" | "takeaway";
	customerName: string;
	customerPhone?: string;
	tableLabel?: string;
	note?: string;
};

type Props = {
	t: T;
	busy: boolean;
	disabled: boolean;
	/** Already translated. */
	error: string | null;
	submitLabel: string;
	/** Prefill, e.g. the name the host already gave when starting a group. */
	defaultName?: string;
	/** From the table QR. Dine-in shows it, editable; blank means no table. */
	defaultTable?: string | null;
	/** A remembered guest's masked number: no need to type it again. */
	knownPhone?: string | null;
	onSubmit: (f: CheckoutFields) => void;
};

/** Order type, name, phone and note. Validates, then hands back clean fields. */
export function CheckoutForm({
	t,
	busy,
	disabled,
	error,
	submitLabel,
	defaultName = "",
	defaultTable = null,
	knownPhone = null,
	onSubmit,
}: Props) {
	const [name, setName] = useState(defaultName);
	// A remembered guest's name arrives after hydration; take it unless typed.
	useEffect(() => {
		if (defaultName) setName((v) => v || defaultName);
	}, [defaultName]);
	const [table, setTable] = useState(defaultTable ?? "");
	// Once the guest has touched the field, it is theirs: a table remembered
	// by this tab (known only after hydration) never overwrites or appends.
	const tableTouched = useRef(false);
	useEffect(() => {
		if (defaultTable && !tableTouched.current) setTable(defaultTable);
	}, [defaultTable]);
	const [phone, setPhone] = useState("");
	const [note, setNote] = useState("");
	const [type, setType] = useState<CheckoutFields["type"]>("dine_in");
	const [formError, setFormError] = useState<string | null>(null);

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		setFormError(null);
		if (!name.trim()) return setFormError(t("name_required"));
		const e164 = phone.trim() ? toE164(phone) : undefined;
		if (e164 === null) return setFormError(t("invalid_phone"));
		const tableLabel = type === "dine_in" ? cleanTable(table) : null;
		onSubmit({
			type,
			customerName: name.trim(),
			...(tableLabel ? { tableLabel } : {}),
			...(e164 ? { customerPhone: e164 } : {}),
			...(note.trim() ? { note: note.trim() } : {}),
		});
	};

	const shown = formError ?? error;
	return (
		<form className="checkout" onSubmit={submit} noValidate>
			<fieldset className="segmented">
				<legend className="field-label">{t("order_type")}</legend>
				{(["dine_in", "takeaway"] as const).map((v) => (
					<label key={v}>
						<input
							type="radio"
							name="type"
							value={v}
							checked={type === v}
							onChange={() => setType(v)}
						/>
						<span>{t(v)}</span>
					</label>
				))}
			</fieldset>

			{type === "dine_in" && (
				<>
					<label className="field-label" htmlFor="table">
						{t("table_label")}
					</label>
					<input
						id="table"
						className="input input--table"
						inputMode="text"
						autoComplete="off"
						dir="auto"
						maxLength={20}
						placeholder={t("table_placeholder")}
						value={table}
						onChange={(e) => {
							tableTouched.current = true;
							setTable(e.target.value);
						}}
					/>
				</>
			)}

			<label className="field-label" htmlFor="name">
				{t("your_name")}
			</label>
			<input
				id="name"
				className="input"
				autoComplete="given-name"
				maxLength={80}
				placeholder={t("name_placeholder")}
				value={name}
				onChange={(e) => setName(e.target.value)}
			/>

			{knownPhone ? (
				<p className="muted small">
					{t("points_go_to", { phone: "" })}
					<bdi dir="ltr">{knownPhone}</bdi>
				</p>
			) : (
				<>
					<label className="field-label" htmlFor="phone">
						{t("phone_label")}{" "}
						<span className="muted small">{t("phone_hint_points")}</span>
					</label>
					<input
						id="phone"
						className="input"
						type="tel"
						inputMode="tel"
						autoComplete="tel"
						dir="ltr"
						maxLength={20}
						value={phone}
						onChange={(e) => setPhone(e.target.value)}
					/>
				</>
			)}

			<label className="field-label" htmlFor="note">
				{t("order_note_label")}
			</label>
			<textarea
				id="note"
				className="input"
				rows={2}
				maxLength={500}
				placeholder={t("order_note_placeholder")}
				value={note}
				onChange={(e) => setNote(e.target.value)}
			/>

			{shown && (
				<p className="error" role="alert">
					{shown}
				</p>
			)}

			<p className="muted small">{t("pay_at_counter_hint")}</p>
			<button
				type="submit"
				className="btn btn--primary btn--grow"
				disabled={busy || disabled}
			>
				{busy ? t("placing") : submitLabel}
			</button>
		</form>
	);
}
