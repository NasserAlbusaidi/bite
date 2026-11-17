import type { PushRequest, PushResponse } from "./contracts-stub.js";

export interface SyncTransport {
	/** Throws on any network/HTTP failure. Per-mutation outcomes come back in the response. */
	push(req: PushRequest): Promise<PushResponse>;
}

export class SyncHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "SyncHttpError";
	}

	/** Device token revoked or expired. Queue stays intact; staff must re-pair the tablet. */
	get isAuth() {
		return this.status === 401 || this.status === 403;
	}
}

export function httpTransport(opts: {
	baseUrl: string;
	deviceToken: () => string | null;
	timeoutMs?: number;
	fetch?: typeof fetch;
}): SyncTransport {
	const doFetch = opts.fetch ?? fetch;
	return {
		async push(req) {
			const token = opts.deviceToken();
			if (!token) throw new SyncHttpError(401, "Device is not paired");
			const res = await doFetch(`${opts.baseUrl}/v1/sync/push`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(req),
				signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
			});
			if (!res.ok) {
				throw new SyncHttpError(
					res.status,
					`Sync push failed: HTTP ${res.status}`,
				);
			}
			return (await res.json()) as PushResponse;
		},
	};
}
