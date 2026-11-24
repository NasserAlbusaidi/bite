import { useMemo } from "react";
import { data, useFetcher, useSearchParams } from "react-router";
import "../menu.css";
import { Thumb } from "../components/Thumb";
import { adminApi } from "../lib/api";
import type { LocationProduct } from "../lib/contracts";
import { loc } from "../lib/i18n";
import { bySort, sortedCategories } from "../lib/menu-view";
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
	const api = adminApi();
	if (form.get("intent") === "bulkAvailability") {
		// Keep each product's branch price; only availability changes.
		const ids = new Set(
			JSON.parse(String(form.get("ids") ?? "[]")) as string[],
		);
		const isAvailable = form.get("isAvailable") === "true";
		const rows = await api.locationProducts(params.locationId);
		for (const r of rows.filter((x) => ids.has(x.productId)))
			await api.setLocationProduct(params.locationId, r.productId, {
				price: r.overridePrice,
				isAvailable,
			});
		return { ok: true as const, productId: "" };
	}
	const decimals = Number(form.get("decimals"));
	const raw = String(form.get("price") ?? "").trim();
	const price = raw === "" ? null : fromDecimal(raw, decimals);
	if (raw !== "" && price === null)
		return { error: true as const, productId: String(form.get("productId")) };
	const productId = String(form.get("productId"));
	await api.setLocationProduct(params.locationId, productId, {
		price,
		isAvailable: form.get("isAvailable") === "true",
	});
	return { ok: true as const, productId };
}

type Show = "all" | "sold_out" | "custom_price";
const SHOWS: Show[] = ["all", "sold_out", "custom_price"];
const matches = (r: LocationProduct, s: Show) =>
	s === "sold_out"
		? !r.isAvailable
		: s === "custom_price"
			? r.overridePrice !== null
			: true;

export default function LocationMenu({ loaderData }: Route.ComponentProps) {
	const { location, menu, rows } = loaderData;
	const { t, lang } = useShell();
	const [params, setParams] = useSearchParams();
	const q = (params.get("q") ?? "").trim().toLowerCase();
	const show = (params.get("show") ?? "all") as Show;
	const setParam = (k: string, v: string) =>
		setParams(
			(p) => {
				if (v && v !== "all") p.set(k, v);
				else p.delete(k);
				return p;
			},
			{ replace: true, preventScrollReset: true },
		);
	const bulk = useFetcher<typeof clientAction>();
	const products = useMemo(
		() => new Map(menu.products.map((p) => [p.id, p])),
		[menu.products],
	);
	const rank = (r: LocationProduct) => products.get(r.productId);
	const soldOut = rows.filter((r) => !r.isAvailable);
	const counts: Record<Show, number> = {
		all: rows.length,
		sold_out: soldOut.length,
		custom_price: rows.filter((r) => r.overridePrice !== null).length,
	};
	const hit = (r: LocationProduct) =>
		matches(r, show) &&
		(!q ||
			[r.name.en, r.name.ar].some((s) => !!s && s.toLowerCase().includes(q)));
	const setAvailability = (ids: string[], isAvailable: boolean) =>
		bulk.submit(
			{
				intent: "bulkAvailability",
				ids: JSON.stringify(ids),
				isAvailable: String(isAvailable),
			},
			{ method: "post" },
		);
	const busy = bulk.state !== "idle";
	const sections = sortedCategories(menu.categories)
		.map((c) => ({
			c,
			all: rows.filter((r) => r.categoryId === c.id),
		}))
		.map(({ c, all }) => ({
			c,
			all,
			shown: all.filter(hit).sort((a, b) => {
				const pa = rank(a);
				const pb = rank(b);
				return pa && pb ? bySort(pa, pb) : 0;
			}),
		}))
		.filter((s) => s.shown.length > 0);

	return (
		<div className="menu-page">
			<div className="page-head">
				<div>
					<h1>{t("overrides_title", { location: location.name })}</h1>
					<p className="muted small">
						{t("avail_summary", {
							soldOut: counts.sold_out,
							custom: counts.custom_price,
						})}
					</p>
				</div>
				{soldOut.length > 0 && (
					<button
						type="button"
						className="btn"
						disabled={busy}
						onClick={() => {
							if (window.confirm(t("all_back_confirm", { n: soldOut.length })))
								setAvailability(
									soldOut.map((r) => r.productId),
									true,
								);
						}}
					>
						{t("all_back_in_stock")}
					</button>
				)}
			</div>
			<p className="muted small">{t("overrides_hint")}</p>
			<div className="menu-toolbar">
				<input
					type="search"
					className="input"
					placeholder={t("avail_search")}
					aria-label={t("avail_search")}
					defaultValue={params.get("q") ?? ""}
					onChange={(e) => setParam("q", e.target.value)}
				/>
				<div className="menu-filters">
					{SHOWS.map((s) => (
						<button
							key={s}
							type="button"
							className={`chip${show === s ? " chip--on" : ""}`}
							aria-pressed={show === s}
							onClick={() => setParam("show", s)}
						>
							{t(`filter_${s}`)}
							<span className="menu-count">{counts[s]}</span>
						</button>
					))}
				</div>
			</div>
			{sections.length === 0 && (
				<section className="card menu-empty">
					<p className="muted">{t("menu_no_match")}</p>
					<button
						type="button"
						className="btn"
						onClick={() => setParams(new URLSearchParams(), { replace: true })}
					>
						{t("clear_filters")}
					</button>
				</section>
			)}
			<ol className="menu-cats">
				{sections.map(({ c, all, shown }) => {
					const ids = shown.map((r) => r.productId);
					const anyOn = shown.some((r) => r.isAvailable);
					const anyOff = shown.some((r) => !r.isAvailable);
					return (
						<li key={c.id} className="card menu-cat">
							<div className="menu-cat__head">
								<div className="menu-cat__title">
									<h2>
										{loc(c.name, lang)}
										<span className="menu-count">{all.length}</span>
									</h2>
								</div>
								<div className="menu-cat__actions">
									<button
										type="button"
										className="btn btn--sm btn--ghost"
										disabled={busy || !anyOff}
										onClick={() => setAvailability(ids, true)}
									>
										{t("category_all_available")}
									</button>
									<button
										type="button"
										className="btn btn--sm btn--ghost"
										disabled={busy || !anyOn}
										onClick={() => setAvailability(ids, false)}
									>
										{t("category_all_sold_out")}
									</button>
								</div>
							</div>
							<ul className="menu-items">
								{shown.map((r) => (
									<AvailabilityRow
										key={r.productId}
										row={r}
										imageUrl={products.get(r.productId)?.imageUrl ?? null}
										decimals={location.decimals}
										currency={location.currencyCode}
									/>
								))}
							</ul>
						</li>
					);
				})}
			</ol>
		</div>
	);
}

