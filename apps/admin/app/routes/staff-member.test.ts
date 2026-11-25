import { describe, expect, it } from "vitest";
import { adminApi } from "../lib/api";
import { DEMO_ME } from "../lib/fixtures";
import type { Route } from "./+types/staff-member";
import { clientAction } from "./staff-member";

const A = DEMO_ME.locations[0]?.location.id ?? "a";

const call = (staffId: string, entries: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(entries)) body.append(k, v);
	return clientAction({
		request: new Request("http://admin.test/staff", { method: "POST", body }),
		params: { staffId },
	} as unknown as Route.ClientActionArgs);
};

describe("staff PIN flow", () => {
	it("adds floor staff and hands back the PIN for the slip", async () => {
		const res = await call("new", {
			kind: "pin",
			displayName: "Salim",
			pin: "4817",
			[`role:${A}`]: "cashier",
		});
		expect(res).toEqual({
			created: {
				name: "Salim",
				pin: "4817",
				locations: [{ locationId: A, role: "cashier" }],
			},
		});
		const salim = (await adminApi().staff()).find(
			(s) => s.displayName === "Salim",
		);
		expect(salim?.hasPin).toBe(true);
	});

	it("keeps a weak PIN out and says why", async () => {
		const res = await call("new", {
			kind: "pin",
			displayName: "Weak",
			pin: "1234",
			[`role:${A}`]: "cashier",
		});
		expect(res).toEqual({ errors: { pin: { key: "pin_weak" } } });
	});

	it("reports a missing role as a form error, not a PIN error", async () => {
		const res = await call("new", {
			kind: "pin",
			displayName: "No role",
			pin: "4817",
		});
		expect(res).toMatchObject({
			errors: { locations: { key: "pick_a_location" } },
		});
		expect(res).not.toHaveProperty("errors.pin");
	});

	it("changes an existing PIN from the dialog", async () => {
		const someone = (await adminApi().staff()).find(
			(s) => s.isActive && s.orgRole !== "owner",
		);
		if (!someone) throw new Error("demo data has no staff");
		expect(await call(someone.id, { intent: "resetPin", pin: "5590" })).toEqual(
			{ pinReset: true },
		);
		expect(await call(someone.id, { intent: "resetPin", pin: "0000" })).toEqual(
			{ errors: { pin: { key: "pin_weak" } } },
		);
		expect(await call(someone.id, { intent: "resetPin", pin: "12" })).toEqual({
			errors: { pin: { key: "invalid_pin" } },
		});
	});
});
