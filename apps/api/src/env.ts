import type { Db } from "@bite/db";
import type { Auth } from "./auth/better-auth.js";
import type { PinLimiter } from "./lib/pin-limiter.js";
import type { UploadStore } from "./lib/uploads.js";
import type { RealtimeHub } from "./realtime/hub.js";
import type { ServiceRequestStore } from "./service/requests.js";

export type Deps = {
	db: Db;
	/** HMAC key for staff tokens. >= 32 bytes. */
	staffTokenSecret: string;
	pinLimiter: PinLimiter;
	/** Better Auth (back office). Absent in tests that don't touch /v1/auth or /v1/admin. */
	auth?: Auth;
	/** Origins allowed to call /v1/auth, /v1/account and /v1/admin with credentials. */
	adminOrigins?: string[];
	/** Absent in unit tests that don't need it. */
	realtime?: RealtimeHub;
	now?: () => Date;
	/** Open guest service calls. Defaults to a per-app in-memory store. */
	serviceRequests?: ServiceRequestStore;
	/**
	 * True = plan limits are enforced (PLAN_ENFORCEMENT=on). Off by default:
	 * every org then gets every feature, unlimited.
	 */
	planEnforcement?: boolean;
	/** Product photo storage. Absent: uploads answer 404 and owners paste links. */
	uploads?: UploadStore;
	/** The API's public address, for the photo URLs it hands out. */
	publicApiUrl?: string;
};

export type DeviceCtx = {
	deviceId: string;
	orgId: string;
	locationId: string;
	kind: "pos" | "kds" | "kiosk";
	ticketPrefix: string;
	name: string;
};

export type StaffCtx = {
	memberId: string;
	displayName: string;
	orgRole: "owner" | "admin" | "staff";
	role: "manager" | "cashier" | "server" | "kitchen";
};

/** A back-office login, before an org is chosen. */
export type SessionCtx = {
	userId: string;
	email: string;
	name: string;
};

/** A back-office login acting on one org. */
export type AdminCtx = SessionCtx & {
	orgId: string;
	memberId: string;
	displayName: string;
	orgRole: "owner" | "admin" | "staff";
	/** Owners/admins: every location (as manager). Others: where they manage. */
	locations: {
		location: { id: string; name: string; slug: string; isActive: boolean };
		role: "manager" | "cashier" | "server" | "kitchen";
	}[];
	/** Location ids this login may manage. */
	manages: ReadonlySet<string>;
	/** Owner/admin: org-level settings (menu, promotions, staff org roles). */
	orgWide: boolean;
};

export type AppEnv = {
	Variables: {
		deps: Deps;
		device: DeviceCtx;
		staff: StaffCtx;
		session: SessionCtx;
		admin: AdminCtx;
	};
};
