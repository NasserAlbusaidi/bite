import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { adminApi } from "../lib/api";
import { loc } from "../lib/i18n";
import { toDecimal } from "../lib/money";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/menu";

export async function clientLoader() {
	return { menu: await adminApi().menu() };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const form = await request.formData();
	if (form.get("intent") === "createCategory") {
		const en = String(form.get("nameEn") ?? "").trim();
		const ar = String(form.get("nameAr") ?? "").trim();
		if (!en) return { error: "required_field" as const };
		const menu = await adminApi().menu();
		await adminApi().createCategory({
			name: ar ? { en, ar } : { en },
			sortOrder: menu.categories.length,
		});
		return { ok: true };
	}
	return null;
}

export default function MenuPage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { menu } = loaderData;
	const { t, lang, place } = useShell();
	const [q, setQ] = useState("");
	const nav = useNavigation();
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const needle = q.trim().toLowerCase();
	const live = menu.products.filter((p) => !p.archivedAt);
	const groups = new Map(menu.modifierGroups.map((g) => [g.id, g]));

	return (
		<>
			<div className="page-head">
				<h1>{t("menu")}</h1>
				<Link className="btn btn--primary" to="/menu/products/new">
					{t("new_product")}
				</Link>
			</div>
			<input
				type="search"
				className="input"
				placeholder={t("search")}
				value={q}
				onChange={(e) => setQ(e.target.value)}
				aria-label={t("search")}
			/>

			{[...menu.categories]
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map((c) => {
					const products = live
						.filter((p) => p.categoryId === c.id)
						.filter(
							(p) =>
								!needle ||
								p.name.en.toLowerCase().includes(needle) ||
								(p.name.ar ?? "").includes(q.trim()),
						)
						.sort((a, b) => a.sortOrder - b.sortOrder);
					if (needle && products.length === 0) return null;
					return (
						<section key={c.id} className="card">
							<h2>
								{loc(c.name, lang)}{" "}
								{!c.isActive && <span className="tag">{t("inactive")}</span>}
							</h2>
							{products.length === 0 ? (
								<p className="muted">{t("no_products")}</p>
							) : (
								<table className="table">
									<tbody>
										{products.map((p) => (
											<tr key={p.id}>
												<td>
													<Link
														to={`/menu/products/${p.id}`}
														className="strong"
													>
														{loc(p.name, lang)}
													</Link>
													{!p.isVisible && (
														<span className="tag">{t("hidden")}</span>
													)}
													{p.modifierGroupIds.length > 0 && (
														<div className="muted small">
															{p.modifierGroupIds
																.map((g) => groups.get(g))
																.filter((g) => !!g)
																.map((g) => loc(g.name, lang))
																.join(" · ")}
														</div>
													)}
												</td>
												<td className="num">
													<bdi dir="ltr">
														{toDecimal(p.price, decimals)} {currency}
													</bdi>
												</td>
												<td className="actions">
													<Link to={`/menu/products/${p.id}`}>{t("edit")}</Link>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</section>
					);
				})}

			<section className="card">
				<h2>{t("new_category")}</h2>
				<Form method="post" className="inline-form">
					<input type="hidden" name="intent" value="createCategory" />
					<label>
						{t("category_name_en")}
						<input name="nameEn" className="input" required />
					</label>
					<label>
						{t("category_name_ar")}
						<input name="nameAr" className="input" dir="rtl" lang="ar" />
					</label>
					<button type="submit" className="btn" disabled={nav.state !== "idle"}>
						{t("add_category")}
					</button>
				</Form>
				{actionData && "error" in actionData && (
					<p className="error">{t(actionData.error)}</p>
				)}
			</section>
		</>
	);
}
