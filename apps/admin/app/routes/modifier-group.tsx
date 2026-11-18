import type { ReactNode } from "react";
import { data, Form, Link, useNavigation } from "react-router";
import { adminApi } from "../lib/api";
import type { AdminModifierOption } from "../lib/contracts";
import { loc } from "../lib/i18n";
import {
	deltaText,
	MAX_CHOICES,
	missingChoices,
	parseGroupForm,
	parseOptionForm,
	ruleLabel,
} from "../lib/modifier-form";
import { catalogPowers } from "../lib/permissions";
import { loadPlaces } from "../lib/places";
import type { FieldError } from "../lib/product-form";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/modifier-group";

/** Price changes are entered in the working location's currency. */
async function currencyDecimals() {
	const places = await loadPlaces(adminApi());
	const id = selectedLocationId(places);
	return places.find((l) => l.id === id)?.decimals ?? 3;
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
	const menu = await adminApi().menu();
	const group = menu.modifierGroups.find((g) => g.id === params.groupId);
	if (!group) throw data(null, { status: 404 });
	return {
		group,
		usedBy: menu.products.filter(
			(p) => !p.archivedAt && p.modifierGroupIds.includes(group.id),
		),
	};
}

type ActionResult = {
	/** "group", "new", or the id of the choice the form was for. */
	target: string;
	errors?: Record<string, FieldError>;
	saved?: boolean;
};

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs): Promise<ActionResult> {
	const form = await request.formData();
	const api = adminApi();
	const intent = String(form.get("intent") ?? "");
	const gid = params.groupId;

	if (intent === "saveGroup") {
		const parsed = parseGroupForm(form);
		if (!parsed.ok) return { target: "group", errors: parsed.errors };
		await api.updateModifierGroup(gid, parsed.value);
		return { target: "group", saved: true };
	}

	const optionId = String(form.get("optionId") ?? "");
	if (intent === "soldOut" || intent === "available") {
		await api.updateModifierOption(gid, optionId, {
			isAvailable: intent === "available",
		});
		return { target: optionId, saved: true };
	}

	const parsed = parseOptionForm(form, await currencyDecimals());
	if (intent === "addOption") {
		if (!parsed.ok) return { target: "new", errors: parsed.errors };
		const menu = await api.menu();
		const g = menu.modifierGroups.find((x) => x.id === gid);
		await api.createModifierOption(gid, {
			...parsed.value,
			sortOrder: (g?.options ?? []).reduce(
				(m, o) => Math.max(m, o.sortOrder + 1),
				0,
			),
		});
		return { target: "new", saved: true };
	}
	if (!parsed.ok) return { target: optionId, errors: parsed.errors };
	await api.updateModifierOption(gid, optionId, parsed.value);
	return { target: optionId, saved: true };
}

