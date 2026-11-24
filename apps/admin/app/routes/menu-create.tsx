import { useMemo, useState } from "react";
import { Link, redirect, useFetcher } from "react-router";
import "../menu.css";
import { adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import type { AdminMenu } from "../lib/contracts";
import { loc } from "../lib/i18n";
import {
	type ImportResult,
	parseMenuText,
	TEMPLATES,
	type TemplateKey,
	withCategoryArabic,
} from "../lib/menu-import";
import { endOf } from "../lib/menu-view";
import { toDecimal } from "../lib/money";
import { catalogPowers } from "../lib/permissions";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/menu-create";

export async function clientLoader() {
	return { menu: await adminApi().menu() };
}

const key = (s: string) => s.trim().toLowerCase();

/** Existing category by English name, and the set of names already in it. */
function existing(menu: AdminMenu) {
	const cats = new Map(menu.categories.map((c) => [key(c.name.en), c]));
	const names = new Set(
		menu.products
			.filter((p) => !p.archivedAt)
			.map((p) => `${p.categoryId}/${key(p.name.en)}`),
	);
	return { cats, names };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const form = await request.formData();
	const plan = JSON.parse(String(form.get("plan"))) as ImportResult;
	const api = adminApi();
	let done = 0;
	try {
		let menu = await api.menu();
		const { cats, names } = existing(menu);
		let nextCat = menu.categories.length;
		for (const c of plan.categories) {
			let cat = cats.get(key(c.nameEn));
			if (!cat) {
				cat = await api.createCategory({
					name: c.nameAr ? { en: c.nameEn, ar: c.nameAr } : { en: c.nameEn },
					sortOrder: nextCat++,
				});
				cats.set(key(c.nameEn), cat);
			}
			menu = await api.menu();
			let sort = endOf(menu.products, cat.id);
			for (const p of c.products) {
				// Re-running after a failure must not create the same item twice.
				if (names.has(`${cat.id}/${key(p.nameEn)}`) || p.price === null)
					continue;
				await api.createProduct({
					categoryId: cat.id,
					name: p.nameAr ? { en: p.nameEn, ar: p.nameAr } : { en: p.nameEn },
					description: p.descriptionEn ? { en: p.descriptionEn } : null,
					price: p.price,
					sortOrder: sort++,
				});
				names.add(`${cat.id}/${key(p.nameEn)}`);
				done++;
			}
		}
	} catch (e) {
		return {
			done,
			reason: e instanceof AdminApiError ? e.code : String(e),
		};
	}
	return redirect(`/menu?added=${done}`);
}

const TEMPLATE_KEYS: TemplateKey[] = ["cafe", "bakery", "restaurant", "juice"];

export default function MenuCreate({ loaderData }: Route.ComponentProps) {
	const { menu } = loaderData;
	const { t, lang, place, me } = useShell();
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const [text, setText] = useState("");
	const [picked, setPicked] = useState<TemplateKey | "blank" | null>(null);
	const [suggest, setSuggest] = useState(true);
	const fetcher = useFetcher<typeof clientAction>();

	const parsed = useMemo(() => {
		const r = parseMenuText(text, decimals, { suggestArabic: suggest });
		return suggest ? withCategoryArabic(r) : r;
	}, [text, decimals, suggest]);
	const { cats, names } = useMemo(() => existing(menu), [menu]);
	const isDup = (catEn: string, nameEn: string) => {
		const c = cats.get(key(catEn));
		return !!c && names.has(`${c.id}/${key(nameEn)}`);
	};
	const newCount = parsed.categories.reduce(
		(n, c) =>
			n +
			c.products.filter((p) => p.price !== null && !isDup(c.nameEn, p.nameEn))
				.length,
		0,
	);
	const newCats = parsed.categories.filter(
		(c) => !cats.has(key(c.nameEn)),
	).length;
	const busy = fetcher.state !== "idle";
	const failed = fetcher.data;

	if (!catalogPowers(me).canEditMenu)
		return (
			<section className="card">
				<p>{t("menu_owner_only")}</p>
				<Link to="/menu">{t("back_home")}</Link>
			</section>
		);

	return (
		<div className="menu-page">
			<div className="page-head">
				<div>
					<Link to="/menu" className="small">
						{lang === "ar" ? "→" : "←"} {t("menu")}
					</Link>
					<h1>{t("creator_title")}</h1>
					<p className="muted small">{t("creator_intro")}</p>
				</div>
			</div>

			<section className="card">
				<h2>{t("creator_step_start")}</h2>
				<div className="creator-templates">
					{TEMPLATE_KEYS.map((k) => {
						const r = parseMenuText(TEMPLATES[k], decimals);
						return (
							<button
								key={k}
								type="button"
								className={`creator-template${picked === k ? " is-on" : ""}`}
								aria-pressed={picked === k}
								onClick={() => {
									setPicked(k);
									setText(TEMPLATES[k]);
								}}
							>
								<strong>{t(`template_${k}`)}</strong>
								<span className="muted small">
									{t("menu_summary", {
										products: r.productCount,
										categories: r.categories.length,
									})}
								</span>
								<span className="muted small creator-template__peek">
									{r.categories
										.map((c) =>
											loc(
												{ en: c.nameEn, ...(c.nameAr ? { ar: c.nameAr } : {}) },
												lang,
											),
										)
										.join(" · ")}
								</span>
							</button>
						);
					})}
					<button
						type="button"
						className={`creator-template${picked === "blank" ? " is-on" : ""}`}
						aria-pressed={picked === "blank"}
						onClick={() => {
							setPicked("blank");
							setText("# \n");
						}}
					>
						<strong>{t("template_blank")}</strong>
						<span className="muted small">{t("template_blank_hint")}</span>
					</button>
				</div>
			</section>

			<div className="creator">
				<section className="card form">
					<h2>{t("creator_step_edit")}</h2>
					<p className="muted small">{t("creator_format")}</p>
					<textarea
						className="input creator-text"
						rows={18}
						dir="auto"
						spellCheck={false}
						value={text}
						onChange={(e) => setText(e.currentTarget.value)}
						placeholder={
							"# Coffee | قهوة\nFlat white | 1.600 | فلات وايت\nKarak, 0.400"
						}
						aria-label={t("creator_step_edit")}
					/>
					<div className="creator-tools">
						<label className="btn btn--sm">
							{t("creator_load_file")}
							<input
								type="file"
								accept=".csv,.txt,.tsv,text/csv,text/plain"
								className="sr-only"
								onChange={async (e) => {
									const f = e.currentTarget.files?.[0];
									if (f) {
										setText(await f.text());
										setPicked(null);
									}
								}}
							/>
						</label>
						<label className="toggle">
							<input
								type="checkbox"
								checked={suggest}
								onChange={(e) => setSuggest(e.currentTarget.checked)}
							/>
							<span>{t("creator_suggest_ar")}</span>
						</label>
					</div>
				</section>

				<section className="card creator-preview">
					<h2>{t("creator_step_check")}</h2>
					{parsed.productCount === 0 ? (
						<p className="muted">{t("creator_nothing")}</p>
					) : (
						<>
							{parsed.issues.length > 0 && (
								<ul className="menu-alert creator-issues" role="alert">
									{parsed.issues.map((i) => (
										<li key={`${i.line}-${i.kind}`}>
											{t(
												i.kind === "no_price"
													? "creator_issue_no_price"
													: "creator_issue_no_name",
												{ line: i.line },
											)}
										</li>
									))}
								</ul>
							)}
							{parsed.categories.map((c) => (
								<div key={c.nameEn} className="creator-cat">
									<h3>
										{c.nameEn}
										{c.nameAr && (
											<span className="muted">
												{" · "}
												<bdi>{c.nameAr}</bdi>
											</span>
										)}
										{cats.has(key(c.nameEn)) && (
											<span className="tag">{t("creator_existing")}</span>
										)}
									</h3>
									<ul>
										{c.products.map((p) => {
											const dup = isDup(c.nameEn, p.nameEn);
											return (
												<li
													key={p.line}
													className={`creator-row${p.price === null ? " is-bad" : ""}${dup ? " is-dup" : ""}`}
												>
													<span className="creator-row__names">
														<span className="strong">{p.nameEn || "—"}</span>
														{p.nameAr ? (
															<span>
																<bdi>{p.nameAr}</bdi>
																{p.arSuggested && (
																	<span className="tag tag--soft">
																		{t("creator_suggested")}
																	</span>
																)}
															</span>
														) : (
															<span className="tag tag--soft">
																{t("filter_no_arabic")}
															</span>
														)}
														{p.descriptionEn && (
															<span className="muted small">
																{p.descriptionEn}
															</span>
														)}
														{dup && (
															<span className="muted small">
																{t("creator_skip_existing")}
															</span>
														)}
													</span>
													<bdi dir="ltr" className="menu-item__price">
														{p.price === null
															? "—"
															: `${toDecimal(p.price, decimals)} ${currency}`}
													</bdi>
												</li>
											);
										})}
									</ul>
								</div>
							))}
						</>
					)}
				</section>
			</div>

			{failed && "reason" in failed && (
				<p className="menu-alert" role="alert">
					{t("creator_failed", { done: failed.done, reason: failed.reason })}
				</p>
			)}

			<div className="editor__bar creator-bar">
				<fetcher.Form method="post">
					<input type="hidden" name="plan" value={JSON.stringify(parsed)} />
					<button
						type="submit"
						className="btn btn--primary"
						disabled={busy || newCount === 0 || parsed.issues.length > 0}
					>
						{busy
							? t("saving")
							: t("creator_create", {
									products: newCount,
									categories: newCats,
								})}
					</button>
				</fetcher.Form>
				<span className="muted small">
					{parsed.issues.length > 0
						? t("creator_fix_first")
						: t("creator_photo_note")}
				</span>
			</div>
		</div>
	);
}
