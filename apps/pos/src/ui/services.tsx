import type { DeviceMe } from "@bite/contracts";
import { createContext, useContext } from "react";
import type { ApiClient } from "../api/client.js";
import type { StaffMember } from "../auth/staff.js";
import type { SqlDriver } from "../db/driver.js";
import type { PrintService } from "../print/printers.js";
import type { SyncEngine } from "../sync/engine.js";

export type Services = {
	db: SqlDriver;
	api: ApiClient;
	sync: SyncEngine;
	device: DeviceMe;
	print: PrintService;
	member: StaffMember;
	lock: () => void;
};

export const ServicesCtx = createContext<Services | null>(null);

export function useServices(): Services {
	const s = useContext(ServicesCtx);
	if (!s) throw new Error("useServices outside a paired, unlocked session");
	return s;
}
