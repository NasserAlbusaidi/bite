import type { AdminLocationSettings, UpdateLocation } from "./contracts";
import { fromDecimal, toDecimal } from "./money";
import type { FieldError } from "./product-form";

/** Oman's week starts on Sunday. */
export const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof WEEK)[number];
type Hours = NonNullable<AdminLocationSettings["businessHours"]>;

const text = (f: FormData, k: string) => {
	const v = f.get(k);
	return typeof v === "string" ? v.trim() : "";
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-f]{6}$/i;

export const minutesToHHMM = (m: number) =>
	`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function hhmmToMinutes(s: string): number | null {
	if (!HHMM.test(s)) return null;
	const [h, m] = s.split(":");
	return Number.parseInt(h ?? "", 10) * 60 + Number.parseInt(m ?? "", 10);
}

export type LocationParse =
	| { ok: true; value: UpdateLocation }
	| { ok: false; errors: Record<string, FieldError> };

/**
 * Form → PATCH body. Each day edits its first opening range; any further
 * ranges (split shifts) are kept as they were. No hours at all = null.
 */
export function parseLocationForm(
	f: FormData,
	current: AdminLocationSettings,
	/** Managers may not change name, tax or the day cutoff; those fields are left out. */
	managerOnly = false,
): LocationParse {
	const errors: Record<string, FieldError> = {};
	const name = managerOnly ? current.name : text(f, "name");
	if (!name) errors.name = { key: "required_field" };

	const taxBps = managerOnly
		? current.taxBps
		: fromDecimal(text(f, "taxPercent"), 2);
	if (taxBps === null || taxBps > 10_000)
		errors.taxPercent = { key: "invalid_rate" };

	const cutoff = managerOnly
		? current.dayCutoffMinutes
		: hhmmToMinutes(text(f, "dayCutoff"));
	if (cutoff === null) errors.dayCutoff = { key: "invalid_time" };

	const accent = text(f, "accent");
	if (accent && !COLOR.test(accent)) errors.accent = { key: "required_field" };
	const logoUrl = text(f, "logoUrl");
	if (logoUrl && !/^https:\/\/\S+$/i.test(logoUrl))
		errors.logoUrl = { key: "required_field" };

	// The contract wants all seven days. Blank times = closed that day.
	const hours = {} as Hours;
	let anyHours = false;
	for (const day of WEEK) {
		const rest = current.businessHours?.[day]?.slice(1) ?? [];
		const open = text(f, `open:${day}`);
		const close = text(f, `close:${day}`);
		if (!open && !close) {
			hours[day] = [];
			continue;
		}
		if (!HHMM.test(open) || !HHMM.test(close)) {
			errors[`hours:${day}`] = { key: "hours_pair" };
			hours[day] = [];
			continue;
		}
		hours[day] = [{ open, close }, ...rest];
		anyHours = true;
	}

	if (Object.keys(errors).length > 0 || taxBps === null || cutoff === null)
		return { ok: false, errors };

	const opt = (k: string) => text(f, k) || null;
	const theme: AdminLocationSettings["theme"] = { ...current.theme };
	if (accent) theme.accent = accent;
	else delete theme.accent;
	if (logoUrl) theme.logoUrl = logoUrl;
	else delete theme.logoUrl;

	const owned: UpdateLocation = managerOnly
		? {}
		: {
				name,
				pricesIncludeTax: f.get("pricesIncludeTax") === "on",
				taxBps,
				vatNumber: opt("vatNumber"),
				dayCutoffMinutes: cutoff,
			};
	return {
		ok: true,
		value: {
			...owned,
			address: opt("address"),
			phone: opt("phone"),
			whatsappNumber: opt("whatsappNumber"),
			receiptHeader: opt("receiptHeader"),
			businessHours: anyHours ? hours : null,
			theme,
		},
	};
}

export function locationFormDefaults(l: AdminLocationSettings) {
	return {
		name: l.name,
		pricesIncludeTax: l.pricesIncludeTax,
		taxPercent: toDecimal(l.taxBps, 2).replace(/\.?0+$/, "") || "0",
		vatNumber: l.vatNumber ?? "",
		dayCutoff: minutesToHHMM(l.dayCutoffMinutes),
		address: l.address ?? "",
		phone: l.phone ?? "",
		whatsappNumber: l.whatsappNumber ?? "",
		receiptHeader: l.receiptHeader ?? "",
		accent: typeof l.theme.accent === "string" ? l.theme.accent : "",
		logoUrl: typeof l.theme.logoUrl === "string" ? l.theme.logoUrl : "",
		hours: Object.fromEntries(
			WEEK.map((d) => {
				const ranges = l.businessHours?.[d];
				return [
					d,
					{
						open: ranges?.[0]?.open ?? "",
						close: ranges?.[0]?.close ?? "",
						extra: Math.max(0, (ranges?.length ?? 0) - 1),
					},
				];
			}),
		) as Record<Day, { open: string; close: string; extra: number }>,
	};
}

/** Pause guest ordering for N minutes from now, or resume (null). */
export const pausedUntil = (minutes: number | null, now = Date.now()) =>
	minutes === null ? null : new Date(now + minutes * 60_000).toISOString();

/** 1-2 letters. Q is reserved for QR tickets and G alone for group tickets. */
export const TICKET_PREFIX = /^(?!G$)[A-PR-Z]{1,2}$/;
