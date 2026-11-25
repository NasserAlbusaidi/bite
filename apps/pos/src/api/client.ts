import type {
	DeviceMe,
	PairDeviceResponse,
	PinLoginResponse,
	ServiceRequestList,
	StaffListResponse,
	SyncPullResponse,
	SyncPushRequest,
	SyncPushResponse,
	TillCustomer,
	TillRedeem,
	TillRedeemResponse,
} from "@bite/contracts";
import { STAFF_TOKEN_HEADER } from "@bite/contracts";
import { SyncHttpError } from "../sync/transport.js";

export type ApiConfig = { baseUrl: string; deviceToken: string };

/**
 * Trade a connect code from the back office for this tablet's device token.
 * The only call made without one.
 */
export async function pairWithCode(
	baseUrl: string,
	code: string,
	doFetch: typeof fetch = (...a) => fetch(...a),
): Promise<{ cfg: ApiConfig; device: DeviceMe }> {
	const base = baseUrl.replace(/\/+$/, "");
	const res = await doFetch(`${base}/v1/pair`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) throw new SyncHttpError(res.status, `HTTP ${res.status}`);
	const body = (await res.json()) as PairDeviceResponse;
	return {
		cfg: { baseUrl: base, deviceToken: body.token },
		device: body.device,
	};
}

/**
 * Where Bite lives, unless someone changes it under "Advanced" on the pair
 * screen. A browser tablet uses the page's own address (the dev server and a
 * hosted till proxy /v1); the native app has no web address, so it uses the
 * build's VITE_API_URL.
 */
export function defaultServerUrl(): string {
	const env = (import.meta as { env?: Record<string, string | undefined> }).env;
	if (env?.VITE_API_URL) return env.VITE_API_URL;
	if (typeof location !== "undefined" && /^https?:$/.test(location.protocol))
		return location.origin;
	return "https://api.bite.om";
}

/** Thin fetch client for the tablet routes. Device token on every call. */
export class ApiClient {
	/**
	 * From the last online PIN login, in memory only. Routes that act for a
	 * person (loyalty) need it; an offline unlock has none, so those calls 401.
	 */
	private staffToken: string | null = null;

	constructor(
		private readonly cfg: ApiConfig,
		private readonly doFetch: typeof fetch = (...a) => fetch(...a),
	) {}

	private async call<T>(
		path: string,
		init: RequestInit & { timeoutMs?: number } = {},
	): Promise<T> {
		const res = await this.doFetch(
			`${this.cfg.baseUrl.replace(/\/$/, "")}${path}`,
			{
				...init,
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${this.cfg.deviceToken}`,
					...(this.staffToken && { [STAFF_TOKEN_HEADER]: this.staffToken }),
					...(init.headers ?? {}),
				},
				signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
			},
		);
		if (!res.ok) {
			let message = `HTTP ${res.status}`;
			try {
				const body = (await res.json()) as { error?: { message?: string } };
				if (body.error?.message) message = body.error.message;
			} catch {
				// not JSON
			}
			throw new SyncHttpError(res.status, message);
		}
		return (await res.json()) as T;
	}

	me() {
		return this.call<DeviceMe>("/v1/device/me");
	}

	/** Guests calling a waiter or asking for the bill at this location. */
	serviceRequests() {
		return this.call<ServiceRequestList>("/v1/device/service-requests", {
			timeoutMs: 8_000,
		});
	}

	closeServiceRequest(id: string) {
		return this.call<{ ok: true }>(
			`/v1/device/service-requests/${encodeURIComponent(id)}/done`,
			{ method: "POST" },
		);
	}

	staff() {
		return this.call<StaffListResponse>("/v1/device/staff");
	}

	async pinLogin(memberId: string, pin: string) {
		// Whoever was logged in before must not stay attached to these calls.
		this.staffToken = null;
		const r = await this.call<PinLoginResponse>("/v1/device/pin-login", {
			method: "POST",
			body: JSON.stringify({ memberId, pin }),
		});
		this.staffToken = r.staffToken;
		return r;
	}

	/** Forget the staff token (lock screen). */
	clearStaff() {
		this.staffToken = null;
	}

	/** Loyalty guest by phone, across the org. 404 when unknown. */
	findGuest(phone: string) {
		return this.call<TillCustomer>(
			`/v1/device/customers?phone=${encodeURIComponent(phone)}`,
			{ timeoutMs: 8_000 },
		);
	}

	/** Spend a guest's points on an order the server already has. */
	redeem(orderId: string, body: TillRedeem) {
		return this.call<TillRedeemResponse>(
			`/v1/device/orders/${encodeURIComponent(orderId)}/redeem`,
			{ method: "POST", body: JSON.stringify(body), timeoutMs: 10_000 },
		);
	}

	push(req: SyncPushRequest) {
		return this.call<SyncPushResponse>("/v1/sync/push", {
			method: "POST",
			body: JSON.stringify(req),
			timeoutMs: 30_000,
		});
	}

	pull(q: { cursor?: string | null; menuVersion?: string | null }) {
		const p = new URLSearchParams();
		if (q.cursor) p.set("cursor", q.cursor);
		if (q.menuVersion) p.set("menuVersion", q.menuVersion);
		const qs = p.toString();
		return this.call<SyncPullResponse>(`/v1/sync/pull${qs ? `?${qs}` : ""}`, {
			timeoutMs: 30_000,
		});
	}
}
