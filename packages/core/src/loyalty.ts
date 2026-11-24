import { type Minor, minor } from "./money.js";

/**
 * Loyalty: points per org (shared across branches), earned on what a guest
 * actually paid, spent on rewards. A reward is a fixed amount off the bill,
 * taken as a "loyalty" tender, so pricing and VAT stay untouched.
 */

export interface LoyaltyReward {
	readonly id: string;
	readonly name: { readonly en: string; readonly ar?: string | undefined };
	/** Points it costs. */
	readonly points: number;
	/** What it takes off the bill, in baisa. Capped at what is still owed. */
	readonly value: Minor;
}

export interface LoyaltyProgram {
	readonly enabled: boolean;
	/** Points earned per whole rial (1000 baisa) paid. */
	readonly pointsPerRial: number;
	readonly rewards: readonly LoyaltyReward[];
}

export const DEFAULT_LOYALTY_PROGRAM: LoyaltyProgram = {
	enabled: false,
	pointsPerRial: 10,
	rewards: [],
};

/** Hard ceilings so a typo can't mint a million points. */
export const MAX_POINTS_PER_RIAL = 1000;
export const MAX_REWARD_POINTS = 100_000;

/**
 * Points for a paid amount. Rounds down: 2.950 OMR at 10/rial is 29 points.
 * Integer math only (amount * rate stays far below 2^53 for any real bill).
 */
export function pointsEarned(program: LoyaltyProgram, paid: Minor): number {
	if (!program.enabled || paid <= 0 || program.pointsPerRial <= 0) return 0;
	return Math.floor((paid * program.pointsPerRial) / 1000);
}

export type RedeemError =
	| "program_disabled"
	| "unknown_reward"
	| "not_enough_points"
	| "nothing_due";

/**
 * Can this balance pay for this reward on a bill with this much still owed?
 * Returns the tender amount (reward value capped at what is due).
 */
export function redeem(
	program: LoyaltyProgram,
	balance: number,
	rewardId: string,
	due: Minor,
):
	| { ok: true; reward: LoyaltyReward; amount: Minor }
	| { ok: false; error: RedeemError } {
	if (!program.enabled) return { ok: false, error: "program_disabled" };
	const reward = program.rewards.find((r) => r.id === rewardId);
	if (!reward) return { ok: false, error: "unknown_reward" };
	if (balance < reward.points) return { ok: false, error: "not_enough_points" };
	if (due <= 0) return { ok: false, error: "nothing_due" };
	return { ok: true, reward, amount: minor(Math.min(reward.value, due)) };
}

/** The cheapest reward the guest can't afford yet, and how far off it is. */
export function nextReward(
	program: LoyaltyProgram,
	balance: number,
): { reward: LoyaltyReward; pointsToGo: number } | null {
	if (!program.enabled) return null;
	const next = [...program.rewards]
		.filter((r) => r.points > balance)
		.sort((a, b) => a.points - b.points)[0];
	return next ? { reward: next, pointsToGo: next.points - balance } : null;
}

/** Rewards this balance can pay for, cheapest first. */
export function affordableRewards(
	program: LoyaltyProgram,
	balance: number,
): LoyaltyReward[] {
	if (!program.enabled) return [];
	return program.rewards
		.filter((r) => r.points <= balance)
		.sort((a, b) => a.points - b.points);
}

/**
 * A phone number as typed by a guest or cashier, to E.164. Local Omani
 * numbers (8 digits starting 2, 7 or 9) get +968. Returns null when it can't
 * be a real number.
 */
export function normalizePhone(
	raw: string,
	countryCode = "968",
): string | null {
	const s = raw.trim().replace(/[\s\-().]/g, "");
	let digits: string;
	if (s.startsWith("+")) digits = s.slice(1);
	else if (s.startsWith("00")) digits = s.slice(2);
	else if (/^[279]\d{7}$/.test(s)) digits = countryCode + s;
	else digits = s;
	if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
	return `+${digits}`;
}

/** "+96891234567" -> "•••• 4567", for showing a guest which number they used. */
export function maskPhone(e164: string): string {
	return `•••• ${e164.slice(-4)}`;
}
