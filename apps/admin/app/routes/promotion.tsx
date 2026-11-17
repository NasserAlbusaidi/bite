import { data, Form, Link, redirect, useNavigation } from "react-router";
import { adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import { loc } from "../lib/i18n";
import { catalogPowers } from "../lib/permissions";
import { loadPlaces } from "../lib/places";
import { parsePromoForm, promoFormDefaults } from "../lib/promo-form";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/promotion";

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
	const api = adminApi();
	const [promotions, menu] = await Promise.all([api.promotions(), api.menu()]);
	const promo =
		params.promotionId === "new"
			? undefined
			: promotions.find((p) => p.id === params.promotionId);
	if (params.promotionId !== "new" && !promo) throw data(null, { status: 404 });
	return { promo, menu };
}

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs) {
	const form = await request.formData();
	const places = await loadPlaces(adminApi());
	const decimals =
		places.find((l) => l.id === selectedLocationId(places))?.decimals ?? 3;
	const parsed = parsePromoForm(form, decimals);
	if (!parsed.ok) return { errors: parsed.errors };
	try {
		if (params.promotionId === "new")
			await adminApi().createPromotion(parsed.value);
		else await adminApi().updatePromotion(params.promotionId, parsed.value);
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 400)
			return { errors: { form: { key: "save_failed" as const } } };
		throw e;
	}
	return redirect("/promotions");
}

export default function PromotionPage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { promo, menu } = loaderData;
	const { t, lang, places, place, me } = useShell();
	const powers = catalogPowers(me);
	const nav = useNavigation();
	const decimals = place?.decimals ?? 3;
	const d = promoFormDefaults(promo, decimals);
	const errors: Record<
		string,
		{ key: Parameters<typeof t>[0]; params?: Record<string, string | number> }
	> = actionData?.errors ?? {};
	const err = (k: string) => {
		const e = errors[k];
		return e ? (
			<span className="error small" role="alert">
				{t(e.key, e.params)}
			</span>
		) : null;
	};
	const busy = nav.state !== "idle";
	const live = menu.products.filter((p) => !p.archivedAt);

	return (
		<>
			<div className="page-head">
				<h1>{promo ? promo.name : t("new_promotion")}</h1>
				<Link to="/promotions">{t("cancel")}</Link>
			</div>
			<Form method="post" className="card form" key={promo?.id ?? "new"}>
				{err("form")}
				<div className="grid2">
					<label>
						{t("promotion_name")}
						<input
							name="name"
							className="input"
							defaultValue={d.name}
							required
							maxLength={120}
						/>
						{err("name")}
					</label>
					<label>
						{t("applies_at")}
						<select
							name="locationId"
							className="input"
							defaultValue={d.locationId}
						>
							{powers.canPickAllLocations && (
								<option value="">{t("all_locations")}</option>
							)}
							{places.map((l) => (
								<option key={l.id} value={l.id}>
									{l.name}
								</option>
							))}
						</select>
					</label>
					<label>
						{t("discount_kind")}
						<select name="kind" className="input" defaultValue={d.kind}>
							<option value="percent">{t("kind_percent")}</option>
							<option value="fixed">
								{t("kind_fixed", { currency: place?.currencyCode ?? "OMR" })}
							</option>
						</select>
					</label>
					<label>
						{t("discount_value")}
						<input
							name="value"
							className="input"
							inputMode="decimal"
							dir="ltr"
							placeholder="20"
							defaultValue={d.value}
							required
						/>
						{err("value")}
					</label>
					<label>
						{t("applies_to")}
						<select name="target" className="input" defaultValue={d.target}>
							<option value="">{t("everything")}</option>
							<optgroup label={t("categories")}>
								{menu.categories.map((c) => (
									<option key={c.id} value={`category:${c.id}`}>
										{loc(c.name, lang)}
									</option>
								))}
							</optgroup>
							<optgroup label={t("products")}>
								{live.map((p) => (
									<option key={p.id} value={`product:${p.id}`}>
										{loc(p.name, lang)}
									</option>
								))}
							</optgroup>
						</select>
					</label>
					<label>
						{t("priority")}
						<input
							name="priority"
							className="input"
							inputMode="numeric"
							dir="ltr"
							defaultValue={d.priority}
						/>
						<span className="muted small">{t("priority_hint")}</span>
						{err("priority")}
					</label>
					<label>
						{t("starts_on")}
						<input
							name="startsOn"
							type="date"
							className="input"
							dir="ltr"
							defaultValue={d.startsOn}
						/>
						{err("startsOn")}
					</label>
					<label>
						{t("ends_on")}
						<input
							name="endsOn"
							type="date"
							className="input"
							dir="ltr"
							defaultValue={d.endsOn}
						/>
						{err("endsOn")}
					</label>
					<label>
						{t("daily_from")}
						<input
							name="dailyStart"
							type="time"
							className="input"
							dir="ltr"
							defaultValue={d.dailyStart}
						/>
					</label>
					<label>
						{t("daily_to")}
						<input
							name="dailyEnd"
							type="time"
							className="input"
							dir="ltr"
							defaultValue={d.dailyEnd}
						/>
						<span className="muted small">{t("daily_hint")}</span>
						{err("dailyEnd")}
					</label>
				</div>
				<fieldset className="fieldset fieldset--row">
					<legend>{t("days")}</legend>
					{DAYS.map((n) => (
						<label key={n} className="check">
							<input
								type="checkbox"
								name="daysOfWeek"
								value={n}
								defaultChecked={d.daysOfWeek.includes(n)}
							/>
							{t(`day_${n}`)}
						</label>
					))}
					<span className="muted small">{t("days_hint")}</span>
				</fieldset>
				<label className="check">
					<input type="checkbox" name="isActive" defaultChecked={d.isActive} />
					{t("active")}
				</label>
				<div className="form-actions">
					<button type="submit" className="btn btn--primary" disabled={busy}>
						{busy ? t("saving") : t("save")}
					</button>
				</div>
			</Form>
		</>
	);
}
