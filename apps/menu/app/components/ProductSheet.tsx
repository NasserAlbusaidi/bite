import { times } from "@bite/core";
import { useEffect, useId, useRef, useState } from "react";
import { estimateUnit, type MenuIndex, validateSelection } from "../lib/cart";
import type { MenuProduct } from "../lib/contracts";
import { type Lang, loc, type T } from "../lib/i18n";
import type { Currency } from "../lib/money";
import { Price } from "./Price";

type Props = {
	product: MenuProduct | null;
	idx: MenuIndex;
	lang: Lang;
	t: T;
	currency: Currency;
	onAdd: (p: {
		productId: string;
		modifierOptionIds: string[];
		note?: string;
		quantity: number;
	}) => void;
	onClose: () => void;
};

/** Product detail with modifiers, note and quantity, as a native <dialog>. */
export function ProductSheet({
	product,
	idx,
	lang,
	t,
	currency,
	onAdd,
	onClose,
}: Props) {
	const ref = useRef<HTMLDialogElement>(null);
	const noteId = useId();
	const [selected, setSelected] = useState<string[]>([]);
	const [note, setNote] = useState("");
	const [qty, setQty] = useState(1);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const d = ref.current;
		if (!d) return;
		if (product) {
			setSelected([]);
			setNote("");
			setQty(1);
			setError(null);
			if (!d.open) d.showModal();
		} else if (d.open) {
			d.close();
		}
	}, [product]);

	if (!product) return <dialog ref={ref} className="sheet" onClose={onClose} />;

	const groups = product.modifierGroupIds.flatMap((gid) => {
		const g = idx.groups.get(gid);
		return g ? [g] : [];
	});

	const toggle = (groupId: string, optionId: string, single: boolean) => {
		setError(null);
		setSelected((cur) => {
			if (cur.includes(optionId)) return cur.filter((x) => x !== optionId);
			const others = single
				? cur.filter((x) => idx.optionGroup.get(x) !== groupId)
				: cur;
			return [...others, optionId];
		});
	};

	const submit = () => {
		const err = validateSelection(product, idx, selected);
		if (err) {
			if (err.kind === "invalid") return setError(t("invalid_modifiers"));
			const g = idx.groups.get(err.groupId);
			const name = g ? loc(g.name, lang) : "";
			return setError(
				t(err.kind === "min" ? "select_at_least" : "select_at_most", {
					count: err.count,
					group: name,
				}),
			);
		}
		onAdd({
			productId: product.id,
			modifierOptionIds: selected,
			...(note.trim() ? { note: note.trim() } : {}),
			quantity: qty,
		});
	};

	const unit = estimateUnit(product, idx, selected);

	return (
		<dialog
			ref={ref}
			className="sheet"
			onClose={onClose}
			aria-labelledby={`${noteId}-title`}
		>
			<form
				method="dialog"
				className="sheet__body"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<header className="sheet__head">
					<h2 id={`${noteId}-title`}>{loc(product.name, lang)}</h2>
					<button
						type="button"
						className="icon-btn"
						onClick={onClose}
						aria-label="✕"
					>
						✕
					</button>
				</header>
				{product.description && (
					<p className="muted">{loc(product.description, lang)}</p>
				)}

				{groups.map((g) => {
					const single = g.maxSelect === 1;
					return (
						<fieldset key={g.id} className="modgroup">
							<legend>
								{loc(g.name, lang)}{" "}
								<span className="chip">
									{g.minSelect > 0 ? t("required") : t("optional")}
									{g.maxSelect > 1
										? ` · ${t("up_to", { count: g.maxSelect })}`
										: ""}
								</span>
							</legend>
							{[...g.options]
								.sort((a, b) => a.sortOrder - b.sortOrder)
								.map((o) => (
									<label
										key={o.id}
										className={`modopt${o.isAvailable ? "" : " is-off"}`}
									>
										<input
											type={single ? "radio" : "checkbox"}
											name={g.id}
											checked={selected.includes(o.id)}
											disabled={!o.isAvailable}
											onChange={() => toggle(g.id, o.id, single)}
										/>
										<span>{loc(o.name, lang)}</span>
										{!o.isAvailable ? (
											<span className="muted">{t("sold_out")}</span>
										) : o.priceDelta !== 0 ? (
											<Price
												className="muted"
												amount={o.priceDelta}
												currency={currency}
												lang={lang}
												signed
											/>
										) : null}
									</label>
								))}
						</fieldset>
					);
				})}

				<label htmlFor={noteId} className="field-label">
					{t("item_note_label")}
				</label>
				<textarea
					id={noteId}
					className="input"
					rows={2}
					maxLength={200}
					placeholder={t("item_note_placeholder")}
					value={note}
					onChange={(e) => setNote(e.target.value)}
				/>

				{error && (
					<p className="error" role="alert">
						{error}
					</p>
				)}

				<footer className="sheet__foot">
					<div className="stepper">
						<button
							type="button"
							onClick={() => setQty((q) => Math.max(1, q - 1))}
							aria-label={t("decrease_qty")}
						>
							−
						</button>
						<output aria-live="polite">{qty}</output>
						<button
							type="button"
							onClick={() => setQty((q) => Math.min(99, q + 1))}
							aria-label={t("increase_qty")}
						>
							+
						</button>
					</div>
					<button type="submit" className="btn btn--primary btn--grow">
						<span>{t("add_to_order")}</span>
						<Price amount={times(unit, qty)} currency={currency} lang={lang} />
					</button>
				</footer>
			</form>
		</dialog>
	);
}
