import { describe, expect, it } from "vitest";
import { bps } from "./money.js";
import { type PricedOrder, priceLines, type Result } from "./pricing.js";
import { ctx, line, m } from "./test-helpers.js";

function ok(r: Result<PricedOrder>): PricedOrder {
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.value;
}

describe("priceLines: ported from legacy GuestOrderServiceTest", () => {
	it("prices a clean cart (2 × 2.000, no tax)", () => {
		const o = ok(priceLines([line({ price: 2000, quantity: 2 })], ctx()));
		expect([o.subtotal, o.taxTotal, o.total]).toEqual([4000, 0, 4000]);
	});

	it("recomputes tax from the product rate (10.000 at 5%)", () => {
		const o = ok(priceLines([line({ price: 10000, tax: 500 })], ctx()));
		expect([o.subtotal, o.taxTotal, o.total]).toEqual([10000, 500, 10500]);
	});

	it("adds modifier price (1.500 + Large 0.400)", () => {
		const o = ok(priceLines([line({ price: 1500, mods: [400] })], ctx()));
		expect(o.lines[0]?.unitTotal).toBe(1900);
		expect(o.lines[0]?.unitPrice).toBe(1500);
		expect(o.subtotal).toBe(1900);
	});

	it("never prices a line below zero after negative modifiers", () => {
		const o = ok(priceLines([line({ price: 1000, mods: [-2000] })], ctx()));
		expect([
			o.lines[0]?.unitTotal,
			o.subtotal,
			o.total,
			o.discountTotal,
		]).toEqual([0, 0, 0, 0]);
	});

	it("rejects bad quantities and caps", () => {
		for (const quantity of [0, -1, 1.5]) {
			const r = priceLines([line({ quantity })], ctx());
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_quantity");
		}
		const big = priceLines([line({ quantity: 100 })], ctx());
		expect(!big.ok && big.errors[0]?.code).toBe("quantity_too_large");
		const many = priceLines(
			Array.from({ length: 51 }, () => line()),
			ctx(),
		);
		expect(!many.ok && many.errors[0]?.code).toBe("too_many_lines");
		const empty = priceLines([], ctx());
		expect(!empty.ok && empty.errors[0]?.code).toBe("empty_cart");
	});

	it("rejects a total over the cap (legacy test sets 1.000)", () => {
		const r = priceLines(
			[line({ price: 2000 })],
			ctx({
				limits: {
					maxLines: 50,
					maxQuantityPerLine: 99,
					maxOrderTotal: m(1000),
				},
			}),
		);
		expect(!r.ok && r.errors[0]?.code).toBe("total_too_large");
	});
});

