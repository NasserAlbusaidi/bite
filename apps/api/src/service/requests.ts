import { randomUUID } from "node:crypto";
import type { ServiceRequest, ServiceRequestKind } from "@bite/contracts";

type Stored = ServiceRequest & {
	orgId: string;
	locationId: string;
	at: number;
};

/** A call nobody closed drops off after this long. */
export const SERVICE_REQUEST_TTL_MS = 30 * 60_000;
/** Guard against a script flooding one location's till. */
export const MAX_OPEN_PER_LOCATION = 60;

/**
 * Open guest service calls ("call a waiter", "bring the bill"), per location.
 *
 * Kept in API memory on purpose: a call only matters for the next few minutes,
 * and losing open calls on a restart is harmless (the guest taps again). With
 * more than one API process this needs a shared store (a table or Redis).
 */
export class ServiceRequestStore {
	private byLoc = new Map<string, Stored[]>();

	constructor(private readonly now: () => number = Date.now) {}

	private live(locationId: string): Stored[] {
		const cutoff = this.now() - SERVICE_REQUEST_TTL_MS;
		const list = (this.byLoc.get(locationId) ?? []).filter(
			(r) => r.at >= cutoff,
		);
		if (list.length > 0) this.byLoc.set(locationId, list);
		else this.byLoc.delete(locationId);
		return list;
	}

	/**
	 * Open a call, or bump the open one for the same table and kind (a guest
	 * tapping twice is one call, not two cards on the till).
	 * Returns null when the location already has too many open calls.
	 */
	open(input: {
		orgId: string;
		locationId: string;
		kind: ServiceRequestKind;
		tableLabel: string;
	}): { request: ServiceRequest; created: boolean } | null {
		const list = this.live(input.locationId);
		const table = input.tableLabel.trim();
		const same = list.find(
			(r) =>
				r.orgId === input.orgId &&
				r.kind === input.kind &&
				r.tableLabel.toLowerCase() === table.toLowerCase(),
		);
		if (same) {
			same.calls += 1;
			same.at = this.now();
			return { request: toView(same), created: false };
		}
		if (list.length >= MAX_OPEN_PER_LOCATION) return null;
		const at = this.now();
		const r: Stored = {
			id: randomUUID(),
			kind: input.kind,
			tableLabel: table,
			createdAt: new Date(at).toISOString(),
			calls: 1,
			orgId: input.orgId,
			locationId: input.locationId,
			at,
		};
		list.push(r);
		this.byLoc.set(input.locationId, list);
		return { request: toView(r), created: true };
	}

	/** Open calls for one location of one org, oldest first. */
	list(orgId: string, locationId: string): ServiceRequest[] {
		return this.live(locationId)
			.filter((r) => r.orgId === orgId)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
			.map(toView);
	}

	/** Close a call. False if it isn't open at this org + location. */
	close(orgId: string, locationId: string, id: string): boolean {
		const list = this.live(locationId);
		const i = list.findIndex((r) => r.id === id && r.orgId === orgId);
		if (i === -1) return false;
		list.splice(i, 1);
		if (list.length === 0) this.byLoc.delete(locationId);
		return true;
	}
}

function toView(r: Stored): ServiceRequest {
	return {
		id: r.id,
		kind: r.kind,
		tableLabel: r.tableLabel,
		createdAt: r.createdAt,
		calls: r.calls,
	};
}
