/**
 * TEMPORARY: structural mirror of packages/contracts/src/sync.ts from the API
 * PR (#2) so this app can build before it merges. Delete this file and import
 * from @bite/contracts once #2 is on main. Payloads stay `unknown` here; they
 * are typed by the contracts package.
 */

export type MutationKind =
	| "order.create"
	| "order.addPayment"
	| "order.refund"
	| "order.setFulfillment"
	| "order.voidLine"
	| "cash.open"
	| "cash.movement"
	| "cash.close"
	| "menu.setAvailability";

export type Mutation = {
	/** UUIDv7 created on the device. Also the idempotency key. */
	id: string;
	kind: MutationKind;
	/**
	 * The aggregate: the ORDER id for every order.* kind (payments and refunds
	 * included), the cash session id for cash.*, the product id for menu.*.
	 */
	entityId: string;
	/**
	 * Server version the device last saw. Omitted for creates and for chained
	 * offline edits (the tablet can't know the version after its own queued writes).
	 */
	baseVersion?: number;
	/** Staff member logged in when it was queued; the staff token may be gone by replay time. */
	memberId: string;
	payload: unknown;
	/** When the cashier did it, ISO 8601 UTC. Not when it synced. */
	createdAt: string;
};

export type PushRequest = { deviceId: string; mutations: Mutation[] };

/**
 * "blocked": an earlier mutation for the same entityId in this request was
 * rejected or conflicted, so this one was NOT applied or recorded. Retryable
 * with the same id once the blocker is sorted.
 */
export type MutationStatus =
	| "applied"
	| "duplicate"
	| "conflict"
	| "rejected"
	| "blocked";

export type MutationResult = {
	id: string;
	status: MutationStatus;
	entityId: string;
	entityVersion?: number;
	error?: { code: string; message: string };
};

export type PushResponse = { results: MutationResult[] };