function AvailabilityRow({
	row,
	imageUrl,
	decimals,
	currency,
}: {
	row: LocationProduct;
	imageUrl: string | null;
	decimals: number;
	currency: string;
}) {
	const { t, lang } = useShell();
	const fetcher = useFetcher<typeof clientAction>();
	const pending = fetcher.formData;
	const available = pending
		? pending.get("isAvailable") === "true"
		: row.isAvailable;
	const price = row.overridePrice;
	const failed = fetcher.data && "error" in fetcher.data;
	const name = loc(row.name, lang);
	const other = lang === "ar" ? row.name.en : row.name.ar;

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
		<li className={`menu-item avail-item${available ? "" : " is-sold-out"}`}>
			<Thumb url={imageUrl} name={name} />
			<div className="menu-item__body">
				<span className="menu-item__name">{name}</span>
				{other && other !== name && (
					<span className="muted small">
						<bdi>{other}</bdi>
					</span>
				)}
				<span className="muted small">
					{t("org_price")}:{" "}
					<bdi dir="ltr">
						{toDecimal(row.basePrice, decimals)} {currency}
					</bdi>
				</span>
			</div>
			<div className="avail-price">
				<input
					key={price ?? "none"}
					className={`input input--sm${failed ? " input--bad" : ""}${price !== null ? " is-custom" : ""}`}
					inputMode="decimal"
					dir="ltr"
					placeholder={toDecimal(row.basePrice, decimals)}
					defaultValue={price === null ? "" : toDecimal(price, decimals)}
					aria-label={`${t("location_price")}: ${name}`}
					onBlur={(e) => {
						const v = e.currentTarget.value.trim();
						const current = price === null ? "" : toDecimal(price, decimals);
						if (v !== current) save({ price: v });
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
					}}
				/>
				{price !== null && (
					<button
						type="button"
						className="link-btn small"
						onClick={() => save({ price: "" })}
					>
						{t("use_base_price")}
					</button>
				)}
				{failed && (
					<span className="error small" role="alert">
						{t("invalid_price", { decimals })}
					</span>
				)}
			</div>
			<label className={`toggle${available ? "" : " toggle--off"}`}>
				<input
					type="checkbox"
					checked={available}
					onChange={(e) => save({ isAvailable: e.currentTarget.checked })}
					aria-label={`${t("available")}: ${name}`}
				/>
				<span>{available ? t("available") : t("sold_out")}</span>
			</label>
		</li>
	);
}
