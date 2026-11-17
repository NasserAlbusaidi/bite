import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

/** 256-bit random secret, base64url. Used for device tokens and cart secrets. */
export function newSecret(prefix = ""): string {
	return prefix + randomBytes(32).toString("base64url");
}

/**
 * Device tokens are high-entropy random values, so a fast hash is enough
 * (no dictionary to brute force). PINs are low-entropy and use argon2id.
 */
export function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export type StaffClaims = {
	/** member id */
	m: string;
	/** device id the PIN was entered on */
	d: string;
	/** org id */
	o: string;
	/** expiry, unix seconds */
	exp: number;
};

/** Stateless staff token: base64url(json).base64url(hmac-sha256). Bound to one device. */
export function signStaffToken(claims: StaffClaims, secret: string): string {
	const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
	const mac = createHmac("sha256", secret).update(body).digest("base64url");
	return `${body}.${mac}`;
}

export function verifyStaffToken(
	token: string,
	secret: string,
	now = Date.now(),
): StaffClaims | null {
	const [body, mac, extra] = token.split(".");
	if (!body || !mac || extra !== undefined) return null;
	const want = createHmac("sha256", secret).update(body).digest();
	const got = Buffer.from(mac, "base64url");
	if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
	try {
		const claims = JSON.parse(
			Buffer.from(body, "base64url").toString(),
		) as StaffClaims;
		if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
		return claims;
	} catch {
		return null;
	}
}
