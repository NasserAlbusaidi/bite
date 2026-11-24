import { Icon } from "@bite/ui";
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { AdminApiError, adminApi } from "../lib/api";
import type { LoyaltyProgram, LoyaltyReward } from "../lib/contracts";
import { flash } from "../lib/flash";
import { savedLang, translator } from "../lib/i18n";
import { fromDecimal, toDecimal } from "../lib/money";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/loyalty";

export async function clientLoader() {
	return { program: await adminApi().loyalty() };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const body = JSON.parse(String((await request.formData()).get("program")));
	const t = translator(savedLang());
	try {
		await adminApi().saveLoyalty(body as LoyaltyProgram);
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 403)
			return { error: t("loyalty_owner_only") };
		if (e instanceof AdminApiError) return { error: t("loyalty_invalid") };
		throw e;
	}
	flash(t("loyalty_saved"));
	return { error: null };
}

type Draft = {
	id: string;
	en: string;
	ar: string;
	points: string;
	value: string;
};

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40) || "reward";

/** What a guest has to spend to earn a reward, in rials, rounded up. */
export function spendFor(points: number, perRial: number): number {
	return perRial > 0 ? Math.ceil(points / perRial) : 0;
}

export default function Loyalty({ loaderData }: Route.ComponentProps) {
	const { program } = loaderData;
	const { t, place, me } = useShell();
	const fetcher = useFetcher<typeof clientAction>();
	const decimals = place?.decimals ?? 3;
	const currency = place?.currencyCode ?? "OMR";
	const canEdit = me.member.orgRole !== "staff";
	const [enabled, setEnabled] = useState(program.enabled);
	const [rate, setRate] = useState(String(program.pointsPerRial));
	const [rewards, setRewards] = useState<Draft[]>(
		program.rewards.map((r) => ({
			id: r.id,
			en: r.name.en,
			ar: r.name.ar ?? "",
			points: String(r.points),
			value: toDecimal(r.value, decimals),
		})),
	);
	const [error, setError] = useState<string | null>(null);
	const perRial = Number.parseInt(rate, 10);

	const update = (i: number, patch: Partial<Draft>) =>
		setRewards((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

	const save = () => {
		setError(null);
		if (!Number.isInteger(perRial) || perRial < 0 || perRial > 1000)
			return setError(t("loyalty_rate_invalid"));
		const out: LoyaltyReward[] = [];
		const seen = new Set<string>();
		for (const r of rewards) {
			const points = Number.parseInt(r.points, 10);
			const value = fromDecimal(r.value, decimals);
			if (!r.en.trim() || !Number.isInteger(points) || points < 1 || !value)
				return setError(t("loyalty_reward_invalid"));
			let id = r.id || slug(r.en);
			while (seen.has(id)) id = `${id}-2`.slice(0, 40);
			seen.add(id);
			out.push({
				id,
				name: r.ar.trim()
					? { en: r.en.trim(), ar: r.ar.trim() }
					: { en: r.en.trim() },
				points,
				value,
			});
		}
		fetcher.submit(
			{
				program: JSON.stringify({
					enabled,
					pointsPerRial: perRial,
					rewards: out,
				} satisfies LoyaltyProgram),
			},
			{ method: "post" },
		);
	};

	const shown = error ?? fetcher.data?.error ?? null;
	return (
		<>
			<Link to="/guests" className="back-link">
				<Icon name="chevron-back" />
				{t("guests_title")}
			</Link>
			<div className="page-head">
				<div>
					<h1>{t("loyalty_title")}</h1>
					<p className="muted small page-sub">{t("loyalty_hint")}</p>
				</div>
			</div>

			<section className="card gx-form">
				<label className="gx-switch">
					<input
						type="checkbox"
						checked={enabled}
						disabled={!canEdit}
						onChange={(e) => setEnabled(e.target.checked)}
					/>
					<span>
						<strong>{t("loyalty_enabled")}</strong>
						<span className="muted small gx-block">
							{t("loyalty_enabled_hint")}
						</span>
					</span>
				</label>

				<label className="field-label" htmlFor="rate">
					{t("loyalty_rate")}
				</label>
				<div className="gx-rate">
					<input
						id="rate"
						className="input gx-short"
						inputMode="numeric"
						value={rate}
						disabled={!canEdit}
						onChange={(e) => setRate(e.target.value)}
					/>
					<span className="muted">{t("loyalty_rate_unit", { currency })}</span>
				</div>
			</section>

			<section className="card">
				<div className="gx-head">
					<h2 className="gx-title">{t("loyalty_rewards")}</h2>
					{canEdit && (
						<button
							type="button"
							className="btn"
							onClick={() =>
								setRewards((rs) => [
									...rs,
									{ id: "", en: "", ar: "", points: "100", value: "" },
								])
							}
						>
							<Icon name="plus" />
							{t("loyalty_add_reward")}
						</button>
					)}
				</div>
				{rewards.length === 0 ? (
					<p className="muted">{t("loyalty_no_rewards")}</p>
				) : (
					<ul className="gx-rewards">
						{rewards.map((r, i) => {
							const pts = Number.parseInt(r.points, 10) || 0;
							return (
								<li key={r.id || `new-${i}`} className="gx-reward">
									<Icon name="gift" className="gx-reward__icon" />
									<div className="gx-reward__fields">
										<input
											className="input"
											placeholder={t("loyalty_reward_name_en")}
											aria-label={t("loyalty_reward_name_en")}
											value={r.en}
											disabled={!canEdit}
											onChange={(e) => update(i, { en: e.target.value })}
										/>
										<input
											className="input"
											dir="rtl"
											placeholder={t("loyalty_reward_name_ar")}
											aria-label={t("loyalty_reward_name_ar")}
											value={r.ar}
											disabled={!canEdit}
											onChange={(e) => update(i, { ar: e.target.value })}
										/>
										<label className="gx-mini">
											<span className="muted small">{t("points")}</span>
											<input
												className="input gx-short"
												inputMode="numeric"
												value={r.points}
												disabled={!canEdit}
												onChange={(e) => update(i, { points: e.target.value })}
											/>
										</label>
										<label className="gx-mini">
											<span className="muted small">
												{t("loyalty_reward_value", { currency })}
											</span>
											<input
												className="input gx-short"
												inputMode="decimal"
												dir="ltr"
												value={r.value}
												disabled={!canEdit}
												onChange={(e) => update(i, { value: e.target.value })}
											/>
										</label>
									</div>
									<span className="muted small gx-reward__spend">
										{perRial > 0 &&
											t("loyalty_spend_for", {
												amount: `${spendFor(pts, perRial)} ${currency}`,
											})}
									</span>
									{canEdit && (
										<button
											type="button"
											className="icon-btn"
											aria-label={t("remove")}
											onClick={() =>
												setRewards((rs) => rs.filter((_, j) => j !== i))
											}
										>
											<Icon name="trash" />
										</button>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</section>

			{shown && (
				<p className="error" role="alert">
					{shown}
				</p>
			)}
			{canEdit ? (
				<div className="actions-row">
					<button
						type="button"
						className="btn btn--primary"
						disabled={fetcher.state !== "idle"}
						onClick={save}
					>
						{t("save")}
					</button>
				</div>
			) : (
				<p className="muted small">{t("loyalty_owner_only")}</p>
			)}

			<details className="card guide">
				<summary>
					<Icon name="info" />
					{t("loyalty_how_title")}
				</summary>
				<p className="muted small">{t("loyalty_how_body")}</p>
			</details>
		</>
	);
}
