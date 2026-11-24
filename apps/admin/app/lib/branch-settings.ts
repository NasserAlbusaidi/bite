import {
	applyRate,
	type BasisPoints,
	type Minor,
	sub,
	taxFromInclusive,
} from "@bite/core";
import type { AdminDevice } from "./contracts";
import { type Day, hhmmToMinutes, TICKET_PREFIX, WEEK } from "./location-form";

/**
 * What one menu price turns into at this VAT setting, with the same core
 * rounding the till and the API use. `price` is what the menu says.
 */
export function vatExample(
	price: number,
	taxBps: number,
	inclusive: boolean,
): { net: number; vat: number; total: number } {
	const p = price as Minor;
	const rate = taxBps as BasisPoints;
	if (inclusive) {
		const vat = taxFromInclusive(p, rate);
		return { net: sub(p, vat), vat, total: p };
	}
	const vat = applyRate(p, rate);
	return { net: p, vat, total: (p + vat) as Minor };
}

export type DayHours = { open: string; close: string };

/** Weekday and minutes since midnight at the branch, not in the browser. */
export function localNow(
	timeZone: string,
	now: Date,
): { day: Day; minutes: number } {
	let parts: Intl.DateTimeFormatPart[];
	try {
		parts = new Intl.DateTimeFormat("en-US", {
			timeZone,
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(now);
	} catch {
		parts = new Intl.DateTimeFormat("en-US", {
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(now);
	}
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
	const day = get("weekday").slice(0, 3).toLowerCase() as Day;
	const minutes =
		(Number.parseInt(get("hour"), 10) % 24) * 60 +
		Number.parseInt(get("minute"), 10);
	return { day: WEEK.includes(day) ? day : "sun", minutes };
}

/**
 * Open or closed right now, from the hours being edited. Ranges may run past
 * midnight (close before open), so yesterday's late range counts too.
 */
export function openStatus(
	hours: Record<Day, DayHours>,
	timeZone: string,
	now = new Date(),
):
	| { open: true; closes: string }
	| { open: false; opens: string | null }
	| null {
	const any = WEEK.some((d) => hours[d].open && hours[d].close);
	if (!any) return null;
	const { day, minutes } = localNow(timeZone, now);
	const i = WEEK.indexOf(day);
	const yesterday = WEEK[(i + 6) % 7] ?? "sat";
	const range = (d: Day) => {
		const o = hhmmToMinutes(hours[d].open);
		const c = hhmmToMinutes(hours[d].close);
		return o === null || c === null ? null : { o, c, wraps: c <= o };
	};
	const y = range(yesterday);
	if (y?.wraps && minutes < y.c)
		return { open: true, closes: hours[yesterday].close };
	const r = range(day);
	if (r && minutes >= r.o && (r.wraps || minutes < r.c))
		return { open: true, closes: hours[day].close };
	if (r && minutes < r.o) return { open: false, opens: hours[day].open };
	for (let k = 1; k <= 7; k++) {
		const d = WEEK[(i + k) % 7] ?? "sun";
		if (range(d)) return { open: false, opens: hours[d].open };
	}
	return { open: false, opens: null };
}

/** The first free ticket prefix on this branch's live devices: A, B, C… */
export function suggestPrefix(devices: readonly AdminDevice[]): string {
	const used = new Set(
		devices.filter((d) => !d.revokedAt).map((d) => d.ticketPrefix),
	);
	for (const c of "ABCDEFHIJKLMNOPRSTUVWXYZ") {
		if (!used.has(c) && TICKET_PREFIX.test(c)) return c;
	}
	return "";
}

export type DeviceStatus =
	| { kind: "revoked" }
	| { kind: "unpaired" }
	| { kind: "online" }
	| { kind: "offline"; minutesAgo: number };

/** Tablets sync every 15 s while open (seen-at is written once a minute), so 5 quiet minutes = offline. */
export function deviceStatus(d: AdminDevice, now = Date.now()): DeviceStatus {
	if (d.revokedAt) return { kind: "revoked" };
	if (!d.lastSeenAt) return { kind: "unpaired" };
	const mins = Math.max(
		0,
		Math.floor((now - Date.parse(d.lastSeenAt)) / 60_000),
	);
	return mins < 5 ? { kind: "online" } : { kind: "offline", minutesAgo: mins };
}

/** "3 minutes ago", "2 days ago" in the page language. */
export function agoText(minutes: number, lang: "en" | "ar"): string {
	const f = new Intl.RelativeTimeFormat(lang === "ar" ? "ar-OM" : "en", {
		numeric: "auto",
		numberingSystem: "latn",
	} as Intl.RelativeTimeFormatOptions);
	if (minutes < 60) return f.format(-minutes, "minute");
	if (minutes < 60 * 24) return f.format(-Math.floor(minutes / 60), "hour");
	return f.format(-Math.floor(minutes / (60 * 24)), "day");
}
