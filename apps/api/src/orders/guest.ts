import { createHash } from "node:crypto";
import type {
	CreateGuestOrderResponse,
	GuestOrderRejectDetails,
	GuestOrderView,
	OrderType,
} from "@bite/contracts";
import {
	bps,
	buildCatalog,
	businessDate,
	type CartLine,
	localClock,
	minor,
	type PricingError,
	paymentStatusFor,
	priceCart,
} from "@bite/core";
import { schema, type Tx } from "@bite/db";
import { and, eq, sql } from "@bite/db/orm";
import type { Deps } from "../env.js";
import { loadEntitlements } from "../lib/entitlements.js";
import { ApiError } from "../lib/errors.js";
import {
	attachCustomer,
	awardIfPaid,
	customerForToken,
	issueGuestToken,
	loadProgram,
	pendingPoints,
	redeemReward,
	upsertCustomer,
} from "../loyalty/service.js";
import { acceptsOrders } from "../menu/hours.js";
import { loadMenuSnapshot } from "../menu/snapshot.js";
import { isUniqueViolation } from "../sync/orders.js";
import { loadOrderDto } from "./dto.js";

const { locations, orders, orderLines, ticketCounters } = schema;

/** Unpaid guest orders expire (auto-cancel job) after this long. */
export const GUEST_ORDER_TTL_MS = 30 * 60_000;

export type GuestLine = {
	/** Client id, only used to point errors at lines. */
	id: string;
	productId: string;
	quantity: number;
	modifierOptionIds: readonly string[];
	note?: string | undefined;
};

export type GuestOrderInput = {
	type: OrderType;
	customerName?: string | undefined;
	customerPhone?: string | undefined;
	/** Kept for dine-in only. */
	tableLabel?: string | undefined;
	note?: string | undefined;
	lines: readonly GuestLine[];
	/** Spend points on this reward (needs a guest token for the same guest). */
	rewardId?: string | undefined;
};

const REASON: Partial<
	Record<PricingError["code"], GuestOrderRejectDetails["reason"]>
> = {
	unknown_product: "items_unavailable",
	product_unavailable: "items_unavailable",
	invalid_modifier: "invalid_modifiers",
	duplicate_modifier: "invalid_modifiers",
	modifier_unavailable: "invalid_modifiers",
	modifier_below_min: "invalid_modifiers",
	modifier_above_max: "invalid_modifiers",
	total_too_large: "total_too_high",
	too_many_lines: "total_too_high",
	quantity_too_large: "total_too_high",
};

export const rejectGuest = (
	reason: GuestOrderRejectDetails["reason"],
	lineIds?: string[],
) =>
	new ApiError("unprocessable", reason, {
		reason,
		...(lineIds?.length ? { lineIds } : {}),
	} satisfies GuestOrderRejectDetails);

export function guestFingerprint(input: GuestOrderInput, extra = ""): string {
	return createHash("sha256")
		.update(JSON.stringify({ ...input, extra }))
		.digest("hex");
}

export function toGuestView(
	o: NonNullable<Awaited<ReturnType<typeof loadOrderDto>>>,
	trackingToken: string,
): GuestOrderView {
	return {
		ticketNumber: o.ticketNumber,
		type: o.type,
		tableLabel: o.tableLabel,
		paymentStatus: o.paymentStatus,
		fulfillmentStatus: o.fulfillmentStatus,
		subtotal: o.subtotal,
		discountTotal: o.discountTotal,
		taxTotal: o.taxTotal,
		total: o.total,
		paidTotal: o.paidTotal,
		placedAt: o.placedAt,
		readyAt: o.readyAt,
		lines: o.lines,
		trackingToken,
	};
}

/**
 * Place an order from an untrusted guest cart (QR menu or group cart).
 * Priced ONLY from the live menu via @bite/core priceCart; nothing the
 * client says about money is used. Idempotent on (org, key): the same key
 * and same cart returns the existing order; a different cart is refused.
 */
