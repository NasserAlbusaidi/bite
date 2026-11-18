import { formatDecimal, type Minor, parseDecimal } from "@bite/core";
import type {
	AdminModifierGroup,
	CreateModifierGroup,
	CreateModifierOption,
} from "./contracts";
import type { MessageKey } from "./i18n";
import type { FieldError } from "./product-form";

type Parsed<T> =
	| { ok: true; value: T }
	| { ok: false; errors: Record<string, FieldError> };

const text = (f: FormData, k: string) => {
	const v = f.get(k);
	return typeof v === "string" ? v.trim() : "";
};

const name = (f: FormData) => {
	const en = text(f, "nameEn");
	const ar = text(f, "nameAr");
	return ar ? { en, ar } : { en };
};

/** The most a guest could ever be asked to pick from one group. */
export const MAX_CHOICES = 20;

/** Form → group name and how many choices a guest must and may make. */
export function parseGroupForm(f: FormData): Parsed<CreateModifierGroup> {
	const errors: Record<string, FieldError> = {};
	if (!text(f, "nameEn")) errors.nameEn = { key: "required_field" };
	const int = (k: string) => {
		const s = text(f, k);
		return /^\d{1,2}$/.test(s) ? Number(s) : null;
	};
	const minSelect = int("minSelect");
	const maxSelect = int("maxSelect");
	if (minSelect === null || minSelect > MAX_CHOICES)
		errors.minSelect = { key: "choices_range", params: { max: MAX_CHOICES } };
	if (maxSelect === null || maxSelect < 1 || maxSelect > MAX_CHOICES)
		errors.maxSelect = { key: "choices_range", params: { max: MAX_CHOICES } };
	else if (minSelect !== null && maxSelect < minSelect)
		errors.maxSelect = { key: "choices_max_below_min" };
	if (
		Object.keys(errors).length > 0 ||
		minSelect === null ||
		maxSelect === null
	)
		return { ok: false, errors };
	return { ok: true, value: { name: name(f), minSelect, maxSelect } };
}

/**
 * What a choice adds to the price: "0.300", "+0.300", or "-0.200" for a
 * choice that makes the item cheaper. Blank is no change. Integer minor
 * units out, never a float. Null when it isn't an amount.
 */
export function parseDelta(input: string, decimals: number): number | null {
	const s = input.trim().replace(/^−/, "-");
	if (s === "") return 0;
	const m = /^([+-]?)(\d+(?:\.\d+)?)$/.exec(s);
	if (!m) return null;
	try {
		const n = parseDecimal(m[2] as string, decimals);
		return m[1] === "-" && n !== 0 ? -n : n;
	} catch {
		return null;
	}
}

/** "0.300" / "-0.200" for the input. */
export function deltaText(amount: number, decimals: number): string {
	const abs = formatDecimal(Math.abs(amount) as Minor, decimals);
	return amount < 0 ? `-${abs}` : abs;
}

/** "+0.300" / "-0.200" for reading; empty when the choice is free. */
export function deltaLabel(amount: number, decimals: number): string {
	if (amount === 0) return "";
	const abs = formatDecimal(Math.abs(amount) as Minor, decimals);
	return `${amount < 0 ? "-" : "+"}${abs}`;
}

/** Form → one choice in a group. */
export function parseOptionForm(
	f: FormData,
	decimals: number,
): Parsed<Required<Pick<CreateModifierOption, "name" | "priceDelta">>> {
	const errors: Record<string, FieldError> = {};
	if (!text(f, "nameEn")) errors.nameEn = { key: "required_field" };
	const priceDelta = parseDelta(text(f, "priceDelta"), decimals);
	if (priceDelta === null)
		errors.priceDelta = { key: "invalid_delta", params: { decimals } };
	if (Object.keys(errors).length > 0 || priceDelta === null)
		return { ok: false, errors };
	return { ok: true, value: { name: name(f), priceDelta } };
}

/** The rule in words: "Required, pick one", "Optional, up to 2"… */
export function ruleLabel(g: { minSelect: number; maxSelect: number }): {
	key: MessageKey;
	params?: Record<string, number>;
} {
	const { minSelect: min, maxSelect: max } = g;
	if (min === 0)
		return max === 1
			? { key: "rule_optional_one" }
			: { key: "rule_optional_many", params: { max } };
	if (min === max)
		return max === 1
			? { key: "rule_required_one" }
			: { key: "rule_required_exact", params: { count: max } };
	return { key: "rule_required_range", params: { min, max } };
}

/**
 * A required group with too few choices on offer blocks every product it is
 * on: the guest can never finish the order. Returns how many are missing.
 */
export function missingChoices(g: AdminModifierGroup): number {
	const available = g.options.filter((o) => o.isAvailable).length;
	return Math.max(0, g.minSelect - available);
}
