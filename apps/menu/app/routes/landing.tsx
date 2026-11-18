import { Logo } from "@bite/ui";
import landingCss from "../landing.css?url";
import {
	adminLinks,
	landingCopy,
	publicOrigin,
	structuredData,
} from "../lib/landing.server";
import type { Route } from "./+types/landing";

/**
 * The bare domain: what Bite is, for a restaurant owner who has never seen
 * it. English at "/", Arabic at "/ar". Guests never land here (their QR code
 * carries the shop), so its styles load only on this route.
 */
export function loader({ request }: Route.LoaderArgs) {
	const lang = new URL(request.url).pathname.startsWith("/ar") ? "ar" : "en";
	const origin = publicOrigin(request);
	const copy = landingCopy(lang);
	const url = `${origin}${lang === "ar" ? "/ar" : "/"}`;
	return {
		lang,
		copy,
		admin: adminLinks(process.env.BITE_ADMIN_URL),
		url,
		alternates: { en: `${origin}/`, ar: `${origin}/ar` },
		ld: structuredData(copy, url, lang),
		year: new Date().getUTCFullYear(),
	};
}

export const links: Route.LinksFunction = () => [
	{ rel: "stylesheet", href: landingCss },
];

export const meta: Route.MetaFunction = ({ loaderData: data }) => {
	if (!data) return [{ title: "Bite" }];
	const { copy, url, alternates, lang, ld } = data;
	return [
		{ title: copy.metaTitle },
		{ name: "description", content: copy.metaDescription },
		{ property: "og:type", content: "website" },
		{ property: "og:site_name", content: "Bite" },
		{ property: "og:title", content: copy.metaTitle },
		{ property: "og:description", content: copy.metaDescription },
		{ property: "og:url", content: url },
		{ property: "og:locale", content: lang === "ar" ? "ar_OM" : "en_OM" },
		{ name: "twitter:card", content: "summary" },
		{ tagName: "link", rel: "canonical", href: url },
		{ tagName: "link", rel: "alternate", hrefLang: "en", href: alternates.en },
		{ tagName: "link", rel: "alternate", hrefLang: "ar", href: alternates.ar },
		{
			tagName: "link",
			rel: "alternate",
			hrefLang: "x-default",
			href: alternates.en,
		},
		{ "script:ld+json": ld },
	];
};

export default function Landing({ loaderData }: Route.ComponentProps) {
	const { copy: c, admin, lang, year } = loaderData;
	const other = lang === "ar" ? "en" : "ar";
	return (
		<div className="lp">
			{/* The brand bands stay forest green in dark mode too: light tokens inside. */}
			<header className="lp-top" data-theme="light">
				<nav className="lp-nav" aria-label="Bite">
					<Logo height={30} className="lp-nav__logo" />
					<a className="lp-nav__link lp-nav__link--wide" href="#product">
						{c.nav.product}
					</a>
					<a className="lp-nav__link lp-nav__link--wide" href="#how">
						{c.nav.how}
					</a>
					<a
						className="lp-nav__link"
						href={other === "ar" ? "/ar" : "/"}
						lang={other}
						hrefLang={other}
					>
						{c.otherLang}
					</a>
					{admin && (
						<a className="lp-nav__link" href={admin.signIn}>
							{c.nav.login}
						</a>
					)}
					{admin && (
						<a className="bite-btn lp-nav__cta" href={admin.signUp}>
							{c.nav.start}
						</a>
					)}
				</nav>

				<div className="lp-hero">
					<div className="lp-hero__text">
						<p className="lp-kicker lp-kicker--inverse">{c.hero.kicker}</p>
						<h1 className="lp-hero__title">{c.hero.title}</h1>
						<p className="lp-hero__lede">{c.hero.lede}</p>
						{admin && (
							<p className="lp-actions">
								<a className="bite-btn" href={admin.signUp}>
									{c.nav.start}
								</a>
								<a className="lp-ghost" href={admin.signIn}>
									{c.nav.login}
								</a>
							</p>
						)}
					</div>

					{/* A picture of the till, not a control: hidden from assistive tech. */}
					<div className="lp-till" aria-hidden="true">
						<p className="lp-till__chip">✓ {c.till.sent}</p>
						<p className="lp-till__order">{c.till.order}</p>
						{c.till.lines.map(([name, price]) => (
							<p key={name} className="lp-till__line">
								<span>{name}</span>
								<bdi dir="ltr">{price}</bdi>
							</p>
						))}
						<p className="lp-till__line lp-till__line--total">
							<span>{c.till.total}</span>
							<bdi>{c.till.amount}</bdi>
						</p>
						<p className="lp-till__charge">{c.till.charge}</p>
					</div>
				</div>

				<ul className="lp-facts">
					{c.facts.map(([title, body]) => (
						<li key={title}>
							<strong>{title}</strong>
							<span>{body}</span>
						</li>
					))}
				</ul>
			</header>

			<main>
				<section className="lp-section" id="product">
					<p className="lp-kicker">{c.guests.kicker}</p>
					<h2 className="lp-h2">{c.guests.title}</h2>
					<p className="lp-lede">{c.guests.body}</p>
					<ul className="lp-grid lp-grid--3">
						{c.guests.points.map(([title, body]) => (
							<li key={title} className="lp-card">
								<h3 className="lp-h3">{title}</h3>
								<p className="lp-body">{body}</p>
							</li>
						))}
					</ul>
				</section>

				<section className="lp-band">
					<div className="lp-section">
						<p className="lp-kicker">{c.features.kicker}</p>
						<h2 className="lp-h2">{c.features.title}</h2>
						<p className="lp-lede">{c.features.lede}</p>
						<ul className="lp-grid lp-grid--3">
							{c.features.items.map(([title, body]) => (
								<li key={title} className="lp-card">
									<h3 className="lp-h3">{title}</h3>
									<p className="lp-body">{body}</p>
								</li>
							))}
						</ul>
					</div>
				</section>

				<section className="lp-section" id="how">
					<p className="lp-kicker">{c.how.kicker}</p>
					<h2 className="lp-h2">{c.how.title}</h2>
					<ol className="lp-grid lp-grid--4">
						{c.how.steps.map(([title, body], i) => (
							<li key={title} className="lp-step">
								<span className="lp-step__n" aria-hidden="true">
									{i + 1}
								</span>
								<h3 className="lp-h3">{title}</h3>
								<p className="lp-body">{body}</p>
							</li>
						))}
					</ol>
				</section>

				{admin && (
					<section className="lp-section">
						<div className="lp-closing" data-theme="light">
							<h2 className="lp-closing__title">{c.closing.title}</h2>
							<p className="lp-closing__body">{c.closing.body}</p>
							<a className="bite-btn" href={admin.signUp}>
								{c.nav.start}
							</a>
						</div>
					</section>
				)}
			</main>

			<footer className="lp-footer">
				<Logo height={22} />
				<span>
					© <bdi dir="ltr">{year}</bdi> Bite
				</span>
			</footer>
		</div>
	);
}
