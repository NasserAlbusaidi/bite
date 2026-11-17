import { data, useFetcher } from "react-router";
import { adminApi } from "../lib/api";
import type { LocationProduct } from "../lib/contracts";
import { loc } from "../lib/i18n";
import { fromDecimal, toDecimal } from "../lib/money";
import { loadPlaces } from "../lib/places";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/location-menu";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
	const api = adminApi();
	const [places, menu, rows] = await Promise.all([
		loadPlaces(api),
		api.menu(),
		api.locationProducts(params.locationId),
	]);
	const location = places.find((l) => l.id === params.locationId);
	if (!location) throw data(null, { status: 404 });
	return { location, menu, rows };
}

export async function clientAction({
	request,
	params,
}: Route.ClientActionArgs) {
	const form = await request.formData();
	const decimals = Number(form.get("decimals"));
	const raw = String(form.get("price") ?? "").trim();
	const price = raw === "" ? null : fromDecimal(raw, decimals);
	if (raw !== "" && price === null)
		return { error: true as const, productId: String(form.get("productId")) };
	const productId = String(form.get("productId"));
	await adminApi().setLocationProduct(params.locationId, productId, {
		price,
		isAvailable: form.get("isAvailable") === "true",
	});
	return { ok: true as const, productId };
}

export default function LocationMenu({ loaderData }: Route.ComponentProps) {
	const { location, menu, rows } = loaderData;
	const { t, lang } = useShell();
	const order = new Map(menu.products.map((p) => [p.id, p.sortOrder]));
	const rank = (r: LocationProduct) => order.get(r.productId) ?? 0;

	return (
		<>
			<div className="page-head">
				<h1>{t("overrides_title", { location: location.name })}</h1>
			</div>
			<p className="muted">{t("overrides_hint")}</p>
			{[...menu.categories]
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map((c) => {
					const mine = rows
						.filter((r) => r.categoryId === c.id)
						.sort((a, b) => rank(a) - rank(b));
					if (mine.length === 0) return null;
					return (
						<section key={c.id} className="card">
							<h2>{loc(c.name, lang)}</h2>
							<table className="table">
								<thead>
									<tr>
										<th>{t("product")}</th>
										<th className="num">{t("org_price")}</th>
										<th>{t("location_price")}</th>
										<th>{t("available")}</th>
									</tr>
								</thead>
								<tbody>
									{mine.map((r) => (
										<OverrideRow
											key={r.productId}
											row={r}
											decimals={location.decimals}
											currency={location.currencyCode}
										/>
									))}
								</tbody>
							</table>
						</section>
					);
				})}
		</>
	);
}

function OverrideRow({
	row,
	decimals,
	currency,
}: {
	row: LocationProduct;
	decimals: number;
	currency: string;
}) {
	const { t, lang } = useShell();
	const fetcher = useFetcher<typeof clientAction>();
	const available = row.isAvailable;
	const price = row.overridePrice;
	const busy = fetcher.state !== "idle";
	const failed = fetcher.data && "error" in fetcher.data;

	const save = (next: { price?: string; isAvailable?: boolean }) =>
		fetcher.submit(
			{
				productId: row.productId,
				decimals: String(decimals),
				price: next.price ?? (price === null ? "" : toDecimal(price, decimals)),
				isAvailable: String(next.isAvailable ?? available),
			},
			{ method: "post" },
		);

	return (
		<tr className={available ? "" : "row-off"}>
			<td>{loc(row.name, lang)}</td>
			<td className="num muted">
				<bdi dir="ltr">
					{toDecimal(row.basePrice, decimals)} {currency}
				</bdi>
			</td>
			<td>
				<input
					key={price ?? "none"}
					className={`input input--sm${failed ? " input--bad" : ""}`}
					inputMode="decimal"
					dir="ltr"
					placeholder={toDecimal(row.basePrice, decimals)}
					defaultValue={price === null ? "" : toDecimal(price, decimals)}
					aria-label={`${t("location_price")}: ${loc(row.name, lang)}`}
					onBlur={(e) => {
						const v = e.currentTarget.value.trim();
						const current = price === null ? "" : toDecimal(price, decimals);
						if (v !== current) save({ price: v });
					}}
				/>
				{failed && (
					<span className="error small" role="alert">
						{t("invalid_price", { decimals })}
					</span>
				)}
			</td>
			<td>
				<label className="switch">
					<input
						type="checkbox"
						checked={available}
						disabled={busy}
						onChange={(e) => save({ isAvailable: e.currentTarget.checked })}
					/>
					<span>{available ? t("available") : t("sold_out")}</span>
				</label>
			</td>
		</tr>
	);
}
