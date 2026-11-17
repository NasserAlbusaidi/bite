import { data, redirect } from "react-router";
import {
	GuestApiError,
	guestApi,
	type ParticipantAuth,
	withFreshVersion,
} from "./api.server";
import type {
	ErrorCode,
	GroupCartView,
	GuestOrderRejectReason,
} from "./contracts";

export type GroupActionResult =
	| {
			ok: true;
			intent: string;
			cart?: GroupCartView;
			participantId?: string;
			secret?: string;
	  }
	| {
			ok: false;
			intent: string;
			code: ErrorCode;
			reason?: GuestOrderRejectReason;
			lineIds: string[];
	  };

const str = (f: FormData, k: string) => {
	const v = f.get(k);
	return typeof v === "string" ? v : "";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(intent: string, e: unknown) {
	if (!(e instanceof GuestApiError)) throw e;
	return data<GroupActionResult>(
		{
			ok: false,
			intent,
			code: e.code,
			...(e.rejection ? { reason: e.rejection.reason } : {}),
			lineIds: e.rejection?.lineIds ?? [],
		},
		{ status: e.code === "conflict" ? 409 : 422 },
	);
}

const bad = (intent: string) =>
	data<GroupActionResult>(
		{ ok: false, intent, code: "bad_request", lineIds: [] },
		{ status: 400 },
	);

/**
 * All group cart writes go through here (server side), so the browser never
 * talks to the API directly. Version conflicts are retried against the
 * current version: writes are keyed, so a retry can't double-apply.
 */
export async function groupAction(
	form: FormData,
	params: { lang: string; slug: string; token: string },
) {
	const api = guestApi();
	const intent = str(form, "intent");
	const token = params.token;

	if (intent === "join") {
		const name = str(form, "displayName").trim().slice(0, 40);
		if (!name) return bad(intent);
		try {
			const r = await api.joinGroupCart(token, name);
			return data<GroupActionResult>({ ok: true, intent, ...r });
		} catch (e) {
			return fail(intent, e);
		}
	}

	const auth: ParticipantAuth = {
		secret: str(form, "secret"),
		version: Number(str(form, "version")),
	};
	if (!auth.secret || !Number.isInteger(auth.version)) return bad(intent);

	try {
		switch (intent) {
			case "upsert": {
				const itemId = str(form, "itemId");
				const quantity = Number(str(form, "quantity"));
				let mods: unknown;
				try {
					mods = JSON.parse(str(form, "modifierOptionIds") || "[]");
				} catch {
					return bad(intent);
				}
				if (
					!UUID.test(itemId) ||
					!UUID.test(str(form, "productId")) ||
					!Number.isInteger(quantity) ||
					quantity < 1 ||
					quantity > 99 ||
					!Array.isArray(mods) ||
					!mods.every((m) => typeof m === "string" && UUID.test(m))
				) {
					return bad(intent);
				}
				const note = str(form, "note").trim().slice(0, 500);
				const cart = await withFreshVersion(auth, (a) =>
					api.upsertGroupItem(
						token,
						itemId,
						{
							productId: str(form, "productId"),
							quantity,
							modifierOptionIds: mods as string[],
							...(note ? { note } : {}),
						},
						a,
					),
				);
				return data<GroupActionResult>({ ok: true, intent, cart });
			}
			case "remove": {
				const itemId = str(form, "itemId");
				if (!UUID.test(itemId)) return bad(intent);
				const cart = await withFreshVersion(auth, (a) =>
					api.removeGroupItem(token, itemId, a),
				);
				return data<GroupActionResult>({ ok: true, intent, cart });
			}
			case "lock": {
				const cart = await withFreshVersion(auth, (a) =>
					api.lockGroupCart(token, a),
				);
				return data<GroupActionResult>({ ok: true, intent, cart });
			}
			case "unlock": {
				const cart = await withFreshVersion(auth, (a) =>
					api.unlockGroupCart(token, a),
				);
				return data<GroupActionResult>({ ok: true, intent, cart });
			}
			case "submit": {
				const key = str(form, "idempotencyKey");
				let fields: Record<string, unknown>;
				try {
					fields = JSON.parse(str(form, "fields"));
				} catch {
					return bad(intent);
				}
				const type = fields.type === "takeaway" ? "takeaway" : "dine_in";
				const s = (k: string, max: number) =>
					typeof fields[k] === "string" && fields[k]
						? { [k]: (fields[k] as string).slice(0, max) }
						: {};
				if (!UUID.test(key)) return bad(intent);
				const order = await withFreshVersion(auth, (a) =>
					api.submitGroupCart(
						token,
						{
							type,
							...s("customerName", 80),
							...s("customerPhone", 20),
							...s("note", 500),
						},
						a,
						key,
					),
				);
				return redirect(
					`/${params.lang}/${params.slug}/orders/${order.trackingToken}`,
				);
			}
			default:
				return bad(intent);
		}
	} catch (e) {
		return fail(intent, e);
	}
}

/** Create a cart; the caller becomes host. */
export async function createGroup(slug: string, displayName: string) {
	const name = displayName.trim().slice(0, 40);
	if (!name) return bad("create");
	try {
		const r = await guestApi().createGroupCart(slug, name);
		return data<GroupActionResult>({ ok: true, intent: "create", ...r });
	} catch (e) {
		return fail("create", e);
	}
}
