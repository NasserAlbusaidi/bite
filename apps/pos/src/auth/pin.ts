/**
 * Offline PIN unlock. After a successful ONLINE login we keep a PBKDF2
 * verifier of the PIN on this tablet, so the same person can unlock when the
 * internet is down. The server's argon2 hash never leaves the server.
 */
const ITERATIONS = 150_000;
/** Offline unlock only works for staff who logged in online recently. */
export const OFFLINE_PIN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const b64 = (b: ArrayBuffer | Uint8Array) =>
	btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pin),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: salt as BufferSource,
			iterations: ITERATIONS,
		},
		key,
		256,
	);
	return b64(bits);
}

export async function makeVerifier(
	pin: string,
): Promise<{ salt: string; verifier: string }> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return { salt: b64(salt), verifier: await derive(pin, salt) };
}

export async function checkVerifier(
	pin: string,
	salt: string,
	verifier: string,
): Promise<boolean> {
	const got = await derive(pin, unb64(salt));
	// Constant-time compare.
	if (got.length !== verifier.length) return false;
	let diff = 0;
	for (let i = 0; i < got.length; i++)
		diff |= got.charCodeAt(i) ^ verifier.charCodeAt(i);
	return diff === 0;
}
