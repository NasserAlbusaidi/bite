/**
 * Tablet pairing code: the API address and the device token in one string, so
 * the back office can show it as a QR code and the tablet scans it instead of
 * someone typing a 43-character token.
 *
 *   bitepair:<device token>@<api url>
 *
 * It carries the plaintext device token, so it is shown exactly once, like
 * the token itself. Tokens are base64url and never contain "@".
 */
export const PAIRING_PREFIX = "bitepair:";

export type PairingCode = { serverUrl: string; token: string };

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
	return `${PAIRING_PREFIX}${p.token}@${trimSlashes(p.serverUrl)}`;
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
	const token = rest.slice(0, at);
	const serverUrl = trimSlashes(rest.slice(at + 1));
	if (!TOKEN.test(token)) return null;
	if (!SERVER.test(serverUrl)) return null;
	return { serverUrl, token };
}
