import { type Db, schema } from "@bite/db";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { v7 as uuidv7 } from "uuid";

export type AuthConfig = {
	/** >= 32 bytes. Signs session cookies. */
	secret: string;
	/** Public origin of this API, e.g. https://api.bite.om */
	baseURL: string;
	/** Back-office origins allowed to call /v1/auth and /v1/admin with cookies. */
	trustedOrigins: string[];
};

/**
 * Back-office logins (owners, admins, managers): email + password, session
 * cookie. Floor staff never come through here; they use PINs on a device.
 * Better Auth only knows identities; what a login may touch is decided by
 * `members` under RLS (see middleware/admin-auth.ts).
 */
export function createAuth(db: Db, cfg: AuthConfig) {
	return betterAuth({
		secret: cfg.secret,
		baseURL: cfg.baseURL,
		basePath: "/v1/auth",
		trustedOrigins: cfg.trustedOrigins,
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: {
				user: schema.authUsers,
				session: schema.authSessions,
				account: schema.authAccounts,
				verification: schema.authVerifications,
			},
		}),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 10,
			maxPasswordLength: 128,
			// Same KDF as staff PINs. Legacy bcrypt hashes get a verify branch at cutover.
			password: {
				hash: (password) => hash(password),
				verify: ({ hash: h, password }) => verify(h, password),
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24,
		},
		// A function, not "uuid": "uuid" means "let the DB default it", and these are text columns.
		advanced: { database: { generateId: () => uuidv7() } },
		telemetry: { enabled: false },
	});
}

export type Auth = ReturnType<typeof createAuth>;
