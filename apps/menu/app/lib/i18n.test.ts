import { describe, expect, it } from "vitest";
import { errorMessageKey } from "./errors";
import { dir, loc, negotiateLang, translator } from "./i18n";
import { formatMoney } from "./money";
import { toE164 } from "./phone";

describe("language", () => {
	it("negotiates from Accept-Language with q weights", () => {
		expect(negotiateLang(null)).toBe("en");
		expect(negotiateLang("ar-OM,ar;q=0.9,en;q=0.8")).toBe("ar");
		expect(negotiateLang("en-GB;q=0.5, ar;q=0.9")).toBe("ar");
		expect(negotiateLang("fr-FR, de")).toBe("en");
		expect(negotiateLang("ar;q=0")).toBe("en");
	});

	it("falls back to English text and sets direction", () => {
		expect(loc({ en: "Bread" }, "ar")).toBe("Bread");
		expect(loc({ en: "Bread", ar: "خبز" }, "ar")).toBe("خبز");
		expect(dir("ar")).toBe("rtl");
		expect(translator("en")("add_item_aria", { name: "Bun" })).toBe(
			"Add Bun to order",
		);
	});
});

describe("money display", () => {
	it("formats baisa without floats", () => {
		const omr = { code: "OMR", decimals: 3 };
		expect(formatMoney(1250, omr, "en")).toBe("1.250 OMR");
		expect(formatMoney(5, omr, "ar")).toBe("0.005 ر.ع.");
		expect(formatMoney(-300, omr, "en")).toBe("-0.300 OMR");
	});
});

describe("phone", () => {
	it("normalises Omani numbers to E.164", () => {
		expect(toE164("9123 4567")).toBe("+96891234567");
		expect(toE164("0096891234567")).toBe("+96891234567");
		expect(toE164("+971 50 123 4567")).toBe("+971501234567");
		expect(toE164("1234")).toBeNull();
		expect(toE164("abc")).toBeNull();
	});
});

describe("guest errors", () => {
	it("maps API errors to copy, never raw messages", () => {
		expect(errorMessageKey("unprocessable", "items_unavailable")).toBe(
			"items_unavailable",
		);
		expect(errorMessageKey("unprocessable", "not_accepting_orders")).toBe(
			"shop_closed",
		);
		expect(errorMessageKey("rate_limited")).toBe("rate_limited");
		expect(errorMessageKey("internal")).toBe("generic_error");
	});
});
