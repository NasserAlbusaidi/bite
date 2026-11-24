import { useState } from "react";
import {
	data,
	Form,
	Link,
	redirect,
	useLocation,
	useNavigation,
} from "react-router";
import "../menu.css";
import { Thumb } from "../components/Thumb";
import { adminApi } from "../lib/api";
import type { AdminModifierGroup } from "../lib/contracts";
import { type Lang, loc } from "../lib/i18n";
import { ruleLabel } from "../lib/modifier-form";
import { fromDecimal, toDecimal } from "../lib/money";
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
	const url = new URL(request.url);
	// "Add product" on a category opens the form with that category picked.
	const preset = url.searchParams.get("category");
	const presetCategory = menu.categories.some((c) => c.id === preset)
		? preset
		: null;
	const product =
		params.productId === "new"
			? undefined
			: menu.products.find((p) => p.id === params.productId);
	if (params.productId !== "new" && !product) throw data(null, { status: 404 });
	return {
		menu,
		product,
		presetCategory,
		copied: url.searchParams.get("copied") === "1",
	};
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
	if (form.get("intent") === "saveNew")
		return redirect(
			`/menu/products/new?category=${encodeURIComponent(parsed.value.categoryId)}`,
		);
	return redirect(`/menu#cat-${parsed.value.categoryId}`);
}

/** What the preview needs, read straight off the form as it is typed. */
type Draft = {
	nameEn: string;
	nameAr: string;
	descriptionEn: string;
	descriptionAr: string;
	price: string;
	imageUrl: string;
	isVisible: boolean;
	modifierGroupIds: string[];
};
const readDraft = (f: HTMLFormElement): Draft => {
	const d = new FormData(f);
	const s = (k: string) => String(d.get(k) ?? "").trim();
	return {
		nameEn: s("nameEn"),
		nameAr: s("nameAr"),
		descriptionEn: s("descriptionEn"),
		descriptionAr: s("descriptionAr"),
		price: s("price"),
		imageUrl: s("imageUrl"),
		isVisible: d.get("isVisible") === "on",
		modifierGroupIds: d.getAll("modifierGroupIds").map(String),
	};
};

/** Keyed by navigation, so "Save and add another" starts from a blank form. */
export default function ProductPage(props: Route.ComponentProps) {
	return <ProductEditor key={useLocation().key} {...props} />;
}

