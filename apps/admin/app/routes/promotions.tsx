import { Link, useFetcher } from "react-router";
import { adminApi } from "../lib/api";
import type { AdminMenu, AdminPromotion } from "../lib/contracts";
import { type Lang, loc, type T } from "../lib/i18n";
import { toDecimal } from "../lib/money";
import { catalogPowers } from "../lib/permissions";
import type { Place } from "../lib/places";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/promotions";

export async function clientLoader() {
	const api = adminApi();
	const [promotions, menu] = await Promise.all([api.promotions(), api.menu()]);
	return { promotions, menu };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const form = await request.formData();
	const id = String(form.get("id") ?? "");
	await adminApi().updatePromotion(id, {
		isActive: form.get("isActive") === "true",
	});
	return { ok: true };
}

/** "20% off · Pastries · 07:00–09:00 · Sun, Mon" */
export function describePromo(
	p: AdminPromotion,
	menu: AdminMenu,
	places: readonly Place[],
	lang: Lang,
	t: T,
	decimals: number,
	currency: string,
): string {
	const amount =
		p.kind === "percent"
			? t("percent_off", { value: toDecimal(p.value, 2).replace(/\.?0+$/, "") })
			: t("amount_off", {
					value: `${toDecimal(p.value, decimals)} ${currency}`,
				});
	const product = p.productId
		? menu.products.find((x) => x.id === p.productId)
		: undefined;
	const category = p.categoryId
		? menu.categories.find((x) => x.id === p.categoryId)
		: undefined;
	const target = product
		? loc(product.name, lang)
		: category
			? loc(category.name, lang)
			: t("everything");
	const where = p.locationId
		? (places.find((l) => l.id === p.locationId)?.name ?? "?")
		: t("all_locations");
	const parts = [amount, target, where];
	if (p.dailyStart && p.dailyEnd)
		parts.push(`${p.dailyStart.slice(0, 5)}–${p.dailyEnd.slice(0, 5)}`);
	if (p.daysOfWeek)
		parts.push(
			p.daysOfWeek
				.map((d) => t(`day_${d as 0 | 1 | 2 | 3 | 4 | 5 | 6}`))
				.join(lang === "ar" ? "، " : ", "),
		);
	return parts.join(" · ");
}

export default function Promotions({ loaderData }: Route.ComponentProps) {
	const { promotions, menu } = loaderData;
	const { t, lang, places, place, me } = useShell();
	const powers = catalogPowers(me);
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const sorted = [...promotions].sort(
		(a, b) =>
			Number(b.isActive) - Number(a.isActive) ||
			b.priority - a.priority ||
			a.name.localeCompare(b.name),
	);

	return (
		<>
			<div className="page-head">
				<h1>{t("promotions")}</h1>
				<Link className="btn btn--primary" to="/promotions/new">
					{t("new_promotion")}
				</Link>
			</div>
			<p className="muted">{t("promotions_hint")}</p>
			<section className="card">
				{sorted.length === 0 ? (
					<p className="muted">{t("no_promotions")}</p>
				) : (
					<table className="table">
						<thead>
							<tr>
								<th>{t("promotion")}</th>
								<th>{t("active")}</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((p) => (
								<PromoRow
									key={p.id}
									promo={p}
									summary={describePromo(
										p,
										menu,
										places,
										lang,
										t,
										decimals,
										currency,
									)}
									t={t}
									editable={powers.canEditPromotion(p)}
								/>
							))}
						</tbody>
					</table>
				)}
			</section>
		</>
	);
}

function PromoRow({
	promo,
	summary,
	t,
	editable,
}: {
	promo: AdminPromotion;
	summary: string;
	t: T;
	editable: boolean;
}) {
	const fetcher = useFetcher();
	const pending = fetcher.formData?.get("isActive");
	const active = pending === undefined ? promo.isActive : pending === "true";
	return (
		<tr className={active ? "" : "row-muted"}>
			<td>
				{editable ? (
					<Link to={`/promotions/${promo.id}`}>{promo.name}</Link>
				) : (
					<span className="strong">{promo.name}</span>
				)}
				<div className="muted small">{summary}</div>
			</td>
			<td>
				<label className="switch">
					<input
						type="checkbox"
						checked={active}
						disabled={!editable}
						onChange={(e) =>
							fetcher.submit(
								{ id: promo.id, isActive: String(e.currentTarget.checked) },
								{ method: "post" },
							)
						}
					/>
					<span>{active ? t("active") : t("paused")}</span>
				</label>
			</td>
		</tr>
	);
}
