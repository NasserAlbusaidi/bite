import type { AdminPromotion, CreatePromotion } from "./contracts";
import { fromDecimal, toDecimal } from "./money";
import type { FieldError } from "./product-form";

export type PromoParse =
	| { ok: true; value: CreatePromotion }
	| { ok: false; errors: Record<string, FieldError> };

const text = (f: FormData, k: string) => {
	const v = f.get(k);
	return typeof v === "string" ? v.trim() : "";
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** "2026-12-01" in the browser's zone → ISO instant at the start (or end) of that day. */
export function dayToInstant(day: string, end: boolean): string {
	return new Date(`${day}T${end ? "23:59:59" : "00:00:00"}`).toISOString();
}

/** ISO instant → "YYYY-MM-DD" in the browser's zone. */
export function instantToDay(iso: string): string {
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Form → CreatePromotion. Percent is typed as "20" or "12.5" and stored in bps;
 * fixed is typed in the currency and stored in minor units. No floats.
 */
export function parsePromoForm(f: FormData, decimals: number): PromoParse {
	const errors: Record<string, FieldError> = {};
	const name = text(f, "name");
	if (!name || name.length > 120) errors.name = { key: "required_field" };

	const kind = text(f, "kind") === "fixed" ? "fixed" : "percent";
	const rawValue = text(f, "value");
	const value =
		kind === "percent"
			? fromDecimal(rawValue, 2)
			: fromDecimal(rawValue, decimals);
	if (value === null || value < 1 || (kind === "percent" && value > 10_000))
		errors.value = {
			key: kind === "percent" ? "invalid_percent" : "invalid_price",
			params: { decimals },
		};

	const target = text(f, "target");
	const productId = target.startsWith("product:") ? target.slice(8) : null;
	const categoryId = target.startsWith("category:") ? target.slice(9) : null;

	const locationId = text(f, "locationId") || null;

	const from = text(f, "startsOn");
	const to = text(f, "endsOn");
	if (from && !DATE.test(from)) errors.startsOn = { key: "required_field" };
	if (to && !DATE.test(to)) errors.endsOn = { key: "required_field" };
	if (from && to && DATE.test(from) && DATE.test(to) && to < from)
		errors.endsOn = { key: "end_before_start" };

	const dailyStart = text(f, "dailyStart");
	const dailyEnd = text(f, "dailyEnd");
	if (
		(dailyStart === "") !== (dailyEnd === "") ||
		(dailyStart && !TIME.test(dailyStart)) ||
		(dailyEnd && !TIME.test(dailyEnd))
	)
		errors.dailyEnd = { key: "hours_pair" };

	const days = f
		.getAll("daysOfWeek")
		.map((d) => (typeof d === "string" ? Number.parseInt(d, 10) : Number.NaN))
		.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
	const uniqueDays = [...new Set(days)].sort((a, b) => a - b);

	const priority = Number.parseInt(text(f, "priority") || "0", 10);
	if (!Number.isInteger(priority)) errors.priority = { key: "required_field" };

	if (Object.keys(errors).length > 0 || value === null)
		return { ok: false, errors };
	return {
		ok: true,
		value: {
			name,
			kind,
			value,
			locationId,
			productId,
			categoryId,
			startsAt: from ? dayToInstant(from, false) : null,
			endsAt: to ? dayToInstant(to, true) : null,
			dailyStart: dailyStart || null,
			dailyEnd: dailyEnd || null,
			// Every day ticked (or none) means no restriction.
			daysOfWeek:
				uniqueDays.length === 0 || uniqueDays.length === 7 ? null : uniqueDays,
			priority,
			isActive: f.get("isActive") === "on",
		},
	};
}

export function promoFormDefaults(
	p: AdminPromotion | undefined,
	decimals: number,
) {
	return {
		name: p?.name ?? "",
		kind: p?.kind ?? "percent",
		value: p
			? p.kind === "percent"
				? toDecimal(p.value, 2).replace(/\.?0+$/, "")
				: toDecimal(p.value, decimals)
			: "",
		target: p?.productId
			? `product:${p.productId}`
			: p?.categoryId
				? `category:${p.categoryId}`
				: "",
		locationId: p?.locationId ?? "",
		startsOn: p?.startsAt ? instantToDay(p.startsAt) : "",
		endsOn: p?.endsAt ? instantToDay(p.endsAt) : "",
		dailyStart: p?.dailyStart?.slice(0, 5) ?? "",
		dailyEnd: p?.dailyEnd?.slice(0, 5) ?? "",
		daysOfWeek: p?.daysOfWeek ?? [],
		priority: String(p?.priority ?? 0),
		isActive: p?.isActive ?? true,
	};
}
