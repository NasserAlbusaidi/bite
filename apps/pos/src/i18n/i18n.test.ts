import { describe, expect, it } from "vitest";
import { messages } from "./messages.js";

const { en, ar } = messages;

import { DIR, translate } from "./i18n.js";

describe("i18n", () => {
	it("Arabic covers every key with a non-empty string and the same placeholders", () => {
		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			expect(ar[key], key).toBeTruthy();
			const vars = (s: string) =>
				[...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
			expect(vars(ar[key]), key).toEqual(vars(en[key]));
		}
	});

	it("interpolates and leaves unknown placeholders alone", () => {
		expect(translate("en", "sync.pending", { count: 3 })).toBe(
			"3 waiting to sync",
		);
		expect(translate("ar", "sync.pending", { count: 3 })).toBe(
			"3 بانتظار المزامنة",
		);
		expect(translate("en", "sync.pending")).toBe("{count} waiting to sync");
	});

	it("Arabic is RTL", () => {
		expect(DIR.ar).toBe("rtl");
		expect(DIR.en).toBe("ltr");
	});
});
