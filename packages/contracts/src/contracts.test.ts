import { describe, expect, it } from "vitest";
import { AddPayment, Minor, SyncMutation, SyncPushRequest } from "./index.js";

const id = () => "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("money on the wire", () => {
	it("rejects floats and unsafe integers", () => {
		expect(Minor.safeParse(1250).success).toBe(true);
		expect(Minor.safeParse(1.25).success).toBe(false);
		expect(Minor.safeParse("1250").success).toBe(false);
		expect(Minor.safeParse(2 ** 53).success).toBe(false);
	});
});

describe("payments", () => {
	const base = {
		id: id(),
		orderId: id(),
		amount: 1500,
		businessDate: "2026-11-17",
	};
	it("cash needs a session and tendered >= amount", () => {
		expect(AddPayment.safeParse({ ...base, method: "cash" }).success).toBe(
			false,
		);
		expect(
			AddPayment.safeParse({
				...base,
				method: "cash",
				cashSessionId: id(),
				tendered: 1000,
			}).success,
		).toBe(false);
		expect(
			AddPayment.safeParse({
				...base,
				method: "cash",
				cashSessionId: id(),
				tendered: 2000,
			}).success,
		).toBe(true);
	});
	it("tendered is cash only", () => {
		expect(
			AddPayment.safeParse({ ...base, method: "card", tendered: 2000 }).success,
		).toBe(false);
	});
});

describe("sync", () => {
	it("discriminates by kind and checks the payload", () => {
		const m = {
			id: id(),
			entityId: id(),
			memberId: id(),
			createdAt: "2026-11-17T13:00:00Z",
			kind: "order.setFulfillment",
			payload: { orderId: id(), to: "ready" },
		};
		expect(SyncMutation.safeParse(m).success).toBe(true);
		expect(
			SyncMutation.safeParse({ ...m, payload: { orderId: id(), to: "eaten" } })
				.success,
		).toBe(false);
		expect(
			SyncMutation.safeParse({ ...m, kind: "order.explode" }).success,
		).toBe(false);
	});
	it("caps batch size", () => {
		expect(
			SyncPushRequest.safeParse({ deviceId: id(), mutations: [] }).success,
		).toBe(false);
	});
});

describe("admin", () => {
	it("promotion rules: single target, percent cap, paired daily window", async () => {
		const { CreatePromotion } = await import("./admin.js");
		const base = { name: "x", kind: "percent", value: 1000 };
		expect(CreatePromotion.safeParse(base).success).toBe(true);
		expect(CreatePromotion.safeParse({ ...base, value: 10_001 }).success).toBe(
			false,
		);
		expect(
			CreatePromotion.safeParse({ ...base, productId: id(), categoryId: id() })
				.success,
		).toBe(false);
		expect(
			CreatePromotion.safeParse({ ...base, dailyStart: "18:00" }).success,
		).toBe(false);
		expect(
			CreatePromotion.safeParse({
				...base,
				dailyStart: "22:00",
				dailyEnd: "02:00",
			}).success,
		).toBe(true);
	});
	it("PIN staff need a numeric PIN and a location", async () => {
		const { CreatePinStaff } = await import("./admin.js");
		const ok = {
			displayName: "Ali",
			pin: "1234",
			locations: [{ locationId: id(), role: "cashier" }],
		};
		expect(CreatePinStaff.safeParse(ok).success).toBe(true);
		expect(CreatePinStaff.safeParse({ ...ok, pin: "12a4" }).success).toBe(
			false,
		);
		expect(CreatePinStaff.safeParse({ ...ok, locations: [] }).success).toBe(
			false,
		);
	});
});
