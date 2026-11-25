import { Icon } from "@bite/ui";
import { useId, useState } from "react";
import { Link } from "react-router";
import type { T } from "../lib/i18n";
import { type GuideStep, nextStep } from "../lib/setup-guide";

/**
 * The sidebar's setup card: branch, count and progress bar; the arrow opens
 * every step above it (done ones crossed out). Gone once every step is done.
 */
export function SetupCard({
	steps,
	title,
	t,
}: {
	steps: readonly GuideStep[];
	title: string;
	t: T;
}) {
	const [open, setOpen] = useState(false);
	const listId = useId();
	const next = nextStep(steps);
	if (!next) return null;
	const done = steps.filter((s) => s.done).length;
	const pct = Math.round((done / steps.length) * 100);
	const list = (
		<ol className="setup-card__list" id={listId}>
			{steps.map((s) => (
				<li
					key={s.key}
					className={
						s.done ? "is-done" : s.key === next.key ? "is-next" : undefined
					}
				>
					<span className="setup-card__mark" aria-hidden="true">
						{s.done ? <Icon name="check" size={14} /> : null}
					</span>
					{s.done ? (
						<s>{t(`guide_${s.key}`)}</s>
					) : (
						<Link to={s.to}>{t(`guide_${s.key}`)}</Link>
					)}
					{s.optional && !s.done && (
						<span className="setup-card__opt">{t("setup_optional")}</span>
					)}
				</li>
			))}
		</ol>
	);
	return (
		<section className="setup-card" aria-label={title}>
			{open && list}
			<div className="setup-card__top">
				<Link to="/setup" className="setup-card__title">
					{title}
				</Link>
				<span className="setup-card__count">
					{done}/{steps.length}
				</span>
			</div>
			<div
				className="setup-card__bar"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={steps.length}
				aria-valuenow={done}
				aria-label={t("guide_progress", { done, total: steps.length })}
			>
				<span style={{ inlineSize: `${pct}%` }} />
			</div>
			<button
				type="button"
				className="setup-card__toggle"
				aria-expanded={open}
				aria-controls={listId}
				aria-label={t("setup_all_steps")}
				title={t("setup_all_steps")}
				onClick={(e) => {
					const btn = e.currentTarget;
					setOpen((o) => !o);
					// Keep the arrow in view once the list has opened above it.
					requestAnimationFrame(() => btn.scrollIntoView({ block: "nearest" }));
				}}
			>
				<svg
					className="setup-card__arrow"
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.25"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M6 15l6-6 6 6" />
				</svg>
			</button>
		</section>
	);
}
