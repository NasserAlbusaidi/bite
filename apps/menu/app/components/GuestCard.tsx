import { type Cart, lineKey, type MenuIndex } from "../lib/cart";
import type { GuestProfile } from "../lib/contracts";
import { type Lang, loc, type T } from "../lib/i18n";
import { reorderable } from "../lib/recent";

/** The guest's last order, as far as it can still be ordered exactly. */
export function usualCart(g: GuestProfile, idx: MenuIndex): Cart | null {
	const last = g.recentOrders[0];
	if (!last) return null;
	const cart: Cart = {
		lines: last.lines.flatMap((l) =>
			l.productId
				? [
						{
							key: lineKey(l.productId, l.modifierOptionIds),
							productId: l.productId,
							quantity: l.quantity,
							modifierOptionIds: l.modifierOptionIds,
						},
					]
				: [],
		),
	};
	const lines = reorderable(cart, idx);
	return lines.length ? { lines } : null;
}

/** "Welcome back, Sara · 230 points · 30 more for a free coffee". */
export function GuestCard({
	guest,
	lang,
	t,
	onForget,
}: {
	guest: GuestProfile;
	lang: Lang;
	t: T;
	onForget: () => void;
}) {
	const first = guest.name?.trim().split(/\s+/)[0];
	const p = guest.program;
	const ready = p.enabled
		? [...p.rewards]
				.filter((r) => r.points <= guest.points)
				.sort((a, b) => b.points - a.points)[0]
		: undefined;
	const next = p.enabled
		? [...p.rewards]
				.filter((r) => r.points > guest.points)
				.sort((a, b) => a.points - b.points)[0]
		: undefined;
	const goal = next ?? ready;
	const pct = goal
		? Math.min(100, Math.floor((guest.points * 100) / goal.points))
		: 0;
	return (
		<section className="guestcard" aria-label={t("welcome_back")}>
			<div className="guestcard__top">
				<strong>
					{first ? t("welcome_back_name", { name: first }) : t("welcome_back")}
				</strong>
				{p.enabled && (
					<span className="guestcard__pts">
						{t("points_balance", { points: guest.points })}
					</span>
				)}
			</div>
			{p.enabled && goal && (
				<>
					<div className="guestcard__bar" aria-hidden="true">
						<span style={{ width: `${pct}%` }} />
					</div>
					<p className="small muted">
						{ready
							? t("reward_ready", { reward: loc(ready.name, lang) })
							: next
								? t("points_to_go", {
										points: next.points - guest.points,
										reward: loc(next.name, lang),
									})
								: null}
					</p>
				</>
			)}
			<button type="button" className="linklike small" onClick={onForget}>
				{t("not_you")}{" "}
				<bdi dir="ltr" className="muted">
					{guest.phoneHint}
				</bdi>
			</button>
		</section>
	);
}
