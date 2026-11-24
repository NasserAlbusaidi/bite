import { useEffect, useMemo, useState } from "react";
import {
	Form,
	Link,
	redirect,
	useFetcher,
	useNavigation,
	useSearchParams,
} from "react-router";
import "../menu.css";
import { Thumb } from "../components/Thumb";
import { adminApi } from "../lib/api";
import type { AdminCategory, AdminProduct } from "../lib/contracts";
import { loc, type MessageKey } from "../lib/i18n";
import {
	bySort,
	duplicateOf,
	endOf,
	filterCounts,
	MENU_FILTERS,
	type MenuFilter,
	matchesFilter,
	matchesQuery,
	moveBy,
	moveTo,
	reorderBody,
	sortedCategories,
} from "../lib/menu-view";
import { toDecimal } from "../lib/money";
import { catalogPowers } from "../lib/permissions";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/menu";

export async function clientLoader() {
	return { menu: await adminApi().menu() };
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const ids = (f: FormData) => {
	try {
		const v: unknown = JSON.parse(str(f, "ids") || "[]");
		return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
	} catch {
		return [];
	}
};

export async function clientAction({ request }: Route.ClientActionArgs) {
	const form = await request.formData();
	const api = adminApi();
	const intent = str(form, "intent");
	try {
		switch (intent) {
			case "createCategory": {
				const en = str(form, "nameEn");
				const ar = str(form, "nameAr");
				if (!en) return { error: "required_field" as const, intent };
				const menu = await api.menu();
				await api.createCategory({
					name: ar ? { en, ar } : { en },
					sortOrder: menu.categories.length,
				});
				return { ok: true as const, intent };
			}
			case "renameCategory": {
				const en = str(form, "nameEn");
				const ar = str(form, "nameAr");
				if (!en) return { error: "required_field" as const, intent };
				await api.updateCategory(str(form, "id"), {
					name: ar ? { en, ar } : { en },
				});
				return { ok: true as const, intent };
			}
			case "setCategoryActive":
				await api.updateCategory(str(form, "id"), {
					isActive: str(form, "active") === "true",
				});
				return { ok: true as const, intent };
			case "reorderCategories":
				await api.reorderCategories(reorderBody(ids(form)));
				return { ok: true as const, intent };
			case "reorderProducts":
				await api.reorderProducts(reorderBody(ids(form)));
				return { ok: true as const, intent };
			case "setVisible":
				await api.updateProduct(str(form, "id"), {
					isVisible: str(form, "visible") === "true",
				});
				return { ok: true as const, intent };
			case "duplicate": {
				const menu = await api.menu();
				const src = menu.products.find((p) => p.id === str(form, "id"));
				if (!src) return { error: "menu_save_failed" as const, intent };
				const copy = await api.createProduct(
					duplicateOf(src, endOf(menu.products, src.categoryId), {
						en: str(form, "suffixEn"),
						ar: str(form, "suffixAr"),
					}),
				);
				return redirect(`/menu/products/${copy.id}?copied=1`);
			}
			case "bulk": {
				const list = ids(form);
				const action = str(form, "action");
				if (action === "hide" || action === "show") {
					for (const id of list)
						await api.updateProduct(id, { isVisible: action === "show" });
				} else if (action === "move") {
					const categoryId = str(form, "categoryId");
					const menu = await api.menu();
					let next = endOf(menu.products, categoryId);
					for (const id of list)
						await api.updateProduct(id, { categoryId, sortOrder: next++ });
				} else if (action === "archive") {
					for (const id of list) await api.archiveProduct(id);
				}
				return { ok: true as const, intent, cleared: true };
			}
		}
	} catch {
		return { error: "menu_save_failed" as const, intent };
	}
	return null;
}

type Action = Awaited<ReturnType<typeof clientAction>>;
const failed = (d: Action | undefined): MessageKey | null =>
	d && "error" in d ? d.error : null;

export default function MenuPage({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { menu } = loaderData;
	const { t, lang, place, me, locationId } = useShell();
	const { canEditMenu } = catalogPowers(me);
	const nav = useNavigation();
	const [params, setParams] = useSearchParams();
	const q = params.get("q") ?? "";
	const filter = (params.get("show") ?? "all") as MenuFilter;
	const added = Number(params.get("added") ?? 0) || 0;
	const setParam = (k: string, v: string) =>
		setParams(
			(p) => {
				if (v && v !== "all") p.set(k, v);
				else p.delete(k);
				return p;
			},
			{ replace: true, preventScrollReset: true },
		);

	// Reorders show at once; the server's answer replaces them on revalidate.
	const [catOrder, setCatOrder] = useState<string[] | null>(null);
	const [prodOrder, setProdOrder] = useState<Record<string, string[]>>({});
	const [selected, setSelected] = useState<Set<string>>(new Set());
	useEffect(() => {
		setCatOrder(null);
		setProdOrder({});
		// Drop selections of products that moved away or were archived.
		setSelected((s) => {
			const live = new Set(
				menu.products.filter((p) => !p.archivedAt).map((p) => p.id),
			);
			const next = new Set([...s].filter((id) => live.has(id)));
			return next.size === s.size ? s : next;
		});
	}, [menu]);

	const reorder = useFetcher<typeof clientAction>();
	const bulk = useFetcher<typeof clientAction>();
	useEffect(() => {
		if (bulk.state === "idle" && bulk.data && "cleared" in bulk.data)
			setSelected(new Set());
	}, [bulk.state, bulk.data]);

	const live = useMemo(
		() => menu.products.filter((p) => !p.archivedAt),
		[menu.products],
	);
	const counts = useMemo(() => filterCounts(live), [live]);
	const groups = useMemo(
		() => new Map(menu.modifierGroups.map((g) => [g.id, g])),
		[menu.modifierGroups],
	);
	const byId = useMemo(() => new Map(live.map((p) => [p.id, p])), [live]);
	const narrowing = q.trim() !== "" || filter !== "all";

	const cats = (() => {
		const base = sortedCategories(menu.categories);
		if (!catOrder) return base;
		const m = new Map(base.map((c) => [c.id, c]));
		return catOrder.map((id) => m.get(id)).filter((c) => !!c);
	})();
	const productsOf = (c: AdminCategory) => {
		const own = prodOrder[c.id];
		const list = own
			? own.map((id) => byId.get(id)).filter((p) => !!p)
			: live.filter((p) => p.categoryId === c.id).sort(bySort);
		return list.filter((p) => matchesFilter(p, filter) && matchesQuery(p, q));
	};

	const commitCats = (next: string[]) => {
		setCatOrder(next);
		reorder.submit(
			{ intent: "reorderCategories", ids: JSON.stringify(next) },
			{ method: "post" },
		);
	};
	const commitProducts = (categoryId: string, next: string[]) => {
		setProdOrder((o) => ({ ...o, [categoryId]: next }));
		reorder.submit(
			{ intent: "reorderProducts", ids: JSON.stringify(next) },
			{ method: "post" },
		);
	};

	const [drag, setDrag] = useState<{
		kind: "cat" | "product";
		id: string;
		categoryId?: string;
	} | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const canDrag = canEditMenu && !narrowing;

	const toggle = (id: string, on: boolean) =>
		setSelected((s) => {
			const n = new Set(s);
			if (on) n.add(id);
			else n.delete(id);
			return n;
		});

	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const error =
		failed(reorder.data) ??
		failed(bulk.data) ??
		failed(actionData as Action | undefined);
	const shown = cats.map((c) => ({ c, products: productsOf(c) }));
	const anyShown = shown.some((s) => s.products.length > 0);

	return (
		<div className="menu-page">
			<div className="page-head">
				<div>
					<h1>{t("menu")}</h1>
					<p className="muted small">
						{t("menu_summary", {
							products: live.length,
							categories: menu.categories.length,
						})}
					</p>
				</div>
				<div className="actions-row">
					{canEditMenu && (
						<Link className="btn" to="/menu/create">
							{t("creator_open")}
						</Link>
					)}
					<Link className="btn" to="/menu/modifiers">
						{t("options_title")}
					</Link>
					{locationId && (
						<Link className="btn" to={`/locations/${locationId}/menu`}>
							{t("prices_availability")}
						</Link>
					)}
					{canEditMenu && (
						<Link className="btn btn--primary" to="/menu/products/new">
							{t("new_product")}
						</Link>
					)}
				</div>
			</div>

			{!canEditMenu && <p className="card muted">{t("menu_owner_only")}</p>}

			{added > 0 && (
				<p className="menu-note" role="status">
					{t("creator_done", { n: added })}
				</p>
			)}

			{error && (
				<p className="menu-alert" role="alert">
					{t(error)}
				</p>
			)}

			{menu.categories.length === 0 ? (
				<section className="card menu-empty">
					<h2>{t("menu_empty_title")}</h2>
					<p className="muted">{t("menu_empty_body")}</p>
					{canEditMenu && (
						<Link className="btn btn--primary" to="/menu/create">
							{t("creator_empty_cta")}
						</Link>
					)}
				</section>
			) : (
				<div className="menu-toolbar">
					<input
						type="search"
						className="input"
						placeholder={t("search")}
						value={q}
						onChange={(e) => setParam("q", e.target.value)}
						aria-label={t("search")}
					/>
					<div className="menu-filters">
						{MENU_FILTERS.map((f) => (
							<button
								key={f}
								type="button"
								className={`chip${filter === f ? " chip--on" : ""}`}
								aria-pressed={filter === f}
								onClick={() => setParam("show", f)}
							>
								{t(`filter_${f}` as MessageKey)}
								<span className="menu-count">{counts[f]}</span>
							</button>
						))}
					</div>
					{cats.length > 1 && (
						<nav className="menu-jump" aria-label={t("jump_to_category")}>
							{shown.map(({ c, products }) => (
								<a
									key={c.id}
									href={`#cat-${c.id}`}
									className={`menu-jump__link${products.length === 0 && narrowing ? " is-empty" : ""}`}
								>
									{loc(c.name, lang)}
								</a>
							))}
						</nav>
					)}
				</div>
			)}

			{narrowing && !anyShown && (
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
				{shown.map(({ c, products }, ci) => {
					if (narrowing && products.length === 0) return null;
					const allIds = products.map((p) => p.id);
					const allOn =
						allIds.length > 0 && allIds.every((id) => selected.has(id));
					return (
						<li
							key={c.id}
							id={`cat-${c.id}`}
							className={`card menu-cat${over === c.id && drag?.kind === "cat" ? " is-over" : ""}${c.isActive ? "" : " is-off"}`}
							onDragOver={(e) => {
								if (drag?.kind !== "cat") return;
								e.preventDefault();
								setOver(c.id);
							}}
							onDrop={(e) => {
								if (drag?.kind !== "cat") return;
								e.preventDefault();
								const next = moveTo(
									cats.map((x) => x.id),
									drag.id,
									c.id,
								);
								setDrag(null);
								setOver(null);
								if (next.join() !== cats.map((x) => x.id).join())
									commitCats(next);
							}}
						>
							<CategoryHead
								category={c}
								count={products.length}
								canEdit={canEditMenu}
								canDrag={canDrag}
								first={ci === 0}
								last={ci === cats.length - 1}
								onMove={(step) =>
									commitCats(
										moveBy(
											cats.map((x) => x.id),
											c.id,
											step,
										),
									)
								}
								onDragStart={() => setDrag({ kind: "cat", id: c.id })}
								onDragEnd={() => {
									setDrag(null);
									setOver(null);
								}}
								selectAll={
									canEditMenu && products.length > 0
										? {
												on: allOn,
												set: (on) =>
													setSelected((s) => {
														const n = new Set(s);
														for (const id of allIds)
															on ? n.add(id) : n.delete(id);
														return n;
													}),
											}
										: undefined
								}
							/>
							{products.length === 0 ? (
								<p className="muted small menu-cat__empty">
									{t("category_empty_cta")}{" "}
									{canEditMenu && (
										<Link to={`/menu/products/new?category=${c.id}`}>
											{t("add_product_here")}
										</Link>
									)}
								</p>
							) : (
								<ul className="menu-items">
									{products.map((p, pi) => (
										<ProductRow
											key={p.id}
											product={p}
											groupNames={p.modifierGroupIds
												.map((g) => groups.get(g))
												.filter((g) => !!g)
												.map((g) => loc(g.name, lang))}
											price={`${toDecimal(p.price, decimals)} ${currency}`}
											canEdit={canEditMenu}
											canDrag={canDrag}
											selected={selected.has(p.id)}
											onSelect={(on) => toggle(p.id, on)}
											first={pi === 0}
											last={pi === products.length - 1}
											isOver={over === p.id && drag?.kind === "product"}
											onMove={(step) =>
												commitProducts(c.id, moveBy(allIds, p.id, step))
											}
											onDragStart={() =>
												setDrag({
													kind: "product",
													id: p.id,
													categoryId: c.id,
												})
											}
											onDragEnd={() => {
												setDrag(null);
												setOver(null);
											}}
											onDragOver={(e) => {
												if (
													drag?.kind !== "product" ||
													drag.categoryId !== c.id
												)
													return;
												e.preventDefault();
												e.stopPropagation();
												setOver(p.id);
											}}
											onDrop={(e) => {
												if (
													drag?.kind !== "product" ||
													drag.categoryId !== c.id
												)
													return;
												e.preventDefault();
												e.stopPropagation();
												const next = moveTo(allIds, drag.id, p.id);
												setDrag(null);
												setOver(null);
												if (next.join() !== allIds.join())
													commitProducts(c.id, next);
											}}
										/>
									))}
								</ul>
							)}
						</li>
					);
				})}
			</ol>

			{canEditMenu && (
				<section className="card">
					<h2>{t("new_category")}</h2>
					<Form
						method="post"
						className="inline-form"
						key={menu.categories.length}
					>
						<input type="hidden" name="intent" value="createCategory" />
						<label>
							{t("category_name_en")}
							<input name="nameEn" className="input" required />
						</label>
						<label>
							{t("category_name_ar")}
							<input name="nameAr" className="input" dir="rtl" lang="ar" />
						</label>
						<button
							type="submit"
							className="btn"
							disabled={nav.state !== "idle"}
						>
							{t("add_category")}
						</button>
					</Form>
				</section>
			)}

			{canEditMenu && selected.size > 0 && (
				<BulkBar
					count={selected.size}
					categories={cats}
					busy={bulk.state !== "idle"}
					onClear={() => setSelected(new Set())}
					run={(action, categoryId) => {
						if (
							action === "archive" &&
							!window.confirm(t("bulk_archive_confirm", { n: selected.size }))
						)
							return;
						bulk.submit(
							{
								intent: "bulk",
								action,
								categoryId: categoryId ?? "",
								ids: JSON.stringify([...selected]),
							},
							{ method: "post" },
						);
					}}
				/>
			)}
		</div>
	);
}

function CategoryHead({
	category: c,
	count,
	canEdit,
	canDrag,
	first,
	last,
	onMove,
	onDragStart,
	onDragEnd,
	selectAll,
}: {
	category: AdminCategory;
	count: number;
	canEdit: boolean;
	canDrag: boolean;
	first: boolean;
	last: boolean;
	onMove: (step: -1 | 1) => void;
	onDragStart: () => void;
	onDragEnd: () => void;
	selectAll?: { on: boolean; set: (on: boolean) => void } | undefined;
}) {
	const { t, lang } = useShell();
	const fetcher = useFetcher<typeof clientAction>();
	const [editing, setEditing] = useState(false);
	useEffect(() => {
		if (
			fetcher.state === "idle" &&
			fetcher.data &&
			"ok" in fetcher.data &&
			fetcher.data.intent === "renameCategory"
		)
			setEditing(false);
	}, [fetcher.state, fetcher.data]);
	const pendingActive = fetcher.formData?.get("active");
	const active =
		pendingActive === undefined || pendingActive === null
			? c.isActive
			: pendingActive === "true";
	const name = loc(c.name, lang);
	const other = lang === "ar" ? c.name.en : c.name.ar;

	if (editing)
		return (
			<fetcher.Form method="post" className="inline-form menu-cat__rename">
				<input type="hidden" name="intent" value="renameCategory" />
				<input type="hidden" name="id" value={c.id} />
				<label>
					{t("category_name_en")}
					<input
						name="nameEn"
						className="input"
						defaultValue={c.name.en}
						required
						// biome-ignore lint/a11y/noAutofocus: the user just asked to rename
						autoFocus
					/>
				</label>
				<label>
					{t("category_name_ar")}
					<input
						name="nameAr"
						className="input"
						dir="rtl"
						lang="ar"
						defaultValue={c.name.ar ?? ""}
					/>
				</label>
				<div className="actions-row">
					<button
						type="submit"
						className="btn btn--primary"
						disabled={fetcher.state !== "idle"}
					>
						{t("save")}
					</button>
					<button
						type="button"
						className="btn"
						onClick={() => setEditing(false)}
					>
						{t("cancel")}
					</button>
				</div>
			</fetcher.Form>
		);

	return (
		<div className="menu-cat__head">
			{canDrag && (
				<span
					className="menu-grip"
					draggable
					onDragStart={(e) => {
						e.dataTransfer.effectAllowed = "move";
						e.dataTransfer.setData("text/plain", c.id);
						onDragStart();
					}}
					onDragEnd={onDragEnd}
					title={t("drag_to_reorder")}
					aria-hidden="true"
				/>
			)}
			{selectAll && (
				<input
					type="checkbox"
					className="menu-check"
					checked={selectAll.on}
					onChange={(e) => selectAll.set(e.currentTarget.checked)}
					aria-label={t("select_all_in", { category: name })}
				/>
			)}
			<div className="menu-cat__title">
				<h2>
					{name}
					<span className="menu-count">{count}</span>
					{!active && <span className="tag">{t("inactive")}</span>}
				</h2>
				{other && other !== name && (
					<span className="muted small">
						<bdi>{other}</bdi>
					</span>
				)}
				{!active && (
					<span className="muted small">{t("category_off_hint")}</span>
				)}
			</div>
			{canEdit && (
				<div className="menu-cat__actions">
					<Link
						className="btn btn--sm"
						to={`/menu/products/new?category=${c.id}`}
					>
						{t("add_product_here")}
					</Link>
					<button
						type="button"
						className="btn btn--sm btn--ghost"
						onClick={() => setEditing(true)}
					>
						{t("rename")}
					</button>
					<fetcher.Form method="post">
						<input type="hidden" name="intent" value="setCategoryActive" />
						<input type="hidden" name="id" value={c.id} />
						<input type="hidden" name="active" value={String(!active)} />
						<button type="submit" className="btn btn--sm btn--ghost">
							{active ? t("hide_from_menu") : t("show_on_menu")}
						</button>
					</fetcher.Form>
					<span className="menu-steps">
						<button
							type="button"
							className="icon-btn"
							disabled={first}
							onClick={() => onMove(-1)}
							aria-label={`${t("move_up")}: ${name}`}
							title={t("move_up")}
						>
							↑
						</button>
						<button
							type="button"
							className="icon-btn"
							disabled={last}
							onClick={() => onMove(1)}
							aria-label={`${t("move_down")}: ${name}`}
							title={t("move_down")}
						>
							↓
						</button>
					</span>
				</div>
			)}
		</div>
	);
}

function ProductRow({
	product: p,
	groupNames,
	price,
	canEdit,
	canDrag,
	selected,
	onSelect,
	first,
	last,
	isOver,
	onMove,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDrop,
}: {
	product: AdminProduct;
	groupNames: string[];
	price: string;
	canEdit: boolean;
	canDrag: boolean;
	selected: boolean;
	onSelect: (on: boolean) => void;
	first: boolean;
	last: boolean;
	isOver: boolean;
	onMove: (step: -1 | 1) => void;
	onDragStart: () => void;
	onDragEnd: () => void;
	onDragOver: (e: React.DragEvent) => void;
	onDrop: (e: React.DragEvent) => void;
}) {
	const { t, lang } = useShell();
	const vis = useFetcher<typeof clientAction>();
	const dup = useFetcher<typeof clientAction>();
	const pending = vis.formData?.get("visible");
	const visible =
		pending === undefined || pending === null
			? p.isVisible
			: pending === "true";
	const name = loc(p.name, lang);
	const other = lang === "ar" ? p.name.en : p.name.ar;

	return (
		<li
			className={`menu-item${visible ? "" : " is-hidden"}${selected ? " is-selected" : ""}${isOver ? " is-over" : ""}`}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			{canDrag && (
				<span
					className="menu-grip"
					draggable
					onDragStart={(e) => {
						e.dataTransfer.effectAllowed = "move";
						e.dataTransfer.setData("text/plain", p.id);
						onDragStart();
					}}
					onDragEnd={onDragEnd}
					title={t("drag_to_reorder")}
					aria-hidden="true"
				/>
			)}
			{canEdit && (
				<input
					type="checkbox"
					className="menu-check"
					checked={selected}
					onChange={(e) => onSelect(e.currentTarget.checked)}
					aria-label={t("select_product", { name })}
				/>
			)}
			<Thumb url={p.imageUrl} name={name} />
			<div className="menu-item__body">
				<Link
					to={canEdit ? `/menu/products/${p.id}` : "#"}
					className="menu-item__name"
					onClick={canEdit ? undefined : (e) => e.preventDefault()}
				>
					{name}
				</Link>
				{other && other !== name && (
					<span className="muted small">
						<bdi>{other}</bdi>
					</span>
				)}
				<span className="menu-item__meta">
					{!visible && <span className="tag">{t("hidden")}</span>}
					{!p.imageUrl && (
						<span className="tag tag--soft">{t("filter_no_photo")}</span>
					)}
					{!p.name.ar && (
						<span className="tag tag--soft">{t("filter_no_arabic")}</span>
					)}
					{groupNames.length > 0 && (
						<span className="muted small">{groupNames.join(" · ")}</span>
					)}
				</span>
			</div>
			<bdi dir="ltr" className="menu-item__price">
				{price}
			</bdi>
			{canEdit && (
				<div className="menu-item__actions">
					<vis.Form method="post" className="menu-switch">
						<input type="hidden" name="intent" value="setVisible" />
						<input type="hidden" name="id" value={p.id} />
						<label className={`toggle${visible ? "" : " toggle--off"}`}>
							<input
								type="checkbox"
								name="visible"
								value="true"
								checked={visible}
								onChange={(e) =>
									vis.submit(
										{
											intent: "setVisible",
											id: p.id,
											visible: String(e.currentTarget.checked),
										},
										{ method: "post" },
									)
								}
								aria-label={t("visible_toggle", { name })}
							/>
							<span>{visible ? t("on_menu") : t("hidden")}</span>
						</label>
					</vis.Form>
					<dup.Form method="post">
						<input type="hidden" name="intent" value="duplicate" />
						<input type="hidden" name="id" value={p.id} />
						<input type="hidden" name="suffixEn" value="(copy)" />
						<input type="hidden" name="suffixAr" value="(نسخة)" />
						<button
							type="submit"
							className="btn btn--sm btn--ghost"
							disabled={dup.state !== "idle"}
						>
							{t("duplicate")}
						</button>
					</dup.Form>
					<span className="menu-steps">
						<button
							type="button"
							className="icon-btn"
							disabled={first || !canDrag}
							onClick={() => onMove(-1)}
							aria-label={`${t("move_up")}: ${name}`}
							title={t("move_up")}
						>
							↑
						</button>
						<button
							type="button"
							className="icon-btn"
							disabled={last || !canDrag}
							onClick={() => onMove(1)}
							aria-label={`${t("move_down")}: ${name}`}
							title={t("move_down")}
						>
							↓
						</button>
					</span>
				</div>
			)}
		</li>
	);
}

function BulkBar({
	count,
	categories,
	busy,
	onClear,
	run,
}: {
	count: number;
	categories: AdminCategory[];
	busy: boolean;
	onClear: () => void;
	run: (
		action: "hide" | "show" | "move" | "archive",
		categoryId?: string,
	) => void;
}) {
	const { t, lang } = useShell();
	return (
		<div
			className="menu-bulk"
			role="toolbar"
			aria-label={t("selected_count", { n: count })}
		>
			<strong>{t("selected_count", { n: count })}</strong>
			<button
				type="button"
				className="btn btn--sm"
				disabled={busy}
				onClick={() => run("show")}
			>
				{t("bulk_show")}
			</button>
			<button
				type="button"
				className="btn btn--sm"
				disabled={busy}
				onClick={() => run("hide")}
			>
				{t("bulk_hide")}
			</button>
			<select
				className="input input--sm"
				value=""
				disabled={busy}
				aria-label={t("bulk_move")}
				onChange={(e) => {
					if (e.currentTarget.value) run("move", e.currentTarget.value);
				}}
			>
				<option value="">{t("bulk_move")}</option>
				{categories.map((c) => (
					<option key={c.id} value={c.id}>
						{loc(c.name, lang)}
					</option>
				))}
			</select>
			<button
				type="button"
				className="btn btn--sm btn--danger"
				disabled={busy}
				onClick={() => run("archive")}
			>
				{t("archive")}
			</button>
			<button
				type="button"
				className="btn btn--sm btn--ghost"
				onClick={onClear}
			>
				{t("clear_selection")}
			</button>
		</div>
	);
}
