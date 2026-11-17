import type { ReactNode } from "react";
import { Link } from "react-router";
import type { GuestLocation } from "../lib/contracts";
import type { Lang, T } from "../lib/i18n";

const otherLang = (l: Lang): Lang => (l === "en" ? "ar" : "en");

/**
 * Bite's shell around the shop: a forest band with the shop's logo and name,
 * open/closed state and the language switch. The shop's brand colour drives
 * the buttons (see root.tsx); the band stays Bite.
 */
export function MenuHeader({
	location,
	lang,
	t,
	pricesIncludeTax,
	switchTo,
	children,
}: {
	location: GuestLocation;
	lang: Lang;
	t: T;
	pricesIncludeTax: boolean;
	/** Path (without the language prefix) for the language switch. */
	switchTo: string;
	children?: ReactNode;
}) {
	return (
		<header className="hero">
			<div className="hero__row">
				{location.theme.logoUrl && (
					<img
						className="hero__logo"
						src={location.theme.logoUrl}
						alt=""
						width={44}
						height={44}
					/>
				)}
				<span className="hero__kicker">{t("order_from_table")}</span>
				<Link
					className="chip chip--link"
					to={`/${otherLang(lang)}${switchTo}`}
					lang={otherLang(lang)}
					reloadDocument
				>
					{lang === "en" ? "عربي" : "EN"}
				</Link>
			</div>
			<h1 className="hero__title">{location.name}</h1>
			<div className="hero__meta">
				<span
					className={`chip status ${location.isAcceptingOrders ? "status--open" : "status--closed"}`}
				>
					{location.isAcceptingOrders ? t("status_open") : t("status_closed")}
				</span>
				{pricesIncludeTax && <span className="chip">{t("tax_included")}</span>}
			</div>
			{children}
		</header>
	);
}