export async function placeGuestOrder(
	tx: Tx,
	ids: { orgId: string; locationId: string },
	input: GuestOrderInput,
	opts: {
		source: "guest" | "group";
		now: Date;
		idempotencyKey: string;
		fingerprint: string;
		/** For the plan check (QR ordering is a paid feature). */
		deps: Pick<Deps, "planEnforcement" | "now">;
		/** The guest menu's remembered-guest token, if it sent one. */
		guestToken?: string | undefined;
	},
): Promise<{
	view: GuestOrderView;
	created: boolean;
	orderId: string;
	guest?: CreateGuestOrderResponse["guest"];
}> {
	const [prior] = await tx
		.select({
			id: orders.id,
			fp: orders.idempotencyFingerprint,
			token: orders.trackingToken,
		})
		.from(orders)
		.where(
			and(
				eq(orders.orgId, ids.orgId),
				eq(orders.idempotencyKey, opts.idempotencyKey),
			),
		);
	if (prior) {
		if (prior.fp !== opts.fingerprint) {
			throw new ApiError(
				"idempotency_mismatch",
				"this Idempotency-Key was used for a different order",
			);
		}
		const dto = await loadOrderDto(tx, prior.id);
		if (!dto) throw new ApiError("internal", "order vanished");
		return {
			view: toGuestView(dto, prior.token),
			created: false,
			orderId: prior.id,
		};
	}

	const [loc] = await tx
		.select()
		.from(locations)
		.where(eq(locations.id, ids.locationId));
	const menu = await loadMenuSnapshot(tx, ids.locationId, opts.now);
	if (!loc || !menu) throw new ApiError("not_found", "no such location");
	if (!acceptsOrders(loc, opts.now)) throw rejectGuest("not_accepting_orders");
	// On a plan without QR ordering the menu is view-only. Same answer as a
	// closed shop: the guest is told to order at the counter.
	const plan = await loadEntitlements(tx, opts.deps, ids.orgId);
	if (!plan.features.qr_ordering) throw rejectGuest("not_accepting_orders");

	const catalog = buildCatalog(
		menu.products.map((p) => ({
			id: p.id,
			categoryId: p.categoryId,
			name:
				p.name.ar === undefined
					? { en: p.name.en }
					: { en: p.name.en, ar: p.name.ar },
			price: minor(p.price),
			taxBps: p.taxBps === null ? null : bps(p.taxBps),
			isAvailable: p.isAvailable,
			modifierGroupIds: p.modifierGroupIds,
		})),
		menu.modifierGroups.map((g) => ({
			id: g.id,
			name:
				g.name.ar === undefined
					? { en: g.name.en }
					: { en: g.name.en, ar: g.name.ar },
			minSelect: g.minSelect,
			maxSelect: g.maxSelect,
			options: g.options.map((o) => ({
				id: o.id,
				name:
					o.name.ar === undefined
						? { en: o.name.en }
						: { en: o.name.en, ar: o.name.ar },
				priceDelta: minor(o.priceDelta),
				isAvailable: o.isAvailable,
			})),
		})),
	);
	const cart: CartLine[] = input.lines.map((l) => ({
		productId: l.productId,
		quantity: l.quantity,
		modifierOptionIds: l.modifierOptionIds,
		note: l.note ?? null,
	}));
	const at = localClock(opts.now.getTime(), loc.timezone);
	const priced = priceCart(cart, catalog, {
		settings: {
			pricesIncludeTax: loc.pricesIncludeTax,
			taxBps: bps(loc.taxBps),
			locationId: loc.id,
		},
		promotions: menu.promotions,
		at,
	});
	if (!priced.ok) {
		const first = priced.errors[0];
		const reason = (first && REASON[first.code]) ?? "items_unavailable";
		const lineIds = priced.errors.flatMap((e) => {
			const l =
				e.lineIndex === undefined ? undefined : input.lines[e.lineIndex];
			return l ? [l.id] : [];
		});
		throw rejectGuest(reason, [...new Set(lineIds)]);
	}
	const p = priced.value;

	const day = businessDate(
		opts.now.getTime(),
		loc.timezone,
		loc.dayCutoffMinutes,
	);
	const prefix = opts.source === "group" ? "G" : "Q";
	const [counter] = await tx
		.insert(ticketCounters)
		.values({
			orgId: ids.orgId,
			locationId: loc.id,
			businessDate: day,
			prefix,
			lastSeq: 1,
		})
		.onConflictDoUpdate({
			target: [
				ticketCounters.locationId,
				ticketCounters.businessDate,
				ticketCounters.prefix,
			],
			set: { lastSeq: sql`${ticketCounters.lastSeq} + 1` },
		})
		.returning({ seq: ticketCounters.lastSeq });

	let row: { id: string; token: string } | undefined;
	try {
		[row] = await tx
			.insert(orders)
			.values({
				orgId: ids.orgId,
				locationId: loc.id,
				ticketNumber: `${prefix}-${counter?.seq ?? 1}`,
				businessDate: day,
				source: opts.source,
				type: input.type,
				paymentStatus: paymentStatusFor(p.total, minor(0), minor(0)),
				customerName: input.customerName ?? null,
				customerPhone: input.customerPhone ?? null,
				tableLabel:
					input.type === "dine_in" ? (input.tableLabel ?? null) : null,
				note: input.note ?? null,
				pricesIncludeTax: p.pricesIncludeTax,
				subtotal: p.subtotal,
				discountTotal: p.discountTotal,
				taxTotal: p.taxTotal,
				total: p.total,
				idempotencyKey: opts.idempotencyKey,
				idempotencyFingerprint: opts.fingerprint,
				placedAt: opts.now,
				expiresAt: new Date(opts.now.getTime() + GUEST_ORDER_TTL_MS),
			})
			.returning({ id: orders.id, token: orders.trackingToken });
	} catch (err) {
		// Two retries raced with the same key: the other one won.
		if (isUniqueViolation(err, "orders_idempotency_uq")) {
			throw new ApiError("conflict", "order is being placed, retry");
		}
		throw err;
	}
	if (!row) throw new ApiError("internal", "insert returned nothing");
	const orderId = row.id;
	await tx.insert(orderLines).values(
		p.lines.map((l, i) => ({
			orgId: ids.orgId,
			orderId,
			productId: l.productId,
			name: l.name,
			quantity: l.quantity,
			unitPrice: l.unitPrice,
			listUnitPrice: l.listUnitPrice,
			promotionId: l.promotionId,
			modifiers: l.modifiers.map((m) => ({ ...m })),
			taxBps: l.taxBps,
			lineTotal: l.lineTotal,
			lineDiscount: l.lineDiscount,
			lineTax: l.lineTax,
			note: l.note,
			sortOrder: i,
		})),
	);
	const guest = await linkGuest(tx, ids.orgId, orderId, p.total, input, opts);
	const dto = await loadOrderDto(tx, orderId);
	if (!dto) throw new ApiError("internal", "order vanished");
	return {
		view: toGuestView(dto, row.token),
		created: true,
		orderId,
		...(guest ? { guest } : {}),
	};
}

