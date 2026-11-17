import { describe, expect, it } from "vitest";
import {
	checkTender,
	type LedgerEntry,
	lineRefundAmount,
	planRefund,
	refundableAmount,
	splitEqually,
	summarizePayments,
} from "./tenders.js";
import { m } from "./test-helpers.js";

const pay = (
	id: string,
	amount: number,
	over: Partial<LedgerEntry> = {},
): LedgerEntry => ({
	id,
	amount: m(amount),
	method: "card",
	state: "succeeded",
	...over,
});

describe("split tenders", () => {
	it("summarizes a split bill paid in two tenders", () => {
		const s = summarizePayments(m(10_000), [
			pay("a", 4000, { method: "cash" }),
			pay("b", 6000),
		]);
		expect([s.paid, s.net, s.balanceDue, s.status]).toEqual([
			10_000,
			10_000,
			0,
			"paid",
		]);
	});

	it("pending payments block overpayment but do not count as paid", () => {
		const s = summarizePayments(m(10_000), [
			pay("a", 4000),
			pay("t", 6000, { method: "thawani", state: "pending" }),
		]);
		expect([s.status, s.balanceDue, s.chargeable, s.pending]).toEqual([
			"partially_paid",
			6000,
			0,
			6000,
		]);
		expect(checkTender(s, { amount: m(1), method: "card" })).toEqual({
			ok: false,
			error: "overpayment",
		});
	});

	it("failed payments are ignored", () => {
		const s = summarizePayments(m(5000), [pay("a", 5000, { state: "failed" })]);
		expect(s.status).toBe("unpaid");
	});

	it("cash can be over-tendered and returns change", () => {
		const s = summarizePayments(m(3250), []);
		expect(
			checkTender(s, { amount: m(3250), method: "cash", tendered: m(5000) }),
		).toEqual({ ok: true, change: 1750 });
		expect(
			checkTender(s, { amount: m(3250), method: "cash", tendered: m(3000) }),
		).toEqual({ ok: false, error: "tendered_too_low" });
		expect(
			checkTender(s, { amount: m(3250), method: "card", tendered: m(5000) }),
		).toEqual({ ok: false, error: "tendered_not_cash" });
		expect(checkTender(s, { amount: m(0), method: "card" })).toEqual({
			ok: false,
			error: "amount_not_positive",
		});
	});

	it("splits evenly, first payers carry the extra baisa", () => {
		expect(splitEqually(m(10_000), 3)).toEqual([3334, 3333, 3333]);
	});

	it("rejects malformed ledger rows", () => {
		expect(() => summarizePayments(m(1), [pay("x", -5)])).toThrow(RangeError);
		expect(() => summarizePayments(m(1), [pay("x", 0)])).toThrow(RangeError);
	});
});

describe("refunds", () => {
	const ledger = [
		pay("a", 4000, { method: "cash" }),
		pay("b", 6000),
		pay("r1", -1000, { reversesPaymentId: "b" }),
	];

	it("tracks what is left to refund per payment", () => {
		expect(refundableAmount("b", ledger)).toBe(5000);
		expect(refundableAmount("a", ledger)).toBe(4000);
		expect(refundableAmount("r1", ledger)).toBe(0);
	});

	it("plans a refund newest payment first, back to its own method", () => {
		expect(planRefund(m(7000), ledger)).toEqual([
			{ reversesPaymentId: "b", method: "card", amount: -5000 },
			{ reversesPaymentId: "a", method: "cash", amount: -2000 },
		]);
		expect(planRefund(m(9001), ledger)).toBeNull();
	});

	it("summary after refunds", () => {
		const s = summarizePayments(m(10_000), ledger);
		expect([s.refunded, s.net, s.status]).toEqual([
			1000,
			9000,
			"partially_refunded",
		]);
	});

	it("refunding a line unit by unit adds up to exactly its gross", () => {
		const l = { lineGross: m(1000), quantity: 3 };
		const parts = [
			lineRefundAmount(l, 1, 0),
			lineRefundAmount(l, 1, 1),
			lineRefundAmount(l, 1, 2),
		];
		expect(parts).toEqual([333, 334, 333]);
		expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
		expect(() => lineRefundAmount(l, 2, 2)).toThrow(RangeError);
	});
});
