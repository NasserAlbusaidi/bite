import { Icon, Logo, ToastProvider, UiProvider } from "@bite/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	NavLink,
	Outlet,
	redirect,
	useLocation,
	useNavigate,
	useParams,
	useRevalidator,
} from "react-router";
import { type Command, CommandPalette } from "../components/CommandPalette";
import { FlashToasts } from "../components/FlashToasts";
import { SupportBanner } from "../components/SupportBanner";
import { adminGate, saveOrg } from "../lib/account";
import { account, adminApi, isDemo } from "../lib/api";
import {
	loc,
	type MessageKey,
	savedLang,
	saveLang,
	translator,
} from "../lib/i18n";
import { currentNav, type NavGroup, navItems } from "../lib/nav";
import { catalogPowers, staffPowers } from "../lib/permissions";
import { loadPlaces } from "../lib/places";
import { rememberLocation, selectedLocationId } from "../lib/selected-location";
import { initials } from "../lib/staff-list";
import { applyTheme, nextTheme, savedTheme, type Theme } from "../lib/theme";
import type { Route } from "./+types/shell";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const api = adminApi();
	let me: Awaited<ReturnType<typeof api.me>>;
	try {
		me = await api.me();
	} catch (e) {
		const url = new URL(request.url);
		const gate = adminGate(e, url.pathname + url.search);
		if (!gate) throw e;
		if (gate.clearOrg) saveOrg(null);
		throw redirect(gate.to);
	}
	const places = await loadPlaces(api);
	return {
		me,
		places,
		locationId: selectedLocationId(places),
		demo: isDemo(),
		lang: savedLang(),
	};
}

const GROUPS: { id: NavGroup; label?: MessageKey }[] = [
	{ id: "main" },
	{ id: "menu", label: "nav_group_menu" },
	{ id: "business", label: "nav_group_business" },
];

const THEME_ICON = { system: "monitor", light: "sun", dark: "moon" } as const;

type Extra = { staff: Command[]; products: Command[] };

