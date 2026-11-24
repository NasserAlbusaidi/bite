import {
	type AdminProduct,
	type CreateProduct,
	DIETARY_TAGS,
	type DietaryTag,
} from "./contracts";
import type { MessageKey } from "./i18n";
import { fromDecimal, toDecimal } from "./money";

export type FieldError = {
	key: MessageKey;
	params?: Record<string, string | number>;
};
export type ParseResult =
	| { ok: true; value: CreateProduct }
	| { ok: false; errors: Record<string, FieldError> };

const text = (f: FormData, k: string) => {
	const v = f.get(k);
	return typeof v === "string" ? v.trim() : "";
};

/** Form → CreateProduct. Money and rates are parsed as decimals into integers, never floats. */
export function parseProductForm(f: FormData, decimals: number): ParseResult {
	const errors: Record<string, FieldError> = {};
	const nameEn = text(f, "nameEn");
	const nameAr = text(f, "nameAr");
	const descEn = text(f, "descriptionEn");
	const descAr = text(f, "descriptionAr");
	if (!nameEn) errors.nameEn = { key: "required_field" };
	if (descAr && !descEn) errors.descriptionEn = { key: "required_field" };

	const price = fromDecimal(text(f, "price"), decimals);
	if (price === null)
		errors.price = { key: "invalid_price", params: { decimals } };

	// "5" or "5.25" percent → basis points (500 / 525) by parsing with 2 decimals.
	const taxRaw = text(f, "taxPercent");
	const taxBps = taxRaw === "" ? null : fromDecimal(taxRaw, 2);
	if (taxRaw !== "" && (taxBps === null || taxBps > 10_000))
		errors.taxPercent = { key: "invalid_rate" };

	const categoryId = text(f, "categoryId");
	if (!categoryId) errors.categoryId = { key: "required_field" };

	const imageUrl = text(f, "imageUrl");
	// https links (uploads included), plain http only for a local dev API,
	// and demo-mode photos kept in the browser.
	if (
		imageUrl &&
		!/^https:\/\/\S+$/i.test(imageUrl) &&
		!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S*$/.test(imageUrl) &&
		!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(imageUrl)
	)
		errors.imageUrl = { key: "required_field" };

	const sortOrder = Number(text(f, "sortOrder") || "0");
	if (!Number.isInteger(sortOrder))
		errors.sortOrder = { key: "required_field" };

	if (Object.keys(errors).length > 0 || price === null)
		return { ok: false, errors };
	return {
		ok: true,
		value: {
			categoryId,
			name: nameAr ? { en: nameEn, ar: nameAr } : { en: nameEn },
			description: descEn
				? descAr
					? { en: descEn, ar: descAr }
					: { en: descEn }
				: null,
			price,
			taxBps,
			imageUrl: imageUrl || null,
			isVisible: f.get("isVisible") === "on",
			sortOrder,
			modifierGroupIds: f
				.getAll("modifierGroupIds")
				.filter((v): v is string => typeof v === "string"),
			dietaryTags: dietaryFrom(f),
		},
	};
}

/** Values to pre-fill the form with. */
export function productFormDefaults(
	p: AdminProduct | undefined,
	decimals: number,
) {
	return {
		nameEn: p?.name.en ?? "",
		nameAr: p?.name.ar ?? "",
		descriptionEn: p?.description?.en ?? "",
		descriptionAr: p?.description?.ar ?? "",
		price: p ? toDecimal(p.price, decimals) : "",
		taxPercent: p?.taxBps == null ? "" : toDecimal(p.taxBps, 2),
		categoryId: p?.categoryId ?? "",
		imageUrl: p?.imageUrl ?? "",
		isVisible: p?.isVisible ?? true,
		sortOrder: String(p?.sortOrder ?? 0),
		modifierGroupIds: p?.modifierGroupIds ?? [],
		dietaryTags: p?.dietaryTags ?? [],
	};
}

/** Ticked dietary tags in canonical order. Unknown values are dropped. */
export function dietaryFrom(f: FormData): DietaryTag[] {
	const picked = new Set(f.getAll("dietaryTags").map(String));
	return DIETARY_TAGS.filter((t) => picked.has(t));
}
