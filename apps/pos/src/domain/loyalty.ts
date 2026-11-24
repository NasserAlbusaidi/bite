import type { TillCustomer } from "@bite/contracts";
import {
	type LoyaltyProgram,
	type Minor,
	minor,
	pointsEarned,
	redeem,
} from "@bite/core";

/** A loyalty guest attached to the sale on the till. */
export type TillGuest = {
	/** Normalized (+968...). Sent on order.create so the server links and awards. */
	phone: string;
	name: string | null;
	/** Null for a number the server doesn't know yet: it earns, can't redeem. */
	customer: TillCustomer | null;
	rewardId: string | null;
};

const toCore = (p: TillCustomer["program"]): LoyaltyProgram => ({
	enabled: p.enabled,
	pointsPerRial: p.pointsPerRial,
	rewards: p.rewards.map((r) => ({ ...r, value: minor(r.value) })),
});

/**
 * What the chosen reward takes off this bill, by the same core rule the
 * server applies (capped at what is due). Null when nothing applies.
 */
export function rewardOff(
	guest: TillGuest | null,
	total: number,
): { rewardId: string; amount: Minor; points: number } | null {
	if (!guest?.customer || !guest.rewardId) return null;
	const r = redeem(
		toCore(guest.customer.program),
		guest.customer.points,
		guest.rewardId,
		minor(total),
	);
	return r.ok
		? { rewardId: r.reward.id, amount: r.amount, points: r.reward.points }
		: null;
}

/** Points this bill will earn: on the money paid, never on the reward. */
export function pointsFor(guest: TillGuest | null, paid: number): number {
	const p = guest?.customer?.program;
	return p ? pointsEarned(toCore(p), minor(paid)) : 0;
}
