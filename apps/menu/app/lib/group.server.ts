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
import { readSeat, seatCookie } from "./group-seat.server";

export type GroupActionResult =
	| {
			ok: true;
			intent: string;
			cart?: GroupCartView;
			participantId?: string;
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
	request: Request,
	params: { lang: string; slug: string; token: string },
) {
	const form = await request.formData();
	const api = guestApi();
	const intent = str(form, "intent");
	const token = params.token;

	if (intent === "join") {
		const name = str(form, "displayName").trim().slice(0, 40);
		if (!name) return bad(intent);
		try {
			const r = await api.joinGroupCart(token, name);
			return seated(request, token, intent, r);
		} catch (e) {
			return fail(intent, e);
		}
	}

	const seat = await readSeat(request, token);
	if (!seat)
		return data<GroupActionResult>(
			{ ok: false, intent, code: "unauthenticated", lineIds: [] },
			{ status: 401 },
		);
	const auth: ParticipantAuth = {
		secret: seat.secret,
		version: Number(str(form, "version")),
	};
	if (!Number.isInteger(auth.version)) return bad(intent);

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
				let parsed: unknown;
				try {
					parsed = JSON.parse(str(form, "fields"));
				} catch {
					return bad(intent);
				}
				if (typeof parsed !== "object" || parsed === null) return bad(intent);
				const fields = parsed as Record<string, unknown>;
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
							...(type === "dine_in" ? s("tableLabel", 20) : {}),
							...s("note", 500),
						},
						a,
						key,
					),
				);
				return redirect(
					`/${encodeURIComponent(params.lang)}/${encodeURIComponent(params.slug)}/orders/${encodeURIComponent(order.trackingToken)}`,
				);
			}
			default:
				return bad(intent);
		}
	} catch (e) {
		return fail(intent, e);
	}
}

/** Remember the seat in the httpOnly cookie; the secret never goes to the page. */
async function seated(
	request: Request,
	token: string,
	intent: string,
	r: { cart: GroupCartView; participantId: string; secret: string },
) {
	const cookie = await seatCookie(request, token, {
		participantId: r.participantId,
		secret: r.secret,
	});
	return data<GroupActionResult>(
		{ ok: true, intent, cart: r.cart, participantId: r.participantId },
		{ headers: { "set-cookie": cookie } },
	);
}

/** Create a cart; the caller becomes host. */
export async function createGroup(
	request: Request,
	slug: string,
	displayName: string,
) {
	const name = displayName.trim().slice(0, 40);
	if (!name) return bad("create");
	try {
		const r = await guestApi().createGroupCart(slug, name);
		return seated(request, r.cart.token, "create", r);
	} catch (e) {
		return fail("create", e);
	}
}
