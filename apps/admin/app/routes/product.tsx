import { data, Form, Link, redirect, useNavigation } from "react-router";
import { adminApi } from "../lib/api";
import { loc } from "../lib/i18n";
import { ruleLabel } from "../lib/modifier-form";
import { catalogPowers } from "../lib/permissions";
import { loadPlaces } from "../lib/places";
import { parseProductForm, productFormDefaults } from "../lib/product-form";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/product";

/** Org prices are entered in the working location's currency. */
async function currencyDecimals() {
	const places = await loadPlaces(adminApi());
	const id = selectedLocationId(places);
	return places.find((l) => l.id === id)?.decimals ?? 3;
}

export async function clientLoader({
	params,
	request,
}: Route.ClientLoaderArgs) {
	const menu = await adminApi().menu();
	// "Add product" on a category opens the form with that category picked.
	const preset = new URL(request.url).searchParams.get("category");
	const presetCategory = menu.categories.some((c) => c.id === preset)
		? preset
		: null;
	const product =
		params.productId === "new"
			? undefined
			: menu.products.find((p) => p.id === params.productId);
	if (params.productId !== "new" && !product) throw data(null, { status: 404 });
	return { menu, product, presetCategory };
}

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs) {
	const form = await request.formData();
	const api = adminApi();
	if (form.get("intent") === "archive" && params.productId !== "new") {
		await api.archiveProduct(params.productId);
		return redirect("/menu");
	}
	const parsed = parseProductForm(form, await currencyDecimals());
	if (!parsed.ok) return { errors: parsed.errors };
	if (params.productId === "new") await api.createProduct(parsed.value);
	else await api.updateProduct(params.productId, parsed.value);
	return redirect("/menu");
}

export default function ProductPage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { menu, product, presetCategory } = loaderData;
	const { t, lang, place, me } = useShell();
	const nav = useNavigation();
	if (!catalogPowers(me).canEditMenu)
		return (
			<section className="card">
				<p>{t("menu_owner_only")}</p>
				<Link to="/menu">{t("back_home")}</Link>
			</section>
		);
	const decimals = place?.decimals ?? 3;
	const d = productFormDefaults(product, decimals);
	if (!product && presetCategory) d.categoryId = presetCategory;
	const errors = actionData?.errors ?? {};
	const err = (k: string) => {
		const e = errors[k];
		return e ? (
			<span className="error small" role="alert">
				{t(e.key, e.params)}
			</span>
		) : null;
	};
	const busy = nav.state !== "idle";

	return (
		<>
			<div className="page-head">
				<h1>{product ? loc(product.name, lang) : t("new_product")}</h1>
				<Link to="/menu">{t("cancel")}</Link>
			</div>
			<Form method="post" className="card form" key={product?.id ?? "new"}>
				<div className="grid2">
					<label>
						{t("name_en")}
						<input
							name="nameEn"
							className="input"
							defaultValue={d.nameEn}
							required
							maxLength={120}
						/>
						{err("nameEn")}
					</label>
					<label>
						{t("name_ar")}
						<input
							name="nameAr"
							className="input"
							defaultValue={d.nameAr}
							dir="rtl"
							lang="ar"
							maxLength={120}
						/>
					</label>
					<label>
						{t("description_en")}
						<textarea
							name="descriptionEn"
							className="input"
							rows={2}
							defaultValue={d.descriptionEn}
						/>
						{err("descriptionEn")}
					</label>
					<label>
						{t("description_ar")}
						<textarea
							name="descriptionAr"
							className="input"
							rows={2}
							defaultValue={d.descriptionAr}
							dir="rtl"
							lang="ar"
						/>
					</label>
					<label>
						{t("category")}
						<select
							name="categoryId"
							className="input"
							defaultValue={d.categoryId}
							required
						>
							<option value="" disabled>
								—
							</option>
							{menu.categories.map((c) => (
								<option key={c.id} value={c.id}>
									{loc(c.name, lang)}
								</option>
							))}
						</select>
						{err("categoryId")}
					</label>
					<label>
						{t("base_price", { currency: place?.currencyCode ?? "OMR" })}
						<input
							name="price"
							className="input"
							inputMode="decimal"
							dir="ltr"
							placeholder="1.250"
							defaultValue={d.price}
							required
						/>
						<span className="muted small">{t("base_price_hint")}</span>
						{err("price")}
					</label>
					<label>
						{t("tax_override")}
						<input
							name="taxPercent"
							className="input"
							inputMode="decimal"
							dir="ltr"
							defaultValue={d.taxPercent}
						/>
						<span className="muted small">{t("tax_override_hint")}</span>
						{err("taxPercent")}
					</label>
					<label>
						{t("sort_order")}
						<input
							name="sortOrder"
							className="input"
							inputMode="numeric"
							dir="ltr"
							defaultValue={d.sortOrder}
						/>
					</label>
					<label>
						{t("image_url")}
						<input
							name="imageUrl"
							className="input"
							type="url"
							dir="ltr"
							defaultValue={d.imageUrl}
						/>
						{err("imageUrl")}
					</label>
					<label className="check">
						<input
							type="checkbox"
							name="isVisible"
							defaultChecked={d.isVisible}
						/>
						{t("visible")}
					</label>
				</div>

				<fieldset className="fieldset">
					<legend>{t("modifier_groups")}</legend>
					{menu.modifierGroups.length === 0 && (
						<p className="muted small">{t("options_none")}</p>
					)}
					{menu.modifierGroups.map((g) => {
						const rule = ruleLabel(g);
						return (
							<label key={g.id} className="check">
								<input
									type="checkbox"
									name="modifierGroupIds"
									value={g.id}
									defaultChecked={d.modifierGroupIds.includes(g.id)}
								/>
								{loc(g.name, lang)}{" "}
								<span className="muted small">{t(rule.key, rule.params)}</span>
							</label>
						);
					})}
					<Link to="/menu/modifiers" className="small">
						{t("options_manage")}
					</Link>
				</fieldset>

				<div className="form-actions">
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{busy ? t("saving") : t("save")}
					</button>
					{product && (
						<button
							type="submit"
							name="intent"
							value="archive"
							className="btn btn--danger"
							disabled={busy}
							onClick={(e) => {
								if (
									!window.confirm(
										t("archive_confirm", { name: loc(product.name, lang) }),
									)
								)
									e.preventDefault();
							}}
						>
							{t("archive")}
						</button>
					)}
				</div>
			</Form>
		</>
	);
}
