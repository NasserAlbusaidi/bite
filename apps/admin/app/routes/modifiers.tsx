import { Form, Link, redirect, useNavigation } from "react-router";
import { adminApi } from "../lib/api";
import { loc } from "../lib/i18n";
import {
	deltaLabel,
	missingChoices,
	parseGroupForm,
	ruleLabel,
} from "../lib/modifier-form";
import { catalogPowers } from "../lib/permissions";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/modifiers";

export async function clientLoader() {
	return { menu: await adminApi().menu() };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const form = await request.formData();
	// The quick form asks one question; the numbers are set on the next page.
	const required = form.get("required") === "on";
	form.set("minSelect", required ? "1" : "0");
	form.set("maxSelect", "1");
	const parsed = parseGroupForm(form);
	if (!parsed.ok) return { errors: parsed.errors };
	const g = await adminApi().createModifierGroup(parsed.value);
	return redirect(`/menu/modifiers/${g.id}`);
}

export default function ModifiersPage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { menu } = loaderData;
	const { t, lang, place, me } = useShell();
	const { canEditMenu } = catalogPowers(me);
	const nav = useNavigation();
	const decimals = place?.decimals ?? 3;
	const live = menu.products.filter((p) => !p.archivedAt);

	return (
		<>
			<div className="page-head">
				<h1>{t("options_title")}</h1>
				<Link to="/menu">{t("back_to_menu")}</Link>
			</div>
			<p className="muted">{t("options_intro")}</p>
			{!canEditMenu && <p className="card muted">{t("menu_owner_only")}</p>}

			{menu.modifierGroups.length === 0 && (
				<p className="card muted">{t("options_none")}</p>
			)}

			{menu.modifierGroups.map((g) => {
				const rule = ruleLabel(g);
				const usedBy = live.filter((p) => p.modifierGroupIds.includes(g.id));
				const missing = missingChoices(g);
				return (
					<section key={g.id} className="card">
						<div className="card-head">
							<h2>
								{loc(g.name, lang)}{" "}
								<span className="tag">{t(rule.key, rule.params)}</span>
							</h2>
							{canEditMenu && (
								<Link className="btn" to={`/menu/modifiers/${g.id}`}>
									{t("edit")}
								</Link>
							)}
						</div>
						{missing > 0 && usedBy.length > 0 && (
							<p className="warn" role="alert">
								{t("options_blocked", { count: usedBy.length })}
							</p>
						)}
						{g.options.length === 0 ? (
							<p className="muted">{t("choices_none")}</p>
						) : (
							<ul className="choice-chips">
								{[...g.options]
									.sort((a, b) => a.sortOrder - b.sortOrder)
									.map((o) => (
										<li
											key={o.id}
											className={o.isAvailable ? "chip" : "chip chip--off"}
										>
											{loc(o.name, lang)}
											{o.priceDelta !== 0 && (
												<bdi dir="ltr" className="muted">
													{deltaLabel(o.priceDelta, decimals)}
												</bdi>
											)}
											{!o.isAvailable && (
												<span className="small">{t("sold_out")}</span>
											)}
										</li>
									))}
							</ul>
						)}
						<p className="muted small">
							{usedBy.length === 0
								? t("options_unused")
								: t("options_used_by", {
										products: usedBy.map((p) => loc(p.name, lang)).join(", "),
									})}
						</p>
					</section>
				);
			})}

			{canEditMenu && (
				<section className="card">
					<h2>{t("options_new")}</h2>
					<Form method="post" className="inline-form">
						<label>
							{t("name_en")}
							<input
								name="nameEn"
								className="input"
								placeholder="Milk"
								required
								maxLength={120}
							/>
						</label>
						<label>
							{t("name_ar")}
							<input
								name="nameAr"
								className="input"
								dir="rtl"
								lang="ar"
								maxLength={120}
							/>
						</label>
						<label className="check">
							<input type="checkbox" name="required" />
							{t("options_required")}
						</label>
						<button
							type="submit"
							className="btn btn--primary"
							disabled={nav.state !== "idle"}
						>
							{t("options_create")}
						</button>
					</Form>
					{actionData?.errors.nameEn && (
						<p className="error">{t(actionData.errors.nameEn.key)}</p>
					)}
				</section>
			)}
		</>
	);
}