function ProductEditor({ loaderData, actionData }: Route.ComponentProps) {
	const { menu, product, presetCategory, copied } = loaderData;
	const { t, lang, place, me } = useShell();
	const nav = useNavigation();
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const d = productFormDefaults(product, decimals);
	if (!product && presetCategory) d.categoryId = presetCategory;
	const [draft, setDraft] = useState<Draft>(() => ({
		nameEn: d.nameEn,
		nameAr: d.nameAr,
		descriptionEn: d.descriptionEn,
		descriptionAr: d.descriptionAr,
		price: d.price,
		imageUrl: d.imageUrl,
		isVisible: d.isVisible,
		modifierGroupIds: d.modifierGroupIds,
	}));
	const [imageUrl, setImageUrl] = useState(d.imageUrl);
	const [previewLang, setPreviewLang] = useState<Lang>(lang);

	if (!catalogPowers(me).canEditMenu)
		return (
			<section className="card">
				<p>{t("menu_owner_only")}</p>
				<Link to="/menu">{t("back_home")}</Link>
			</section>
		);
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
	const sorted = [...menu.categories].sort((a, b) => a.sortOrder - b.sortOrder);

	return (
		<div className="menu-page">
			<div className="page-head">
				<div>
					<Link to="/menu" className="small">
						{lang === "ar" ? "→" : "←"} {t("menu")}
					</Link>
					<h1>{product ? loc(product.name, lang) : t("new_product")}</h1>
				</div>
			</div>
			{copied && (
				<p className="menu-note" role="status">
					{t("product_copied_notice")}
				</p>
			)}
			<div className="editor">
				<Form
					method="post"
					className="form editor__form"
					key={product?.id ?? `new-${presetCategory ?? ""}`}
					onChange={(e) => setDraft(readDraft(e.currentTarget))}
				>
					<section className="card form">
						<h2>{t("section_details")}</h2>
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
								{!draft.nameAr && draft.nameEn && (
									<span className="muted small">
										{t("arabic_missing_hint")}
									</span>
								)}
							</label>
							<label>
								{t("description_en")}
								<textarea
									name="descriptionEn"
									className="input"
									rows={3}
									defaultValue={d.descriptionEn}
								/>
								{err("descriptionEn")}
							</label>
							<label>
								{t("description_ar")}
								<textarea
									name="descriptionAr"
									className="input"
									rows={3}
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
									{sorted.map((c) => (
										<option key={c.id} value={c.id}>
											{loc(c.name, lang)}
										</option>
									))}
								</select>
								{err("categoryId")}
							</label>
							<label className="check editor__visible">
								<span className="toggle">
									<input
										type="checkbox"
										name="isVisible"
										defaultChecked={d.isVisible}
									/>
								</span>
								{t("visible")}
							</label>
						</div>
					</section>

					<section className="card form">
						<h2>{t("section_photo")}</h2>
						<div className="editor__photo">
							<Thumb
								url={imageUrl || null}
								name={draft.nameEn || "?"}
								className="editor__thumb"
							/>
							<label>
								{t("image_url")}
								<input
									name="imageUrl"
									className="input"
									type="url"
									dir="ltr"
									placeholder="https://"
									value={imageUrl}
									onChange={(e) => setImageUrl(e.currentTarget.value.trim())}
								/>
								<span className="muted small">{t("photo_hint")}</span>
								{err("imageUrl")}
								{imageUrl && (
									<button
										type="button"
										className="link-btn small"
										onClick={(e) => {
											setImageUrl("");
											const f = e.currentTarget.form;
											if (f) setDraft({ ...readDraft(f), imageUrl: "" });
										}}
									>
										{t("photo_remove")}
									</button>
								)}
							</label>
						</div>
					</section>

					<section className="card form">
						<h2>{t("section_price")}</h2>
						<div className="grid2">
							<label>
								{t("base_price", { currency })}
								<input
									name="price"
									className="input"
									inputMode="decimal"
									dir="ltr"
									placeholder={toDecimal(1250, decimals)}
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
						</div>
						{/* Order is set by dragging on the menu page; keep it as is. */}
						<input type="hidden" name="sortOrder" value={d.sortOrder} />
					</section>

					<section className="card form">
						<h2>{t("modifier_groups")}</h2>
						{menu.modifierGroups.length === 0 && (
							<p className="muted small">{t("options_none")}</p>
						)}
						<div className="editor__groups">
							{menu.modifierGroups.map((g) => {
								const rule = ruleLabel(g);
								return (
									<label key={g.id} className="editor__group">
										<input
											type="checkbox"
											name="modifierGroupIds"
											value={g.id}
											defaultChecked={d.modifierGroupIds.includes(g.id)}
											className="menu-check"
										/>
										<span>
											<span className="strong">{loc(g.name, lang)}</span>{" "}
											<span className="muted small">
												{t(rule.key, rule.params)}
											</span>
											<span className="muted small editor__opts">
												{optionSummary(g, lang, t)}
											</span>
										</span>
									</label>
								);
							})}
						</div>
						<Link to="/menu/modifiers" className="small">
							{t("options_manage")}
						</Link>
					</section>

					<div className="editor__bar">
						<button type="submit" className="btn btn--primary" disabled={busy}>
							{busy ? t("saving") : t("save")}
						</button>
						<button
							type="submit"
							name="intent"
							value="saveNew"
							className="btn"
							disabled={busy}
						>
							{t("save_and_new")}
						</button>
						<Link to="/menu" className="btn btn--ghost">
							{t("cancel")}
						</Link>
						{product && (
							<button
								type="submit"
								name="intent"
								value="archive"
								className="btn btn--danger editor__archive"
								disabled={busy}
								formNoValidate
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

				<aside className="editor__preview" aria-label={t("preview_title")}>
					<div className="editor__preview-head">
						<h2>{t("preview_title")}</h2>
						<div className="menu-filters">
							{(["en", "ar"] as const).map((l) => (
								<button
									key={l}
									type="button"
									className={`chip${previewLang === l ? " chip--on" : ""}`}
									aria-pressed={previewLang === l}
									onClick={() => setPreviewLang(l)}
								>
									{t(l === "en" ? "preview_lang_en" : "preview_lang_ar")}
								</button>
							))}
						</div>
					</div>
					<p className="muted small">{t("preview_hint")}</p>
					<GuestPreview
						draft={{ ...draft, imageUrl }}
						lang={previewLang}
						decimals={decimals}
						currency={currency}
						groups={menu.modifierGroups}
					/>
				</aside>
			</div>
		</div>
	);
}

function optionSummary(
	g: AdminModifierGroup,
	lang: Lang,
	t: ReturnType<typeof useShell>["t"],
) {
	const names = [...g.options]
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((o) => loc(o.name, lang));
	const shown = names.slice(0, 4).join(" · ");
	return names.length > 4
		? `${shown} ${t("option_more", { n: names.length - 4 })}`
		: shown;
}

function GuestPreview({
	draft,
	lang,
	decimals,
	currency,
	groups,
}: {
	draft: Draft;
	lang: Lang;
	decimals: number;
	currency: string;
	groups: AdminModifierGroup[];
}) {
	const { t } = useShell();
	const name =
		(lang === "ar" && draft.nameAr) || draft.nameEn || t("new_product");
	const desc = (lang === "ar" && draft.descriptionAr) || draft.descriptionEn;
	const price = fromDecimal(draft.price, decimals);
	const chosen = groups.filter((g) => draft.modifierGroupIds.includes(g.id));
	return (
		<div
			className={`guest-card${draft.isVisible ? "" : " is-hidden"}`}
			dir={lang === "ar" ? "rtl" : "ltr"}
			lang={lang}
		>
			{!draft.isVisible && (
				<p className="guest-card__flag">{t("preview_hidden")}</p>
			)}
			<Thumb
				url={draft.imageUrl || null}
				name={name}
				className="guest-card__photo"
			/>
			<div className="guest-card__body">
				<div className="guest-card__row">
					<strong>{name}</strong>
					<bdi dir="ltr" className="menu-item__price">
						{price === null ? "—" : `${toDecimal(price, decimals)} ${currency}`}
					</bdi>
				</div>
				{desc && <p className="muted small">{desc}</p>}
				{chosen.map((g) => (
					<div key={g.id} className="guest-card__group">
						<span className="small strong">{loc(g.name, lang)}</span>
						<span className="guest-card__opts">
							{[...g.options]
								.sort((a, b) => a.sortOrder - b.sortOrder)
								.map((o) => (
									<span
										key={o.id}
										className={`guest-card__opt${o.isAvailable ? "" : " is-off"}`}
									>
										{loc(o.name, lang)}
										{o.priceDelta !== 0 && (
											<>
												{" "}
												<bdi dir="ltr" className="muted">
													{o.priceDelta > 0 ? "+" : "−"}
													{toDecimal(Math.abs(o.priceDelta), decimals)}
												</bdi>
											</>
										)}
									</span>
								))}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
