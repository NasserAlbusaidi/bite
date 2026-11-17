/** Sync wire types, straight from @bite/contracts. */
import type {
	SyncMutation,
	SyncMutationKind,
	SyncMutationResult,
	SyncPushRequest,
	SyncPushResponse,
} from "@bite/contracts";

export type Mutation = SyncMutation;
export type MutationKind = SyncMutationKind;
export type MutationResult = SyncMutationResult;
export type PushRequest = SyncPushRequest;
export type PushResponse = SyncPushResponse;
export type PayloadOf<K extends MutationKind> = Extract<
	Mutation,
	{ kind: K }
>["payload"];
