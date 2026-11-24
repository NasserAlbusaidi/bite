import { describe, expect, it } from "vitest";
import {
	MAX_OPEN_PER_LOCATION,
	SERVICE_REQUEST_TTL_MS,
	ServiceRequestStore,
} from "./requests.js";

const A = { orgId: "org-a", locationId: "loc-a" };

describe("ServiceRequestStore", () => {
	it("folds a repeat call for the same table and kind into one", () => {
		const s = new ServiceRequestStore();
		const one = s.open({ ...A, kind: "waiter", tableLabel: "4" });
		const two = s.open({ ...A, kind: "waiter", tableLabel: " 4 " });
		expect(one?.created).toBe(true);
		expect(two?.created).toBe(false);
		expect(two?.request.calls).toBe(2);
		s.open({ ...A, kind: "bill", tableLabel: "4" });
		expect(s.list(A.orgId, A.locationId).map((r) => r.kind)).toEqual([
			"waiter",
			"bill",
		]);
	});

	it("scopes to org and location, and closes only there", () => {
		const s = new ServiceRequestStore();
		const r = s.open({ ...A, kind: "waiter", tableLabel: "1" });
		expect(s.list("org-b", A.locationId)).toEqual([]);
		expect(s.close("org-b", A.locationId, r?.request.id ?? "")).toBe(false);
		expect(s.close(A.orgId, "loc-x", r?.request.id ?? "")).toBe(false);
		expect(s.close(A.orgId, A.locationId, r?.request.id ?? "")).toBe(true);
		expect(s.list(A.orgId, A.locationId)).toEqual([]);
	});

	it("drops calls after the TTL and caps open calls", () => {
		let now = 1_000_000;
		const s = new ServiceRequestStore(() => now);
		s.open({ ...A, kind: "waiter", tableLabel: "1" });
		now += SERVICE_REQUEST_TTL_MS + 1;
		expect(s.list(A.orgId, A.locationId)).toEqual([]);
		for (let i = 0; i < MAX_OPEN_PER_LOCATION; i++)
			expect(
				s.open({ ...A, kind: "waiter", tableLabel: `${i}` }),
			).not.toBeNull();
		expect(s.open({ ...A, kind: "waiter", tableLabel: "x" })).toBeNull();
	});
});
