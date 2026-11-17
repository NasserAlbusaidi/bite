import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { type ColorRole, textPairs, themes, toCss, uiPairs } from "./tokens";

describe("tokens.css", () => {
	it("is regenerated from tokens.ts (run `pnpm --filter @bite/ui tokens`)", () => {
		const onDisk = readFileSync(
			new URL("./tokens.css", import.meta.url),
			"utf8",
		);
		expect(onDisk).toBe(toCss());
	});
});

const hex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

describe.each(Object.entries(themes))("%s theme contrast", (_name, theme) => {
	const check = (fg: ColorRole, bg: ColorRole, min: number) => {
		const a = theme[fg];
		const b = theme[bg];
		if (!hex(a) || !hex(b)) throw new Error(`${fg}/${bg} must be hex to check`);
		return contrast(a, b) >= min;
	};

	it.each(textPairs)("%s on %s meets AA text (4.5:1)", (fg, bg) => {
		expect(check(fg, bg, 4.5)).toBe(true);
	});

	it.each(uiPairs)("%s on %s meets AA non-text (3:1)", (fg, bg) => {
		expect(check(fg, bg, 3)).toBe(true);
	});
});
