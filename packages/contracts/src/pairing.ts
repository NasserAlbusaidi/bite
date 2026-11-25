/**
 * Connecting a tablet.
 *
 * The back office shows a short connect code ("K7QD-M2PX") that someone types
 * on the tablet, and the same code as a QR:
 *
 *   bitepair:<connect code>@<api url>
 *
 * The connect code works once and for 15 minutes; the tablet trades it for its
 * device token (POST /v1/pair). The older QR form carries the device token
 * itself, `bitepair:<device token>@<api url>`, and still parses. Tokens are
 * base64url and never contain "@".
 */
export const PAIRING_PREFIX = "bitepair:";

/**
 * 31 symbols with no look-alikes: no I, L, O, 0 or 1. Eight of them is
 * about 8.5 * 10^11 codes, each alive 15 minutes, and the API limits wrong
 * guesses per address.
 */
export const CONNECT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CONNECT_CODE_LENGTH = 8;
export const CONNECT_CODE_TTL_MINUTES = 15;

export type PairingCode =
	| { serverUrl: string; token: string }
	| { serverUrl: string; code: string };

/**
 * The canonical form of a typed connect code: upper case, spaces and dashes
 * dropped. Null when it can't be a code.
 */
export function normalizeConnectCode(text: string): string | null {
	if (text.length > 64) return null;
	const s = text.toUpperCase().replace(/[\s-]/g, "");
	if (s.length !== CONNECT_CODE_LENGTH) return null;
	for (const ch of s) if (!CONNECT_CODE_ALPHABET.includes(ch)) return null;
	return s;
}

/** "K7QDM2PX" -> "K7QD-M2PX", easier to read out and type. */
export function formatConnectCode(code: string): string {
	const s = code.toUpperCase().replace(/[\s-]/g, "");
	return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

const MAX_LENGTH = 2048;
const TOKEN = /^[A-Za-z0-9_-]{16,200}$/;
// No DOM or Node types in this package, so no `URL`: an http(s) origin with
// an optional path, no spaces, no credentials.
const SERVER = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[^\s@]*)?$/;

/** Without trailing slashes. A loop, not /\/+$/, which backtracks on "////…x". */
function trimSlashes(s: string): string {
	let end = s.length;
	while (end > 0 && s[end - 1] === "/") end--;
	return s.slice(0, end);
}

export function encodePairingCode(p: PairingCode): string {
	const secret = "code" in p ? p.code : p.token;
	return `${PAIRING_PREFIX}${secret}@${trimSlashes(p.serverUrl)}`;
}

/** Null unless it is a well-formed pairing code with an http(s) address. */
export function parsePairingCode(text: string): PairingCode | null {
	// A real code is under 300 characters; don't chew on a pasted novel.
	if (text.length > MAX_LENGTH) return null;
	const s = text.trim();
	if (!s.startsWith(PAIRING_PREFIX)) return null;
	const rest = s.slice(PAIRING_PREFIX.length);
	const at = rest.indexOf("@");
	if (at < 0) return null;
	const secret = rest.slice(0, at);
	const serverUrl = trimSlashes(rest.slice(at + 1));
	if (!SERVER.test(serverUrl)) return null;
	const code = normalizeConnectCode(secret);
	if (code) return { serverUrl, code };
	if (!TOKEN.test(secret)) return null;
	return { serverUrl, token: secret };
}