/**
 * Returning guests: a typed phone finds or creates the org's customer; a
 * remembered token stands in for the phone. A token is handed out only to
 * the device that first used a number (or that already holds one), so typing
 * someone else's number earns them points but shows you nothing of theirs.
 */
async function linkGuest(
	tx: Tx,
	orgId: string,
	orderId: string,
	total: number,
	input: GuestOrderInput,
	opts: { now: Date; guestToken?: string | undefined },
): Promise<CreateGuestOrderResponse["guest"]> {
	const known = await customerForToken(tx, orgId, opts.guestToken);
	const typed = input.customerPhone
		? await upsertCustomer(tx, orgId, input.customerPhone, input.customerName)
		: null;
	const customer = typed?.customer ?? known;
	if (!customer) {
		if (input.rewardId) throw rejectGuest("reward_unavailable");
		return undefined;
	}
	await attachCustomer(tx, orderId, customer, opts.now);
	const sameGuest = known?.id === customer.id;
	const token =
		typed?.created || (!known && !typed)
			? await issueGuestToken(tx, orgId, customer.id)
			: undefined;
	let redeemed: { rewardId: string; amount: number } | undefined;
	let points = customer.points;
	if (input.rewardId) {
		if (!sameGuest) throw rejectGuest("reward_unavailable");
		try {
			const r = await redeemReward(tx, {
				orgId,
				orderId,
				customerId: customer.id,
				rewardId: input.rewardId,
				now: opts.now,
			});
			redeemed = { rewardId: input.rewardId, amount: r.amount };
			points -= r.points;
			// A reward that covers the whole bill: the order is paid already.
			await awardIfPaid(tx, orderId);
		} catch (err) {
			if (err instanceof ApiError) throw rejectGuest("reward_unavailable");
			throw err;
		}
	}
	const program = await loadProgram(tx, orgId);
	return {
		...(token ? { token } : {}),
		points,
		pointsPending: program.enabled
			? await pendingPoints(tx, orgId, total - (redeemed?.amount ?? 0))
			: 0,
		...(redeemed ? { redeemed } : {}),
	};
}
