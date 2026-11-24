import type { TillCustomer } from "@bite/contracts";
import { maskPhone, normalizePhone } from "@bite/core";
import { useState } from "react";
import type { TillGuest } from "../domain/loyalty.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { fmt } from "./money.js";
import { loc } from "./receipts.js";
import { useServices } from "./services.js";

/**
 * Find a loyalty guest by phone and attach them to the sale, optionally
 * spending points on a reward. Lookup is online (points are shared across
 * branches); a number the server doesn't know still earns on this order.
 */
export function GuestSheet(props: {
	guest: TillGuest | null;
	/** What the bill is now, so a reward shows what it really takes off. */
	total: number;
	onAttach: (g: TillGuest) => void;
	onRemove: () => void;
	onClose: () => void;
}) {
	const { api } = useServices();
	const { t, lang } = useI18n();
	const [phoneText, setPhoneText] = useState(
		props.guest?.phone.replace(/^\+968/, "") ?? "",
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [found, setFound] = useState<
		| { kind: "known"; customer: TillCustomer }
		| { kind: "new"; phone: string }
		| null
	>(
		props.guest?.customer
			? { kind: "known", customer: props.guest.customer }
			: props.guest
				? { kind: "new", phone: props.guest.phone }
				: null,
	);
	const [rewardId, setRewardId] = useState<string | null>(
		props.guest?.rewardId ?? null,
	);
	const [name, setName] = useState(props.guest?.name ?? "");

	async function lookup() {
		const phone = normalizePhone(phoneText);
		if (!phone) return setError(t("guest.badPhone"));
		setBusy(true);
		setError(null);
		setRewardId(null);
		try {
			const customer = await api.findGuest(phone);
			setFound({ kind: "known", customer });
			setName(customer.name ?? "");
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status === 404) setFound({ kind: "new", phone });
			else if (status === 401) setError(t("guest.needsOnlineLogin"));
			else setError(t("guest.offline"));
		} finally {
			setBusy(false);
		}
	}

	const program = found?.kind === "known" ? found.customer.program : null;
	const rewards = program?.enabled
		? [...program.rewards].sort((a, b) => a.points - b.points)
		: [];

	function attach() {
		if (!found) return;
		props.onAttach(
			found.kind === "known"
				? {
						phone: found.customer.phone,
						name: found.customer.name ?? (name.trim() || null),
						customer: found.customer,
						rewardId,
					}
				: {
						phone: found.phone,
						name: name.trim() || null,
						customer: null,
						rewardId: null,
					},
		);
	}

	return (
		<div className="sheet-backdrop">
			<div className="sheet narrow guest-sheet">
				<h2>{t("guest.title")}</h2>
				<form
					className="row"
					onSubmit={(e) => {
						e.preventDefault();
						void lookup();
					}}
				>
					<label className="grow">
						{t("guest.phone")}
						<input
							dir="ltr"
							inputMode="tel"
							autoComplete="off"
							placeholder="9123 4567"
							value={phoneText}
							onChange={(e) => {
								setPhoneText(e.target.value);
								setFound(null);
							}}
						/>
					</label>
					<button
						type="submit"
						className="guest-sheet__find"
						disabled={busy || phoneText.trim().length < 8}
					>
						{busy ? t("guest.looking") : t("guest.find")}
					</button>
				</form>

				{error && <p className="error">{error}</p>}

				{found?.kind === "known" && (
					<div className="guest-card">
						<div className="row">
							<strong className="guest-card__name">
								{found.customer.name ?? (
									<bdi dir="ltr">{maskPhone(found.customer.phone)}</bdi>
								)}
							</strong>
							<span className="spacer" />
							<span className="guest-card__points">
								★ {t("guest.points", { points: found.customer.points })}
							</span>
						</div>
						<p className="muted small">
							{t("guest.visits", { count: found.customer.visitCount })}
						</p>
					</div>
				)}

				{found?.kind === "new" && (
					<div className="stack">
						<p className="notice">{t("guest.newGuest")}</p>
						<label>
							{t("guest.name")}
							<input
								value={name}
								maxLength={80}
								onChange={(e) => setName(e.target.value)}
							/>
						</label>
					</div>
				)}

				{rewards.length > 0 && found?.kind === "known" && (
					<fieldset className="guest-rewards">
						<legend>{t("guest.useReward")}</legend>
						<button
							type="button"
							className={
								rewardId === null ? "guest-reward active" : "guest-reward"
							}
							onClick={() => setRewardId(null)}
						>
							<span className="grow">{t("guest.noReward")}</span>
						</button>
						{rewards.map((r) => {
							const short = found.customer.points < r.points;
							return (
								<button
									type="button"
									key={r.id}
									disabled={short || props.total <= 0}
									className={
										rewardId === r.id ? "guest-reward active" : "guest-reward"
									}
									onClick={() => setRewardId(r.id)}
								>
									<span className="grow">
										{loc(r.name, lang)}
										<span className="muted small guest-reward__pts">
											{short
												? t("guest.pointsToGo", {
														points: r.points - found.customer.points,
													})
												: t("guest.points", { points: r.points })}
										</span>
									</span>
									<span className="amount">
										−{fmt(Math.min(r.value, props.total), lang)}
									</span>
								</button>
							);
						})}
					</fieldset>
				)}

				<div className="row pay-actions">
					{props.guest && (
						<button type="button" onClick={props.onRemove}>
							{t("guest.remove")}
						</button>
					)}
					<button type="button" onClick={props.onClose}>
						{t("till.cancel")}
					</button>
					<button
						type="button"
						className="primary big grow"
						disabled={!found || busy}
						onClick={attach}
					>
						{t("guest.attach")}
					</button>
				</div>
			</div>
		</div>
	);
}
