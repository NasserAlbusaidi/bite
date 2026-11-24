import { describe, expect, it } from "vitest";
import {
	canTransition,
	checkAtTable,
	checkFulfillmentTransition,
	FULFILLMENT_STATUSES,
	type FulfillmentStatus,
	fulfillmentPolicyFor,
	fulfillmentTransitions,
	isTab,
	type PaymentStatus,
	paymentStatusFor,
} from "./order-status.js";
import { m } from "./test-helpers.js";

describe("fulfillment", () => {
	it("terminal states go nowhere", () => {
		expect(fulfillmentTransitions("completed")).toEqual([]);
		expect(fulfillmentTransitions("cancelled")).toEqual([]);
	});

	it("only backward move is the KDS recall ready → preparing", () => {
		const order = FULFILLMENT_STATUSES;
		for (const from of order) {
			for (const to of fulfillmentTransitions(from)) {
				if (to === "cancelled") continue;
				const backwards = order.indexOf(to) < order.indexOf(from);
				expect(backwards ? `${from}->${to}` : "fwd").toBe(
					backwards ? "ready->preparing" : "fwd",
				);
			}
		}
		expect(canTransition("preparing", "pending")).toBe(false);
	});

	it("cancel needs all money refunded (legacy canCancelWithoutPaymentReversal)", () => {
		expect(
			checkFulfillmentTransition("pending", "cancelled", "unpaid"),
		).toEqual({ ok: true });
		expect(
			checkFulfillmentTransition("preparing", "cancelled", "paid"),
		).toEqual({ ok: false, error: "refund_first" });
		expect(
			checkFulfillmentTransition("preparing", "cancelled", "partially_paid"),
		).toEqual({ ok: false, error: "refund_first" });
		expect(
			checkFulfillmentTransition("ready", "cancelled", "refunded"),
		).toEqual({ ok: true });
	});

	it("completed needs a settled bill", () => {
		expect(
			checkFulfillmentTransition("ready", "completed", "partially_paid"),
		).toEqual({ ok: false, error: "unpaid" });
		expect(checkFulfillmentTransition("ready", "completed", "paid")).toEqual({
			ok: true,
		});
	});

	it("kitchen waits for payment by default (legacy KDS only showed paid orders)", () => {
		expect(
			checkFulfillmentTransition("pending", "preparing", "unpaid"),
		).toEqual({ ok: false, error: "unpaid" });
		expect(checkFulfillmentTransition("pending", "preparing", "paid")).toEqual({
			ok: true,
		});
		expect(
			checkFulfillmentTransition("pending", "preparing", "unpaid", {
				kitchenRequiresPayment: false,
			}),
		).toEqual({ ok: true });
	});

	it("rejects non-edges", () => {
		expect(checkFulfillmentTransition("completed", "ready", "paid")).toEqual({
			ok: false,
			error: "not_allowed",
		});
	});
});

describe("paymentStatusFor", () => {
	it("derives every status", () => {
		expect(paymentStatusFor(m(1000), m(0), m(0))).toBe("unpaid");
		expect(paymentStatusFor(m(1000), m(400), m(0))).toBe("partially_paid");
		expect(paymentStatusFor(m(1000), m(1000), m(0))).toBe("paid");
		expect(paymentStatusFor(m(1000), m(1000), m(300))).toBe(
			"partially_refunded",
		);
		expect(paymentStatusFor(m(1000), m(1000), m(1000))).toBe("refunded");
		expect(paymentStatusFor(m(0), m(0), m(0))).toBe("paid");
	});

	it("rejects impossible ledgers", () => {
		expect(() => paymentStatusFor(m(1000), m(100), m(200))).toThrow(RangeError);
	});
});

describe("tabs", () => {
	it("a staff dine-in order at a table goes to the kitchen unpaid", () => {
		const tab = { source: "counter", type: "dine_in", tableLabel: "7" };
		expect(isTab(tab)).toBe(true);
		expect(
			checkFulfillmentTransition(
				"pending",
				"preparing",
				"unpaid",
				fulfillmentPolicyFor(tab),
			),
		).toEqual({ ok: true });
		// Serving it for good still needs the bill paid.
		expect(
			checkFulfillmentTransition(
				"ready",
				"completed",
				"unpaid",
				fulfillmentPolicyFor(tab),
			),
		).toEqual({ ok: false, error: "unpaid" });
	});

	it("guest, takeaway and table-less orders still pay first", () => {
		for (const o of [
			{ source: "guest", type: "dine_in", tableLabel: "7" },
			{ source: "counter", type: "takeaway", tableLabel: null },
			{ source: "counter", type: "dine_in", tableLabel: null },
		]) {
			expect(isTab(o)).toBe(false);
			expect(
				checkFulfillmentTransition(
					"pending",
					"preparing",
					"unpaid",
					fulfillmentPolicyFor(o),
				),
			).toEqual({ ok: false, error: "unpaid" });
		}
	});
});

describe("checkAtTable", () => {
	const o = (
		fulfillmentStatus: FulfillmentStatus,
		paymentStatus: PaymentStatus,
		type = "dine_in",
	) => ({ type, fulfillmentStatus, paymentStatus });
	it("serving an unpaid tab keeps it open", () => {
		expect(checkAtTable(o("ready", "unpaid"), "served")).toEqual({
			ok: true,
			complete: false,
		});
	});
	it("serving a paid order completes it", () => {
		expect(checkAtTable(o("ready", "paid"), "served")).toEqual({
			ok: true,
			complete: true,
		});
		expect(checkAtTable(o("completed", "paid"), "served")).toEqual({
			ok: true,
			complete: false,
		});
	});
	it("clearing needs the bill settled and the food out", () => {
		expect(checkAtTable(o("ready", "unpaid"), "cleared")).toEqual({
			ok: false,
			error: "unpaid",
		});
		expect(checkAtTable(o("preparing", "paid"), "cleared")).toEqual({
			ok: false,
			error: "not_served",
		});
		expect(checkAtTable(o("ready", "paid"), "cleared")).toEqual({
			ok: true,
			complete: true,
		});
		expect(checkAtTable(o("completed", "paid"), "cleared")).toEqual({
			ok: true,
			complete: false,
		});
		expect(checkAtTable(o("cancelled", "unpaid"), "cleared")).toEqual({
			ok: true,
			complete: false,
		});
	});
	it("only dine-in sits at a table", () => {
		expect(checkAtTable(o("ready", "paid", "takeaway"), "served")).toEqual({
			ok: false,
			error: "not_dine_in",
		});
	});
});
