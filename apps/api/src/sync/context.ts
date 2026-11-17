import type { Tx } from "@bite/db";
import type { DeviceCtx, StaffCtx } from "../env.js";

/** What every mutation handler gets. Runs inside the tenant transaction. */
export type MutationCtx = {
	tx: Tx;
	device: DeviceCtx;
	/** The staff member recorded on the mutation (validated against the location). */
	member: { memberId: string; role: StaffCtx["role"] };
	now: Date;
	/** Version the tablet last saw, when it sent one. */
	baseVersion: number | undefined;
};

export type MutationOutcome = { entityVersion?: number | undefined };
