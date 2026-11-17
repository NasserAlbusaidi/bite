import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, IconButton } from "./components/Button";
import { TextField } from "./components/Field";
import { applyKey, Keypad } from "./components/Keypad";
import { Logo } from "./components/Logo";
import { nextTab } from "./components/Tabs";
import { UiProvider } from "./context";
import { messages } from "./i18n";

const html = (lang: "en" | "ar", el: React.ReactNode) =>
	renderToStaticMarkup(<UiProvider lang={lang}>{el}</UiProvider>);

describe("applyKey", () => {
	it("builds a cash amount, capped at the currency's decimals", () => {
		let v = "";
		for (const k of ["1", ".", "2", "5", "0", "9"] as const)
			v = applyKey(v, k, { decimals: 3 });
		expect(v).toBe("1.250");
	});

	it("starts a bare point with 0 and ignores a second point", () => {
		expect(applyKey("", ".", { decimals: 3 })).toBe("0.");
		expect(applyKey("1.2", ".", { decimals: 3 })).toBe("1.2");
		expect(applyKey("12", ".", {})).toBe("12");
	});

	it("drops a leading zero, handles 00, backspace and clear", () => {
		expect(applyKey("0", "5")).toBe("5");
		expect(applyKey("0", "00")).toBe("0");
		expect(applyKey("5", "00")).toBe("500");
		expect(applyKey("123", "backspace")).toBe("12");
		expect(applyKey("123", "clear")).toBe("");
	});

	it("caps a PIN at maxLength", () => {
		expect(applyKey("1234", "5", { maxLength: 4 })).toBe("1234");
	});
});

describe("nextTab", () => {
	it("follows reading direction", () => {
		expect(nextTab(0, "ArrowRight", 3, "ltr")).toBe(1);
		expect(nextTab(0, "ArrowLeft", 3, "rtl")).toBe(1);
		expect(nextTab(0, "ArrowLeft", 3, "ltr")).toBe(2);
		expect(nextTab(1, "Home", 3, "ltr")).toBe(0);
		expect(nextTab(1, "End", 3, "rtl")).toBe(2);
		expect(nextTab(1, "Enter", 3, "ltr")).toBeNull();
	});
});

describe("components", () => {
	it("Button defaults to type=button and marks busy state", () => {
		const out = html("en", <Button busy>Charge</Button>);
		expect(out).toContain('type="button"');
		expect(out).toContain('aria-busy="true"');
		expect(out).toContain("disabled");
	});

	it("IconButton is named by its label", () => {
		expect(html("en", <IconButton icon="close" label="Close" />)).toContain(
			'aria-label="Close"',
		);
	});

	it("TextField wires label, hint and error to the input", () => {
		const out = html(
			"en",
			<TextField label="Phone" hint="Oman numbers" error="Too short" />,
		);
		expect(out).toMatch(/<label[^>]*for="([^"]+)"/);
		expect(out).toContain('aria-invalid="true"');
		expect(out).toMatch(/aria-describedby="[^"]+-error [^"]+-hint"/);
	});

	it("Keypad and Logo speak the UI language", () => {
		expect(html("ar", <Keypad onKey={() => {}} />)).toContain(
			messages.ar.keypad_backspace,
		);
		expect(html("ar", <Logo />)).toContain('aria-label="بايت"');
		expect(html("en", <Logo />)).toContain('aria-label="Bite"');
	});
});
