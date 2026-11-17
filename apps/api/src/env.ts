import type { Db } from "@bite/db";
import type { PinLimiter } from "./lib/pin-limiter.js";

export type Deps = {
	db: Db;
	/** HMAC key for staff tokens. >= 32 bytes. */
	staffTokenSecret: string;
	pinLimiter: PinLimiter;
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
