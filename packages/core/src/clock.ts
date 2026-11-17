/**
 * Wall-clock helpers. Core never reads the system clock: callers pass the
 * instant, so pricing is reproducible (server, tablet, parity harness).
 * Uses only Intl, which ships with Node and every Capacitor web view.
 */

/** An instant plus what a location's wall clock showed at that instant. */
export interface LocalClock {
	/** Unix epoch milliseconds. */
	readonly epochMs: number;
	/** Local calendar date, "YYYY-MM-DD". */
	readonly date: string;
	/** 0 = Sunday .. 6 = Saturday (same as JS and the legacy app). */
	readonly weekday: number;
	/** Seconds since local midnight, 0..86399. */
	readonly secondOfDay: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		formatters.set(timeZone, f);
	}
	return f;
}

/** What the wall clock in `timeZone` (IANA name, e.g. "Asia/Muscat") shows at `epochMs`. */
export function localClock(epochMs: number, timeZone: string): LocalClock {
	if (!Number.isFinite(epochMs))
		throw new RangeError(`Bad instant: ${epochMs}`);
	const parts: Record<string, string> = {};
	for (const p of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
		parts[p.type] = p.value;
	}
	const y = Number(parts.year);
	const m = Number(parts.month);
	const d = Number(parts.day);
	const hour = Number(parts.hour) % 24;
	const secondOfDay =
		hour * 3600 + Number(parts.minute) * 60 + Number(parts.second);
	return {
		epochMs,
		date: ymd(y, m, d),
		weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
		secondOfDay,
	};
}

/**
 * Build a LocalClock from wall-clock parts directly (tests, parity harness,
 * or callers that already resolved the timezone). `epochMs` is only used for
 * promotion date ranges.
 */
export function clockAt(date: string, time: string, epochMs = 0): LocalClock {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!m) throw new SyntaxError(`Not a date: "${date}"`);
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	return {
		epochMs,
		date,
		weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
		secondOfDay: parseTimeOfDay(time),
	};
}

/** "HH:MM" or "HH:MM:SS" → seconds since midnight. */
export function parseTimeOfDay(input: string): number {
	const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
	if (!m) throw new SyntaxError(`Not a time of day: "${input}"`);
	const h = Number(m[1]);
	const min = Number(m[2]);
	const s = Number(m[3] ?? 0);
	if (h > 23 || min > 59 || s > 59)
		throw new RangeError(`Not a time of day: "${input}"`);
	return h * 3600 + min * 60 + s;
}

/**
 * The location's business day for an instant. Sales before the cutoff count
 * toward the previous day, so with a 04:00 cutoff (240) a 01:30 sale on the
 * 18th belongs to the 17th.
 */
export function businessDate(
	epochMs: number,
	timeZone: string,
	dayCutoffMinutes: number,
): string {
	if (
		!Number.isInteger(dayCutoffMinutes) ||
		dayCutoffMinutes < 0 ||
		dayCutoffMinutes >= 1440
	) {
		throw new RangeError(
			`dayCutoffMinutes must be 0..1439, got ${dayCutoffMinutes}`,
		);
	}
	const clock = localClock(epochMs, timeZone);
	return clock.secondOfDay < dayCutoffMinutes * 60
		? addDays(clock.date, -1)
		: clock.date;
}

/** Calendar arithmetic on "YYYY-MM-DD" strings. */
export function addDays(date: string, days: number): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!m) throw new SyntaxError(`Not a date: "${date}"`);
	const t = new Date(
		Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days),
	);
	return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function ymd(y: number, m: number, d: number): string {
	return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