export default function ModifierGroupPage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { group, usedBy } = loaderData;
	const { t, lang, place, me } = useShell();
	const nav = useNavigation();
	if (!catalogPowers(me).canEditMenu)
		return (
			<section className="card">
				<p>{t("menu_owner_only")}</p>
				<Link to="/menu/modifiers">{t("back_home")}</Link>
			</section>
		);
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const busy = nav.state !== "idle";
	const result = (target: string) =>
		actionData?.target === target ? actionData : undefined;
	const err = (target: string, field: string) => {
		const e = result(target)?.errors?.[field];
		return e ? (
			<span className="error small" role="alert">
				{t(e.key, e.params)}
			</span>
		) : null;
	};
	const saved = (target: string) =>
		result(target)?.saved && !busy ? (
			<span className="ok small" role="status">
				{t("saved")}
			</span>
		) : null;
	const rule = ruleLabel(group);
	const missing = missingChoices(group);
	const options = [...group.options].sort((a, b) => a.sortOrder - b.sortOrder);

	return (
		<>
			<div className="page-head">
				<h1>{loc(group.name, lang)}</h1>
				<Link to="/menu/modifiers">{t("options_title")}</Link>
			</div>

			{missing > 0 && (
				<p className="card warn" role="alert">
					{t("options_missing", { count: missing })}
				</p>
			)}

			<Form method="post" className="card form" key={group.id}>
				<input type="hidden" name="intent" value="saveGroup" />
				<div className="grid2">
					<label>
						{t("name_en")}
						<input
							name="nameEn"
							className="input"
							defaultValue={group.name.en}
							required
							maxLength={120}
						/>
						{err("group", "nameEn")}
					</label>
					<label>
						{t("name_ar")}
						<input
							name="nameAr"
							className="input"
							defaultValue={group.name.ar ?? ""}
							dir="rtl"
							lang="ar"
							maxLength={120}
						/>
					</label>
				</div>
				<div className="grid2">
					<label>
						{t("choices_min")}
						<input
							name="minSelect"
							className="input"
							type="number"
							inputMode="numeric"
							dir="ltr"
							min={0}
							max={MAX_CHOICES}
							defaultValue={group.minSelect}
							required
						/>
						<span className="muted small">{t("choices_min_hint")}</span>
						{err("group", "minSelect")}
					</label>
					<label>
						{t("choices_max")}
						<input
							name="maxSelect"
							className="input"
							type="number"
							inputMode="numeric"
							dir="ltr"
							min={1}
							max={MAX_CHOICES}
							defaultValue={group.maxSelect}
							required
						/>
						<span className="muted small">
							{t("choices_now", { rule: t(rule.key, rule.params) })}
						</span>
						{err("group", "maxSelect")}
					</label>
				</div>
				<div className="choice__actions">
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{t("save")}
					</button>
					{saved("group")}
				</div>
			</Form>

			<section className="card">
				<h2>{t("choices")}</h2>
				<p className="muted small">{t("choices_hint", { currency })}</p>
				{options.length === 0 && <p className="muted">{t("choices_none")}</p>}
				<div className="choices">
					{options.map((o) => (
						<ChoiceRow
							key={o.id}
							option={o}
							decimals={decimals}
							busy={busy}
							error={(f) => err(o.id, f)}
							saved={saved(o.id)}
						/>
					))}
				</div>
			</section>

			<section className="card">
				<h2>{t("choice_add")}</h2>
				{/* A new key empties the form once the choice is saved. */}
				<Form method="post" className="choice" key={options.length}>
					<input type="hidden" name="intent" value="addOption" />
					<ChoiceFields decimals={decimals} error={(f) => err("new", f)} />
					<div className="choice__actions">
						<button type="submit" className="btn btn--primary" disabled={busy}>
							{t("add")}
						</button>
					</div>
				</Form>
			</section>

			<section className="card">
				<h2>{t("options_on_products")}</h2>
				{usedBy.length === 0 ? (
					<p className="muted">{t("options_unused")}</p>
				) : (
					<ul className="plain-list">
						{usedBy.map((p) => (
							<li key={p.id}>
								<Link to={`/menu/products/${p.id}`}>{loc(p.name, lang)}</Link>
							</li>
						))}
					</ul>
				)}
				<p className="muted small">{t("options_attach_hint")}</p>
			</section>
		</>
	);
}

function ChoiceFields({
	option,
	decimals,
	error,
}: {
	option?: AdminModifierOption;
	decimals: number;
	error: (field: string) => ReactNode;
}) {
	const { t } = useShell();
	return (
		<>
			<label>
				{t("name_en")}
				<input
					name="nameEn"
					className="input"
					defaultValue={option?.name.en ?? ""}
					required
					maxLength={120}
				/>
				{error("nameEn")}
			</label>
			<label>
				{t("name_ar")}
				<input
					name="nameAr"
					className="input"
					defaultValue={option?.name.ar ?? ""}
					dir="rtl"
					lang="ar"
					maxLength={120}
				/>
			</label>
			<label>
				{t("price_change")}
				<input
					name="priceDelta"
					className="input"
					inputMode="decimal"
					dir="ltr"
					placeholder={deltaText(0, decimals)}
					defaultValue={
						option && option.priceDelta !== 0
							? deltaText(option.priceDelta, decimals)
							: ""
					}
				/>
				{error("priceDelta")}
			</label>
		</>
	);
}

function ChoiceRow({
	option,
	decimals,
	busy,
	error,
	saved,
}: {
	option: AdminModifierOption;
	decimals: number;
	busy: boolean;
	error: (field: string) => ReactNode;
	saved: ReactNode;
}) {
	const { t } = useShell();
	return (
		<Form
			method="post"
			className={option.isAvailable ? "choice" : "choice choice--off"}
		>
			<input type="hidden" name="optionId" value={option.id} />
			<ChoiceFields option={option} decimals={decimals} error={error} />
			<div className="choice__actions">
				{/* First, so Enter in a field saves instead of toggling. */}
				<button
					type="submit"
					name="intent"
					value="saveOption"
					className="btn"
					disabled={busy}
				>
					{t("save")}
				</button>
				<button
					type="submit"
					name="intent"
					value={option.isAvailable ? "soldOut" : "available"}
					className="btn"
					disabled={busy}
					formNoValidate
				>
					{option.isAvailable ? t("mark_sold_out") : t("mark_available")}
				</button>
				{!option.isAvailable && (
					<span className="tag tag--warn">{t("sold_out")}</span>
				)}
				{saved}
			</div>
		</Form>
	);
}
