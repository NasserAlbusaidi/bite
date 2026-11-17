import type { schema } from "@bite/db";

type BusinessHours = schema.BusinessHours;

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function localParts(at: Date, timezone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(at);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
	const day = get("weekday").toLowerCase().slice(0, 3) as (typeof DAYS)[number];
	return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMin = (hhmm: string) => {
	const [h = "0", m = "0"] = hhmm.split(":");
	return Number(h) * 60 + Number(m);
};

/**
 * Null hours = always open. A window whose close <= open wraps past midnight
 * (e.g. 18:00-02:00), and the post-midnight part counts toward the day it
 * started on.
 */
export function isOpenAt(
	hours: BusinessHours | null,
	timezone: string,
	at: Date,
): boolean {
	if (!hours) return true;
	const { day, minutes } = localParts(at, timezone);
	const today = hours[day] ?? [];
	const yesterday =
		hours[DAYS[(DAYS.indexOf(day) + 6) % 7] as (typeof DAYS)[number]] ?? [];
	for (const w of today) {
		const o = toMin(w.open);
		const c = toMin(w.close);
		if (c > o ? minutes >= o && minutes < c : minutes >= o) return true;
	}
	for (const w of yesterday) {
		const o = toMin(w.open);
		const c = toMin(w.close);
		if (c <= o && minutes < c) return true;
	}
	return false;
}

/** Guest/QR ordering: open by the hours, and not paused by staff. */
export function acceptsOrders(
	loc: {
		businessHours: BusinessHours | null;
		timezone: string;
		ordersPausedUntil: Date | null;
	},
	at: Date,
): boolean {
	if (loc.ordersPausedUntil && loc.ordersPausedUntil > at) return false;
	return isOpenAt(loc.businessHours, loc.timezone, at);
}