describe("priceLines: VAT", () => {
	it("falls back to the location rate when the product has none", () => {
		const o = ok(
			priceLines([line({ price: 1000 })], ctx({ taxBps: bps(500) })),
		);
		expect(o.lines[0]?.taxBps).toBe(500);
		expect(o.taxTotal).toBe(50);
	});

	it("a product rate of 0 overrides the location rate (legacy ?? semantics)", () => {
		const o = ok(
			priceLines([line({ price: 1000, tax: 0 })], ctx({ taxBps: bps(500) })),
		);
		expect(o.taxTotal).toBe(0);
	});

	it("exclusive: rounds per line, half away from zero", () => {
		// 0.110 × 5% = 5.5 baisa → 6, twice
		const o = ok(
			priceLines(
				[line({ price: 110 }), line({ price: 110 })],
				ctx({ taxBps: bps(500) }),
			),
		);
		expect(o.lines.map((l) => l.lineTax)).toEqual([6, 6]);
		expect(o.taxTotal).toBe(12);
		expect(o.total).toBe(232);
		expect(o.lines[0]?.lineGross).toBe(116);
	});

	it("inclusive: extracts tax from gross and total equals subtotal", () => {
		const o = ok(
			priceLines(
				[line({ price: 1050, quantity: 2 })],
				ctx({ taxBps: bps(500), pricesIncludeTax: true }),
			),
		);
		const l = o.lines[0];
		expect([l?.lineTotal, l?.lineTax, l?.lineNet, l?.lineGross]).toEqual([
			2100, 100, 2000, 2100,
		]);
		expect([o.subtotal, o.taxTotal, o.total]).toEqual([2100, 100, 2100]);
	});

	it("legacy mode rounds the order tax once and allocates it to lines", () => {
		// per-line would be 6 + 6 = 12; legacy rounds 11.0 once
		const o = ok(
			priceLines(
				[line({ price: 110 }), line({ price: 110 })],
				ctx({ taxBps: bps(500), taxMode: "legacy" }),
			),
		);
		expect(o.taxTotal).toBe(11);
		expect(o.lines.map((l) => l.lineTax)).toEqual([6, 5]);
		expect(o.total).toBe(231);
	});

	it("legacy mode refuses tax-inclusive prices", () => {
		const r = priceLines(
			[line()],
			ctx({ taxMode: "legacy", pricesIncludeTax: true }),
		);
		expect(!r.ok && r.errors[0]?.code).toBe("legacy_mode_requires_exclusive");
	});

	it("mixed rates per line", () => {
		const o = ok(
			priceLines(
				[line({ price: 1000, tax: 500 }), line({ price: 1000, tax: 0 })],
				ctx({ taxBps: bps(500) }),
			),
		);
		expect(o.lines.map((l) => l.lineTax)).toEqual([50, 0]);
	});

	it("Σ line columns always equal the order columns", () => {
		const lines = [129, 333, 1, 9999, 4567].map((price, i) =>
			line({ price, quantity: i + 1, mods: [i * 7] }),
		);
		for (const pricesIncludeTax of [true, false]) {
			for (const taxMode of ["per_line", "legacy"] as const) {
				if (taxMode === "legacy" && pricesIncludeTax) continue;
				const o = ok(
					priceLines(
						lines,
						ctx({ taxBps: bps(500), pricesIncludeTax, taxMode }),
					),
				);
				const s = (f: (l: (typeof o.lines)[number]) => number) =>
					o.lines.reduce((a, l) => a + f(l), 0);
				expect(s((l) => l.lineTax)).toBe(o.taxTotal);
				expect(s((l) => l.lineTotal)).toBe(o.subtotal);
				expect(s((l) => l.lineGross)).toBe(o.total);
				expect(s((l) => l.lineNet) + o.taxTotal).toBe(o.total);
			}
		}
	});
});

describe("priceLines: promotions", () => {
	it("applies the promotion to the base price, not modifiers, and reports the saving", () => {
		const o = ok(
			priceLines(
				[line({ price: 1000, mods: [500], quantity: 3 })],
				ctx({}, [
					{ id: "half", kind: "percent", value: 5000, productId: "p1" },
				]),
			),
		);
		const l = o.lines[0];
		expect([
			l?.listUnitPrice,
			l?.unitPrice,
			l?.unitTotal,
			l?.promotionId,
		]).toEqual([1000, 500, 1000, "half"]);
		expect([l?.lineTotal, l?.lineDiscount]).toEqual([3000, 1500]);
		expect(o.discountTotal).toBe(1500);
	});

	it("open items (no productId) never get a promotion", () => {
		const o = ok(
			priceLines(
				[line({ productId: null, categoryId: null })],
				ctx({}, [{ id: "all", kind: "percent", value: 1000 }]),
			),
		);
		expect(o.lines[0]?.promotionId).toBeNull();
	});

	it("location-scoped promotions only apply at that location", () => {
		const promos = [
			{ id: "x", kind: "fixed" as const, value: 100, locationId: "loc-a" },
		];
		expect(
			ok(priceLines([line()], ctx({ locationId: "loc-a" }, promos))).lines[0]
				?.unitPrice,
		).toBe(900);
		expect(
			ok(priceLines([line()], ctx({ locationId: "loc-b" }, promos))).lines[0]
				?.unitPrice,
		).toBe(1000);
	});
});
