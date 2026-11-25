import { randomInt } from "node:crypto";
import {
	CONNECT_CODE_ALPHABET,
	CONNECT_CODE_LENGTH,
	CONNECT_CODE_TTL_MINUTES,
} from "@bite/contracts";
import { ApiError } from "./errors.js";

/** A fresh connect code (no dash) and when it stops working. */
export function newConnectCode(now: Date): { code: string; expiresAt: Date } {
	let code = "";
	for (let i = 0; i < CONNECT_CODE_LENGTH; i++)
		code += CONNECT_CODE_ALPHABET[randomInt(CONNECT_CODE_ALPHABET.length)];
	return {
		code,
		expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MINUTES * 60_000),
	};
}

/** Single letters first, skipping G and Q (group and QR orders), then AA, AB... */
const SINGLE = "ABCDEFHIJKLMNOPRSTUVWXYZ".split("");

/** The first ticket prefix nobody at the location has used, revoked tablets included. */
export function nextTicketPrefix(used: Iterable<string>): string {
	const taken = new Set(used);
	for (const c of SINGLE) if (!taken.has(c)) return c;
	const all = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	for (const a of all) for (const b of all) if (!taken.has(a + b)) return a + b;
	throw new ApiError("conflict", "no ticket prefix left at this location");
}
