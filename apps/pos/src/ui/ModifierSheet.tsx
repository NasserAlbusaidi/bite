import type { MenuProduct } from "@bite/contracts";
import { useState } from "react";
import type { PricedMenu } from "../domain/menu.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { fmt } from "./money.js";

export function ModifierSheet(props: {
	menu: PricedMenu;
	product: MenuProduct;
	onCancel: () => void;
	onAdd: (optionIds: string[], note: string | undefined) => void;
}) {
	const { t, lang } = useI18n();
	const groups = props.product.modifierGroupIds
		.map((id) => props.menu.snapshot.modifierGroups.find((g) => g.id === id))
		.filter((g) => g !== undefined);
	const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
		// Preselect the first available option of single-choice required groups: fewer taps.
		Object.fromEntries(
			groups.map((g) => {
				const first = [...g.options]
					.sort((a, b) => a.sortOrder - b.sortOrder)
					.find((o) => o.isAvailable);
				return [
					g.id,
					g.minSelect === 1 && g.maxSelect === 1 && first ? [first.id] : [],
				];
			}),
		),
	);
	const [note, setNote] = useState("");

	function toggle(groupId: string, optionId: string, max: number) {
		setChosen((c) => {
			const cur = c[groupId] ?? [];
			if (cur.includes(optionId))
				return { ...c, [groupId]: cur.filter((x) => x !== optionId) };
			if (max === 1) return { ...c, [groupId]: [optionId] };
			if (cur.length >= max) return c;
			return { ...c, [groupId]: [...cur, optionId] };
		});
	}

	const valid = groups.every((g) => {
		const n = chosen[g.id]?.length ?? 0;
		return n >= g.minSelect && n <= g.maxSelect;
	});
	const name = (x: { en: string; ar?: string | undefined }) =>
		(lang === "ar" && x.ar) || x.en;

	return (
		<div className="sheet-backdrop">
			<div className="sheet">
				<h2>{name(props.product.name)}</h2>
				{groups.map((g) => (
					<section key={g.id} className="mod-group">
						<div className="row">
							<h3>{name(g.name)}</h3>
							<span className="spacer" />
							<span className="muted">
								{g.minSelect > 0 ? t("till.required") : ""}{" "}
								{g.maxSelect > 1
									? t("till.chooseUpTo", { count: g.maxSelect })
									: t("till.choose", { count: 1 })}
							</span>
						</div>
						<div className="chips">
							{[...g.options]
								.sort((a, b) => a.sortOrder - b.sortOrder)
								.map((o) => (
									<button
										type="button"
										key={o.id}
										disabled={!o.isAvailable}
										className={
											chosen[g.id]?.includes(o.id) ? "chip active" : "chip"
										}
										onClick={() => toggle(g.id, o.id, g.maxSelect)}
									>
										{name(o.name)}
										{o.priceDelta !== 0 &&
											` ${fmt(o.priceDelta, lang, { signed: true })}`}
									</button>
								))}
						</div>
					</section>
				))}
				<label>
					{t("till.note")}
					<input
						value={note}
						maxLength={500}
						onChange={(e) => setNote(e.target.value)}
					/>
				</label>
				<div className="row">
					<button type="button" onClick={props.onCancel}>
						{t("till.cancel")}
					</button>
					<span className="spacer" />
					<button
						type="button"
						className="primary big"
						disabled={!valid}
						onClick={() =>
							props.onAdd(
								Object.values(chosen).flat(),
								note.trim() || undefined,
							)
						}
					>
						{t("till.add")}
					</button>
				</div>
			</div>
		</div>
	);
}
