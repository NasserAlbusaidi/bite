import { describe, expect, it } from "vitest";
import { encodePairingCode, parsePairingCode } from "./index.js";

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
});
