import { Logo } from "@bite/ui";
import { useEffect } from "react";
import {
	NavLink,
	Outlet,
	redirect,
	useLocation,
	useNavigate,
	useParams,
	useRevalidator,
} from "react-router";
import { adminGate, saveOrg } from "../lib/account";
import { account, adminApi, isDemo } from "../lib/api";
import { savedLang, saveLang, translator } from "../lib/i18n";
import { loadPlaces } from "../lib/places";
import { rememberLocation, selectedLocationId } from "../lib/selected-location";
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

export default function Shell({ loaderData }: Route.ComponentProps) {
	const { me, places, demo, lang } = loaderData;
	const t = translator(lang);
	const params = useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const { revalidate } = useRevalidator();
	const locationId = params.locationId ?? loaderData.locationId;

	useEffect(() => saveLang(lang), [lang]);

	return (
		<div className="app">
			<header className="topbar">
				<span className="brand">
					<Logo height={20} className="brand__mark" />
					<strong>{me.org.name}</strong>
				</span>
				{places.length > 0 && (
					<label className="loc-switch">
						<span className="sr-only">{t("location")}</span>
						<select
							value={locationId}
							onChange={(e) => {
								rememberLocation(e.target.value);
								if (params.locationId)
									navigate(
										location.pathname.replace(
											`/locations/${params.locationId}/`,
											`/locations/${e.target.value}/`,
										),
									);
								else revalidate();
							}}
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
					className="link-btn"
					lang={lang === "en" ? "ar" : "en"}
					onClick={() => {
						saveLang(lang === "en" ? "ar" : "en");
						revalidate();
					}}
				>
					{t("language")}
				</button>
				<span className="muted small">{me.member.displayName}</span>
				{!demo && (
					<NavLink className="link-btn small" to="/orgs?switch=1">
						{t("switch_business")}
					</NavLink>
				)}
				{!demo && (
					<button
						type="button"
						className="link-btn"
						onClick={async () => {
							await account()
								?.signOut()
								.catch(() => undefined);
							saveOrg(null);
							navigate("/sign-in");
						}}
					>
						{t("sign_out")}
					</button>
				)}
			</header>
			{demo && <p className="demo">{t("demo_banner")}</p>}
			<nav className="sidenav" aria-label="Main">
				<NavLink to="/menu">{t("menu")}</NavLink>
				{locationId && (
					<NavLink to={`/locations/${locationId}/menu`}>
						{t("prices_availability")}
					</NavLink>
				)}
				{locationId && (
					<NavLink to={`/locations/${locationId}/settings`}>
						{t("location_nav")}
					</NavLink>
				)}
				<NavLink to="/reports">{t("reports")}</NavLink>
				<NavLink to="/promotions">{t("promotions")}</NavLink>
				<NavLink to="/staff">{t("staff")}</NavLink>
			</nav>
			<main className="content">
				<Outlet />
			</main>
		</div>
	);
}
