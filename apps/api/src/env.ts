import type { Db } from "@bite/db";
import type { PinLimiter } from "./lib/pin-limiter.js";
import type { RealtimeHub } from "./realtime/hub.js";

export type Deps = {
	db: Db;
	/** HMAC key for staff tokens. >= 32 bytes. */
	staffTokenSecret: string;
	pinLimiter: PinLimiter;
	/** Absent in unit tests that don't need it. */
	realtime?: RealtimeHub;
	now?: () => Date;
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

export type AppEnv = {
	Variables: {
		deps: Deps;
		device: DeviceCtx;
		staff: StaffCtx;
	};
};
