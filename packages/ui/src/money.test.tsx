import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Money } from "./components/Money";
import { UiProvider } from "./context";
import { formatMoney } from "./money";

const omr = { code: "OMR", decimals: 3 };

describe("formatMoney", () => {
	it("formats integer baisa with three decimals", () => {
		expect(formatMoney(1250, omr, "en")).toBe("1.250 OMR");
		expect(formatMoney(5, omr, "ar")).toBe("0.005 ر.ع.");
	});

	it("uses a real minus for negatives and + only when asked", () => {
		expect(formatMoney(-300, omr, "en")).toBe("−0.300 OMR");
		expect(formatMoney(300, omr, "en", { signed: true })).toBe("+0.300 OMR");
		expect(formatMoney(0, omr, "en", { signed: true })).toBe("0.000 OMR");
	});

	it("falls back to the code for unknown Arabic symbols", () => {
		expect(formatMoney(100, { code: "USD", decimals: 2 }, "ar")).toBe(
			"1.00 USD",
		);
	});
});

describe("<Money>", () => {
	const html = (lang: "en" | "ar", el: React.ReactNode) =>
		renderToStaticMarkup(<UiProvider lang={lang}>{el}</UiProvider>);

	it("isolates the amount left-to-right so a refund reads correctly in Arabic", () => {
		const out = html("ar", <Money amount={-1250} currency={omr} />);
		expect(out).toContain(
			'<bdi dir="rtl" class="bite-money bite-money--negative">',
		);
		expect(out).toContain('<bdi dir="ltr">\u22121.250</bdi> <bdi>ر.ع.</bdi>');
	});

	it("draws the Rial sign with the code as its accessible name", () => {
		const out = html(
			"en",
			<Money amount={1850} currency={omr} symbol="sign" />,
		);
		expect(out).toContain('aria-label="OMR"');
		expect(out).toContain('<bdi dir="ltr">1.850</bdi>');
	});

	it("keeps the code for currencies without a sign", () => {
		const out = html(
			"en",
			<Money
				amount={100}
				currency={{ code: "AED", decimals: 2 }}
				symbol="sign"
			/>,
		);
		expect(out).toContain("1.00</bdi> <bdi>AED</bdi>");
	});
});
