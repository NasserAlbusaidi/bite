import { Icon } from "@bite/ui";
import { useState } from "react";
import { Link } from "react-router";
import { adminApi } from "../lib/api";
import { loadPlaces } from "../lib/places";
import { selectedLocationId } from "../lib/selected-location";
import {
	type GuideStepKey,
	setTicked,
	setupGuide,
	tickedSteps,
} from "../lib/setup-guide";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/setup";

export async function clientLoader() {
	const api = adminApi();
	const places = await loadPlaces(api);
	const locationId = selectedLocationId(places);
	const [locations, menu, staff, devices] = await Promise.all([
		api.locations(),
		api.menu(),
		api.staff(),
		locationId ? api.devices(locationId) : Promise.resolve([]),
	]);
	const location = locations.find((l) => l.id === locationId);
	return { location, menu, staff, devices };
}

export default function SetupPage({ loaderData }: Route.ComponentProps) {
	const { t } = useShell();
	const { location, menu, staff, devices } = loaderData;
	const [ticked, setTick] = useState(() =>
		location ? tickedSteps(location.id) : new Set<GuideStepKey>(),
	);
	if (!location)
		return (
			<>
				<h1>{t("setup_guide")}</h1>
				<p className="card muted">{t("overview_no_branch")}</p>
			</>
		);
	const steps = setupGuide({ location, menu, staff, devices, ticked });
	const required = steps.filter((s) => !s.optional);
	const done = steps.filter((s) => s.done).length;
	const ready = required.every((s) => s.done);
	const pct = Math.round((done / steps.length) * 100);
	const tick = (key: GuideStepKey, on: boolean) => {
		setTicked(location.id, key, on);
		setTick(tickedSteps(location.id));
	};

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("setup_guide")}</h1>
					<p className="muted small page-sub">
						{t("setup_intro", { branch: location.name })}
					</p>
				</div>
			</div>
			<section
				className={`card guide-hero${ready ? " guide-hero--ready" : ""}`}
			>
				<div
					className="ring"
					style={{ "--pct": `${pct}%` } as React.CSSProperties}
					role="img"
					aria-label={t("guide_progress", { done, total: steps.length })}
				>
					<span dir="ltr">
						{done}/{steps.length}
					</span>
				</div>
				<div>
					<strong className="guide-hero__title">
						{ready
							? t("setup_ready", { branch: location.name })
							: t("guide_progress", { done, total: steps.length })}
					</strong>
					<div className="bar guide-hero__bar">
						<span style={{ inlineSize: `${pct}%` }} />
					</div>
				</div>
			</section>
			<ol className="card card--flush guide-steps">
				{steps.map((s) => (
					<li key={s.key} className={`guide-step${s.done ? " is-done" : ""}`}>
						<span className="guide-steps__check" aria-hidden="true">
							{s.done ? <Icon name="check" /> : null}
						</span>
						<span className="guide-steps__body">
							<strong>
								{t(`guide_${s.key}`)}
								{s.optional && (
									<span className="muted small"> · {t("setup_optional")}</span>
								)}
							</strong>
							<span className="muted small">{t(`guide_${s.key}_desc`)}</span>
						</span>
						<span className="guide-steps__actions">
							{s.key === "qr" && (
								<button
									type="button"
									className="btn btn--sm"
									onClick={() => tick("qr", !s.done)}
								>
									{s.done ? t("setup_undo") : t("setup_mark_done")}
								</button>
							)}
							{!s.done && (
								<Link className="btn btn--sm btn--primary" to={s.to}>
									{t("setup_go")}
									<Icon name="arrow-forward" />
								</Link>
							)}
						</span>
					</li>
				))}
			</ol>
		</>
	);
}
