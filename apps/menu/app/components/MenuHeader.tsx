import type { ReactNode } from "react";
import { Link } from "react-router";
import type { GuestLocation } from "../lib/contracts";
import type { Lang, T } from "../lib/i18n";

const otherLang = (l: Lang): Lang => (l === "en" ? "ar" : "en");

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
	const style = location.theme.accent
		? ({ "--accent": location.theme.accent } as React.CSSProperties)
		: undefined;
	return (
		<header className="hero" style={style}>
			<div className="hero__row">
				{location.theme.logoUrl && (
					<img
						className="hero__logo"
						src={location.theme.logoUrl}
						alt=""
						width={40}
						height={40}
					/>
				)}
				<h1 className="hero__title">{location.name}</h1>
				<Link
					className="chip chip--link"
					to={`/${otherLang(lang)}${switchTo}`}
					lang={otherLang(lang)}
					reloadDocument
				>
					{lang === "en" ? "عربي" : "EN"}
				</Link>
			</div>
			<p
				className={`status ${location.isAcceptingOrders ? "status--open" : "status--closed"}`}
			>
				{location.isAcceptingOrders ? t("status_open") : t("status_closed")}
			</p>
			{pricesIncludeTax && <p className="muted small">{t("tax_included")}</p>}
			{children}
		</header>
	);
}
