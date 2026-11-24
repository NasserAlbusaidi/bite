import { Form, Link, useNavigation, useSearchParams } from "react-router";
import type { T } from "../lib/i18n";
import { presets } from "../lib/insights";

/**
 * Date range picker shared by reports, orders and cash drawers: quick ranges
 * as chips, then a custom from/to. Keeps the page's other filters.
 */
export function RangeBar({
	today,
	from,
	to,
	t,
}: {
	today: string;
	from: string;
	to: string;
	t: T;
}) {
	const [params] = useSearchParams();
	const link = (f: string, tt: string) => {
		const p = new URLSearchParams(params);
		p.set("from", f);
		p.set("to", tt);
		p.delete("order");
		return `?${p.toString()}`;
	};
	const keep = [...params].filter(
		([k]) => k !== "from" && k !== "to" && k !== "order",
	);
	const list = presets(today);
	const custom = !list.some((p) => p.from === from && p.to === to);
	return (
		<div className="card range-bar no-print">
			<nav className="range-bar__chips" aria-label={t("date_range")}>
				{list.map((p) => {
					const on = p.from === from && p.to === to;
					return (
						<Link
							key={p.key}
							to={link(p.from, p.to)}
							className={`chip${on ? " chip--on" : ""}`}
							aria-current={on ? "true" : undefined}
							preventScrollReset
						>
							{t(p.key as "today")}
						</Link>
					);
				})}
			</nav>
			<Form method="get" className="range-bar__custom">
				{keep.map(([k, v]) => (
					<input key={k} type="hidden" name={k} value={v} />
				))}
				<label className={custom ? "range-bar__date is-on" : "range-bar__date"}>
					<span className="sr-only">{t("from")}</span>
					<input
						type="date"
						name="from"
						className="input input--sm"
						dir="ltr"
						defaultValue={from}
						max={today}
						key={`f${from}`}
					/>
				</label>
				<span className="muted" aria-hidden="true">
					–
				</span>
				<label className={custom ? "range-bar__date is-on" : "range-bar__date"}>
					<span className="sr-only">{t("to")}</span>
					<input
						type="date"
						name="to"
						className="input input--sm"
						dir="ltr"
						defaultValue={to}
						max={today}
						key={`t${to}`}
					/>
				</label>
				<button type="submit" className="btn btn--sm">
					{t("show")}
				</button>
			</Form>
		</div>
	);
}

/** True while this same page is loading new data (a filter or range change). */
export function useBusy(path: string): boolean {
	const nav = useNavigation();
	return nav.state === "loading" && nav.location?.pathname === path;
}
