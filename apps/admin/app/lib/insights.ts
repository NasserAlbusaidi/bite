/**
 * Pure helpers behind the reports and overview charts. Money stays integer
 * minor units; percentages are display-only and never feed back into money.
 */
import { addDays } from "@bite/core";
import type { TrendsReport } from "./contracts";

/** Inclusive day count of a business-date range. */
export function daysIn(from: string, to: string): number {
	return Math.max(1, (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1);
}

/** The range of the same length right before this one. */
export function previousPeriod(from: string, to: string) {
	const n = daysIn(from, to);
	return { from: addDays(from, -n), to: addDays(from, -1) };
}

export type Delta = { pct: number | null; dir: "up" | "down" | "flat" };

/**
 * Change from prev to cur as a whole percent. Null when there was nothing to
 * compare against (a new branch, an empty day).
 */
export function delta(cur: number, prev: number): Delta {
	if (prev === 0) return { pct: null, dir: cur > 0 ? "up" : "flat" };
	const pct = Math.trunc(((cur - prev) * 100) / Math.abs(prev));
	return { pct, dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

export type Preset = { key: string; from: string; to: string };

/** Quick ranges, ending on the branch's business date today. */
export function presets(today: string): Preset[] {
	const monthStart = `${today.slice(0, 8)}01`;
	const lastMonthEnd = addDays(monthStart, -1);
	return [
		{ key: "today", from: today, to: today },
		{ key: "yesterday", from: addDays(today, -1), to: addDays(today, -1) },
		{ key: "last_7_days", from: addDays(today, -6), to: today },
		{ key: "last_30_days", from: addDays(today, -29), to: today },
		{ key: "this_month", from: monthStart, to: today },
		{
			key: "last_month",
			from: `${lastMonthEnd.slice(0, 8)}01`,
			to: lastMonthEnd,
		},
	];
}

export type HeatGrid = {
	/** [weekday 0-6][hour] = orders */
	cells: number[][];
	/** Hours with any orders, first to last, so the grid isn't mostly blank. */
	hours: number[];
	max: number;
	busiest: { weekday: number; hour: number; orders: number } | null;
};

export function heatGrid(heat: TrendsReport["heat"]): HeatGrid {
	const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
	let max = 0;
	let busiest: HeatGrid["busiest"] = null;
	let lo = 24;
	let hi = -1;
	for (const c of heat) {
		const row = cells[c.weekday];
		if (!row) continue;
		row[c.hour] = (row[c.hour] ?? 0) + c.orders;
		if (c.orders > 0) {
			lo = Math.min(lo, c.hour);
			hi = Math.max(hi, c.hour);
		}
		if ((row[c.hour] ?? 0) > max) {
			max = row[c.hour] ?? 0;
			busiest = { weekday: c.weekday, hour: c.hour, orders: max };
		}
	}
	const hours =
		hi < 0 ? [] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
	return { cells, hours, max, busiest };
}

/** 0..4 shade step for a heat cell. 0 is empty. */
export function shade(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
	if (value <= 0 || max <= 0) return 0;
	const s = Math.ceil((value / max) * 4);
	return Math.min(4, Math.max(1, s)) as 1 | 2 | 3 | 4;
}

/**
 * Orders per local hour of one day from a list of placed-at instants, in the
 * shop's time zone. Used for the overview's "today so far" curve.
 */
export function hourly(
	placedAt: readonly string[],
	timeZone: string,
): number[] {
	const out = Array<number>(24).fill(0);
	const fmt = new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		hourCycle: "h23",
		timeZone,
	});
	for (const iso of placedAt) {
		const h = Number(fmt.format(new Date(iso)));
		if (h >= 0 && h < 24) out[h] = (out[h] ?? 0) + 1;
	}
	return out;
}

/** "a nice round top" for a chart axis: 1, 2, 2.5 or 5 x 10^n. */
export function niceMax(v: number): number {
	if (v <= 0) return 1;
	const p = 10 ** Math.floor(Math.log10(v));
	for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
	return 10 * p;
}

/** Share of a total as a whole percent (display only). */
export function percentOf(part: number, whole: number): number {
	return whole > 0 ? Math.trunc((part * 100) / whole) : 0;
}