export default function Shell({ loaderData }: Route.ComponentProps) {
	const { me, places, demo, lang } = loaderData;
	const t = translator(lang);
	const params = useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const { revalidate } = useRevalidator();
	const locationId = params.locationId ?? loaderData.locationId;
	const place = places.find((p) => p.id === locationId);
	const items = navItems(locationId);
	const here = currentNav(items, location.pathname);

	const [theme, setTheme] = useState<Theme>(() => savedTheme());
	const [drawer, setDrawer] = useState(false);
	const [palette, setPalette] = useState(false);
	const [extra, setExtra] = useState<Extra | null>(null);

	useEffect(() => saveLang(lang), [lang]);
	useEffect(() => applyTheme(theme), [theme]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer whenever the address changes
	useEffect(() => setDrawer(false), [location.pathname]);

	useEffect(() => {
		const page = here ? t(here.key) : t("overview");
		document.title = `${page} · ${me.org.name}`;
	}, [here, me.org.name, t]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setPalette((o) => !o);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const switchBranch = useCallback(
		(id: string) => {
			rememberLocation(id);
			if (params.locationId)
				navigate(
					location.pathname.replace(
						`/locations/${params.locationId}/`,
						`/locations/${id}/`,
					),
				);
			else revalidate();
		},
		[params.locationId, location.pathname, navigate, revalidate],
	);

	const toggleLang = useCallback(() => {
		saveLang(lang === "en" ? "ar" : "en");
		setExtra(null);
		revalidate();
	}, [lang, revalidate]);

	const signOut = useCallback(async () => {
		await account()
			?.signOut()
			.catch(() => undefined);
		saveOrg(null);
		navigate("/sign-in");
	}, [navigate]);

	// Staff and products for the palette, fetched the first time it opens.
	useEffect(() => {
		if (!palette || extra) return;
		let gone = false;
		const api = adminApi();
		Promise.all([
			api.staff().catch(() => []),
			api.menu().catch(() => null),
		]).then(([staff, menu]) => {
			if (gone) return;
			setExtra({
				staff: staff
					.filter((s) => s.isActive)
					.map((s) => ({
						id: `staff-${s.id}`,
						label: s.displayName,
						keywords: s.email ? [s.email] : [],
						group: t("staff"),
						icon: "user",
						run: () => navigate(`/staff/${s.id}`),
					})),
				products: (menu?.products ?? [])
					.filter((p) => !p.archivedAt)
					.map((p) => ({
						id: `product-${p.id}`,
						label: loc(p.name, lang),
						keywords: [p.name.en, p.name.ar ?? ""],
						group: t("palette_products"),
						icon: "bag",
						run: () => navigate(`/menu/products/${p.id}`),
					})),
			});
		});
		return () => {
			gone = true;
		};
	}, [palette, extra, lang, navigate, t]);

	const commands = useMemo<Command[]>(() => {
		const staff = staffPowers(me);
		const catalog = catalogPowers(me);
		const pages: Command[] = [
			...items.map((i) => ({
				id: `page-${i.to}`,
				label: t(i.key),
				group: t("palette_pages"),
				icon: i.icon,
				run: () => navigate(i.to),
			})),
			{
				id: "page-account",
				label: t("account"),
				group: t("palette_pages"),
				icon: "user",
				run: () => navigate("/account"),
			},
		];
		const branches: Command[] = places.map((p) => ({
			id: `branch-${p.id}`,
			label: t("switch_to_branch", { name: p.name }),
			keywords: [p.name],
			hint: p.id === locationId ? t("current_branch") : undefined,
			group: t("palette_branches"),
			icon: "store",
			run: () => switchBranch(p.id),
		}));
		const actions: (Command | false)[] = [
			{
				id: "act-pin",
				label: t("add_pin_staff"),
				group: t("palette_actions"),
				icon: "plus",
				run: () => navigate("/staff/new?kind=pin"),
			},
			staff.canInvite && {
				id: "act-invite",
				label: t("invite_manager"),
				group: t("palette_actions"),
				icon: "plus",
				run: () => navigate("/staff/new?kind=invite"),
			},
			catalog.canEditMenu && {
				id: "act-product",
				label: t("new_product"),
				group: t("palette_actions"),
				icon: "plus",
				run: () => navigate("/menu/products/new"),
			},
			{
				id: "act-theme",
				label: t("theme_set", { name: t(`theme_${nextTheme(theme)}`) }),
				keywords: [t("theme")],
				group: t("palette_actions"),
				icon: THEME_ICON[nextTheme(theme)],
				run: () => setTheme(nextTheme(theme)),
			},
			{
				id: "act-lang",
				label: t("switch_language"),
				keywords: ["arabic", "english", "عربي", "language", "اللغة"],
				group: t("palette_actions"),
				icon: "globe",
				run: toggleLang,
			},
			!demo && {
				id: "act-out",
				label: t("sign_out"),
				group: t("palette_actions"),
				icon: "logout",
				run: signOut,
			},
		];
		return [
			...pages,
			...branches,
			...actions.filter((a): a is Command => a !== false),
			...(extra?.staff ?? []),
			...(extra?.products ?? []),
		];
	}, [
		items,
		places,
		locationId,
		me,
		theme,
		demo,
		extra,
		t,
		navigate,
		switchBranch,
		toggleLang,
		signOut,
	]);

	const role = me.member.orgRole;
	const mac =
		typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform);

	return (
		<UiProvider lang={lang}>
			<ToastProvider>
				<FlashToasts />
				<div className="app" data-drawer={drawer ? "open" : undefined}>
					<header className="mobilebar">
						<button
							type="button"
							className="icon-btn"
							aria-label={t("open_nav")}
							aria-expanded={drawer}
							aria-controls="sidebar"
							onClick={() => setDrawer(true)}
						>
							<Icon name="menu-lines" />
						</button>
						<span className="mobilebar__title">
							{here ? t(here.key) : me.org.name}
						</span>
						<button
							type="button"
							className="icon-btn"
							aria-label={t("search_anything")}
							onClick={() => setPalette(true)}
						>
							<Icon name="search" />
						</button>
					</header>
					<button
						type="button"
						className="scrim"
						aria-label={t("close_nav")}
						tabIndex={-1}
						onClick={() => setDrawer(false)}
					/>
					<aside className="sidebar" id="sidebar">
						<div className="sidebar__brand">
							<Logo height={22} className="brand__mark" />
							<span className="sidebar__org" title={me.org.name}>
								{me.org.name}
							</span>
							{!demo && (
								<NavLink
									className="icon-btn icon-btn--sm"
									to="/orgs?switch=1"
									aria-label={t("switch_business")}
									title={t("switch_business")}
								>
									<Icon name="chevrons-updown" />
								</NavLink>
							)}
						</div>
						{places.length > 0 && (
							<label className="branch-switch">
								<Icon name="store" className="branch-switch__icon" />
								<span className="branch-switch__text">
									<span className="branch-switch__label">{t("branch")}</span>
									<span className="branch-switch__name">
										{place?.name ?? "—"}
									</span>
								</span>
								{places.length > 1 && (
									<Icon
										name="chevrons-updown"
										className="branch-switch__chev"
									/>
								)}
								<select
									value={locationId}
									disabled={places.length < 2}
									aria-label={t("branch")}
									onChange={(e) => switchBranch(e.target.value)}
								>
									{places.map((l) => (
										<option key={l.id} value={l.id}>
											{l.name}
										</option>
									))}
								</select>
							</label>
						)}
						<button
							type="button"
							className="search-btn"
							onClick={() => setPalette(true)}
						>
							<Icon name="search" />
							<span>{t("search_short")}</span>
							<kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
						</button>
						<nav className="sidenav" aria-label="Main">
							{GROUPS.map((g) => {
								const list = items.filter((i) => i.group === g.id);
								if (list.length === 0) return null;
								return (
									<div key={g.id} className="sidenav__group">
										{g.label && (
											<span className="sidenav__label">{t(g.label)}</span>
										)}
										{list.map((i) => (
											<NavLink
												key={i.key}
												to={i.to}
												end={i.end ?? false}
												className={() =>
													here?.key === i.key ? "active" : undefined
												}
												aria-current={here?.key === i.key ? "page" : undefined}
											>
												<Icon name={i.icon} className="nav-ico" />
												<span>{t(i.key)}</span>
											</NavLink>
										))}
									</div>
								);
							})}
						</nav>
						<div className="sidebar__foot">
							<NavLink to="/account" className="me-chip" title={t("account")}>
								<span className="avatar" aria-hidden="true">
									{initials(me.member.displayName)}
								</span>
								<span className="me-chip__text">
									<span className="me-chip__name">{me.member.displayName}</span>
									<span className="me-chip__role">
										{t(`role_${role}_short`)}
									</span>
								</span>
							</NavLink>
							<div className="foot-actions">
								<button
									type="button"
									className="icon-btn"
									onClick={() => setTheme(nextTheme(theme))}
									aria-label={t("theme_set", { name: t(`theme_${theme}`) })}
									title={t("theme_set", { name: t(`theme_${theme}`) })}
								>
									<Icon name={THEME_ICON[theme]} />
								</button>
								<button
									type="button"
									className="icon-btn lang-btn"
									lang={lang === "en" ? "ar" : "en"}
									onClick={toggleLang}
									aria-label={t("switch_language")}
									title={t("switch_language")}
								>
									{lang === "en" ? "ع" : "EN"}
								</button>
								{!demo && (
									<button
										type="button"
										className="icon-btn"
										onClick={signOut}
										aria-label={t("sign_out")}
										title={t("sign_out")}
									>
										<Icon name="logout" />
									</button>
								)}
							</div>
						</div>
					</aside>
					<div className="main">
						{demo && <p className="demo">{t("demo_banner")}</p>}
						{me.support && (
							<SupportBanner
								orgId={me.org.id}
								orgName={me.org.name}
								lang={lang}
							/>
						)}
						<main className="content">
							<Outlet />
						</main>
					</div>
					<CommandPalette
						open={palette}
						onClose={() => setPalette(false)}
						commands={commands}
						t={t}
					/>
				</div>
			</ToastProvider>
		</UiProvider>
	);
}
