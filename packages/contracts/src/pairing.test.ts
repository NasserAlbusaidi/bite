import { describe, expect, it } from "vitest";
import {
	CONNECT_CODE_ALPHABET,
	encodePairingCode,
	formatConnectCode,
	normalizeConnectCode,
	parsePairingCode,
} from "./index.js";

const token = "dev_qHKMggXfjqsFSwwyLnh0PEVn4RjCROac9sh_Dnd0q3o";

describe("pairing code", () => {
	it("round-trips the server address and token", () => {
		const code = encodePairingCode({
			serverUrl: "https://api.bite.om/",
			token,
		});
		expect(code).toBe(`bitepair:${token}@https://api.bite.om`);
		expect(parsePairingCode(`  ${code}\n`)).toEqual({
			serverUrl: "https://api.bite.om",
			token,
		});
	});

	it("keeps ports and LAN addresses", () => {
		const p = { serverUrl: "https://192.168.1.20:5175", token };
		expect(parsePairingCode(encodePairingCode(p))).toEqual(p);
	});

	it("drops any number of trailing slashes and refuses oversized input", () => {
		expect(
			parsePairingCode(`bitepair:${token}@https://api.bite.om///`),
		).toEqual({ serverUrl: "https://api.bite.om", token });
		expect(
			parsePairingCode(
				`bitepair:${token}@https://api.bite.om/${"/".repeat(5000)}x`,
			),
		).toBeNull();
	});

	it("rejects anything that is not a pairing code", () => {
		for (const bad of [
			"",
			token,
			"https://bite.om/demo-cafe",
			`bitepair:${token}`,
			`bitepair:${token}@javascript:alert(1)`,
			`bitepair:${token}@not a url`,
			"bitepair:short@https://api.bite.om",
			`bitepair:bad token!@https://api.bite.om`,
		])
			expect(parsePairingCode(bad)).toBeNull();
	});

	it("carries a short connect code instead of the token", () => {
		const qr = encodePairingCode({
			serverUrl: "https://api.bite.om",
			code: "K7QDM2PX",
		});
		expect(qr).toBe("bitepair:K7QDM2PX@https://api.bite.om");
		expect(parsePairingCode(qr)).toEqual({
			serverUrl: "https://api.bite.om",
			code: "K7QDM2PX",
		});
	});
});

describe("connect code", () => {
	it("accepts what people type: lower case, spaces, a dash", () => {
		expect(normalizeConnectCode("k7qd-m2px")).toBe("K7QDM2PX");
		expect(normalizeConnectCode(" K7QD M2PX ")).toBe("K7QDM2PX");
		expect(formatConnectCode("K7QDM2PX")).toBe("K7QD-M2PX");
	});

	it("refuses look-alike letters and the wrong length", () => {
		for (const bad of ["K7QD-M2P", "K7QD-M2PXX", "O7QD-M2PX", "K7QD-M1PX", ""])
			expect(normalizeConnectCode(bad)).toBeNull();
	});

	it("has no look-alikes in its alphabet", () => {
		for (const ch of "IL01O") expect(CONNECT_CODE_ALPHABET).not.toContain(ch);
	});
});
