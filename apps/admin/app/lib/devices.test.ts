import { describe, expect, it } from "vitest";
import type { AdminDevice } from "./contracts";
import { codeUsed, deviceState, nextDeviceName } from "./devices";

const NOW = Date.parse("2026-11-25T08:00:00Z");
const dev = (p: Partial<AdminDevice> = {}): AdminDevice => ({
	id: "d1",
	locationId: "l1",
	name: "Till 1",
	kind: "pos",
	ticketPrefix: "A",
	lastSeenAt: null,
	revokedAt: null,
	pairingExpiresAt: null,
	...p,
});
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("deviceState", () => {
	it("says working, last online, waiting, new or removed", () => {
		expect(deviceState(dev({ lastSeenAt: ago(1) }), NOW)).toEqual({
			kind: "on",
		});
		expect(deviceState(dev({ lastSeenAt: ago(90) }), NOW)).toEqual({
			kind: "off",
			minutesAgo: 90,
		});
		expect(deviceState(dev({ pairingExpiresAt: ago(-10) }), NOW).kind).toBe(
			"waiting",
		);
		expect(deviceState(dev({ pairingExpiresAt: ago(1) }), NOW).kind).toBe(
			"new",
		);
		expect(
			deviceState(dev({ revokedAt: ago(1), lastSeenAt: ago(1) }), NOW).kind,
		).toBe("removed");
	});

	it("a working tablet being moved still reads as working", () => {
		expect(
			deviceState(dev({ lastSeenAt: ago(0), pairingExpiresAt: ago(-5) }), NOW)
				.kind,
		).toBe("on");
	});
});

describe("nextDeviceName", () => {
	const label = (n: number) => `Till ${n}`;
	it("numbers after the tablets of that kind, skipping names in use", () => {
		expect(nextDeviceName("pos", [], label)).toBe("Till 1");
		expect(
			nextDeviceName(
				"pos",
				[dev({ name: "Front" }), dev({ id: "d2", name: "Till 2" })],
				label,
			),
		).toBe("Till 3");
		expect(
			nextDeviceName(
				"pos",
				[dev({ name: "till 1", revokedAt: ago(5) })],
				label,
			),
		).toBe("Till 1");
	});
});

describe("codeUsed", () => {
	const until = ago(-10);
	it("is true once the tablet used the code", () => {
		const used = [dev({ lastSeenAt: ago(0) })];
		expect(codeUsed(used, "d1", until, NOW)).toBe(true);
		expect(codeUsed(used, "nope", until, NOW)).toBe(false);
	});
	it("is false while the code is out, even if an old tablet is still on", () => {
		expect(
			codeUsed(
				[dev({ lastSeenAt: ago(0), pairingExpiresAt: until })],
				"d1",
				until,
				NOW,
			),
		).toBe(false);
	});
	it("is false when the code just ran out", () => {
		expect(codeUsed([dev({ lastSeenAt: ago(0) })], "d1", ago(1), NOW)).toBe(
			false,
		);
	});
});
