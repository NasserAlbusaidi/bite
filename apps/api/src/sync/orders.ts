import type { CreatePosOrder, SetFulfillment, VoidLine } from "@bite/contracts";
import {
	bps,
	checkFulfillmentTransition,
	fulfillmentPolicyFor,
	type LineInput,
	localClock,
	minor,
	type Promotion,
	paymentStatusFor,
	priceLines,
} from "@bite/core";
import { schema, type Tx } from "@bite/db";
import { and, eq, inArray, isNull, sql } from "@bite/db/orm";
import { ApiError } from "../lib/errors.js";
import type { MutationCtx, MutationOutcome } from "./context.js";

const { locations, orders, orderLines, payments, products, promotions } =
	schema;

/** Zod gives `ar?: string | undefined`; core wants the key absent. */
const localized = (t: { en: string; ar?: string | undefined }) =>
	t.ar === undefined ? { en: t.en } : { en: t.en, ar: t.ar };

export const reject = (reason: string, message: string, extra = {}) =>
	new ApiError("unprocessable", message, { reason, ...extra });

/** Lock the order row for the rest of the transaction. Tenancy via RLS. */
export async function lockOrder(tx: Tx, orderId: string, locationId: string) {
	const [o] = await tx
		.select()
		.from(orders)
		.where(eq(orders.id, orderId))
		.for("update");
	if (!o || o.locationId !== locationId) {
		throw new ApiError("not_found", "no such order at this location");
	}
	return o;
}

export function checkBaseVersion(
	ctx: MutationCtx,
	current: { version: number },
) {
	if (ctx.baseVersion !== undefined && ctx.baseVersion !== current.version) {
		throw new ApiError("conflict", "order changed since the tablet saw it", {
			currentVersion: current.version,
		});
	}
}

/**
 * order.create from a tablet. Per Nasser (2026-11-17): keep the prices the
 * tablet snapshotted, recompute every derived amount with @bite/core, and
 * reject the order if the totals differ from the tablet's.
 *
 * The recompute honours the tablet's promotion CHOICE: only the promotion it
 * applied is offered to the pricer (evaluated at placedAt, so a happy hour
 * that ended while the tablet was offline still counts), and isActive is
 * ignored because deactivating a promo later must not void a sale already made.
 */
export async function createPosOrder(
	ctx: MutationCtx,
	p: CreatePosOrder,
): Promise<MutationOutcome> {
	const { tx, device } = ctx;
	if (!p.ticketNumber.startsWith(`${device.ticketPrefix}-`)) {
		throw reject(
			"ticket_prefix",
			`ticket must start with ${device.ticketPrefix}-`,
		);
	}
	const [existing] = await tx
		.select({ id: orders.id })
		.from(orders)
		.where(eq(orders.id, p.id));
	if (existing) throw reject("order_exists", "an order with this id exists");

	const [loc] = await tx
		.select()
		.from(locations)
		.where(eq(locations.id, device.locationId));
	if (!loc) throw new ApiError("not_found", "location not visible");

	const productIds = [...new Set(p.lines.map((l) => l.productId))];
	const prodRows = await tx
		.select({ id: products.id, categoryId: products.categoryId })
		.from(products)
		.where(inArray(products.id, productIds));
	const categoryOf = new Map(prodRows.map((r) => [r.id, r.categoryId]));
	const unknown = p.lines.filter((l) => !categoryOf.has(l.productId));
	if (unknown.length) {
		throw reject("unknown_product", "unknown product", {
			lineIds: unknown.map((l) => l.id),
		});
	}

	const promoIds = [
		...new Set(p.lines.flatMap((l) => (l.promotionId ? [l.promotionId] : []))),
	];
	const promoRows = promoIds.length
		? await tx.select().from(promotions).where(inArray(promotions.id, promoIds))
		: [];
	const promoById = new Map(promoRows.map((r) => [r.id, r]));
	const missingPromo = p.lines.filter(
		(l) => l.promotionId && !promoById.has(l.promotionId),
	);
	if (missingPromo.length) {
		throw reject("unknown_promotion", "unknown promotion", {
			lineIds: missingPromo.map((l) => l.id),
		});
	}

	const at = localClock(Date.parse(p.placedAt), loc.timezone);
	const priced: ReturnType<typeof priceLines>[] = [];
	// Price line by line so each line only sees the promotion the tablet chose.
	// per_line tax mode makes this identical to pricing them together.
	for (const l of p.lines) {
		const input: LineInput = {
			productId: l.productId,
			categoryId: categoryOf.get(l.productId) ?? null,
			name: localized(l.name),
			quantity: l.quantity,
			listUnitPrice: minor(l.listUnitPrice),
			taxBps: bps(l.taxBps),
			modifiers: l.modifiers.map((m) => ({
				...m,
				name: localized(m.name),
				priceDelta: minor(m.priceDelta),
			})),
			note: l.note ?? null,
		};
		const promo = l.promotionId ? promoById.get(l.promotionId) : undefined;
		const offered: Promotion[] = promo
			? [
					{
						id: promo.id,
						kind: promo.kind,
						value: promo.value,
						productId: promo.productId,
						categoryId: promo.categoryId,
						locationId: promo.locationId,
						startsAt: promo.startsAt?.getTime() ?? null,
						endsAt: promo.endsAt?.getTime() ?? null,
						dailyStart: promo.dailyStart,
						dailyEnd: promo.dailyEnd,
						daysOfWeek: promo.daysOfWeek,
						priority: promo.priority,
					},
				]
			: [];
		priced.push(
			priceLines([input], {
				settings: {
					pricesIncludeTax: p.pricesIncludeTax,
					taxBps: bps(loc.taxBps),
					locationId: loc.id,
				},
				promotions: offered,
				at,
			}),
		);
	}
	const lines = priced.map((r, i) => {
		const line = p.lines[i];
		if (!r.ok || !line) {
			throw reject("pricing_error", "line cannot be priced", {
				lineIds: line ? [line.id] : [],
				errors: r.ok ? [] : r.errors,
			});
		}
		const pl = r.value.lines[0];
		if (!pl) throw new Error("priceLines returned no line");
		if (pl.promotionId !== line.promotionId) {
			throw reject(
				"promotion_not_applicable",
				"promotion did not apply at placedAt",
				{
					lineIds: [line.id],
				},
			);
		}
		return { input: line, priced: pl };
	});

	const sumOf = (k: "lineTotal" | "lineDiscount" | "lineTax") =>
		lines.reduce((acc, l) => acc + l.priced[k], 0);
	const subtotal = sumOf("lineTotal");
	const discountTotal = sumOf("lineDiscount");
	const taxTotal = sumOf("lineTax");
	const total = p.pricesIncludeTax ? subtotal : subtotal + taxTotal;
	const computed = { subtotal, discountTotal, taxTotal, total };
	const e = p.expectedTotals;
	if (
		e.subtotal !== subtotal ||
		e.discountTotal !== discountTotal ||
		e.taxTotal !== taxTotal ||
		e.total !== total
	) {
		throw reject("totals_mismatch", "tablet totals differ from core pricing", {
			expected: e,
			computed,
		});
	}

	try {
		await tx.insert(orders).values({
			id: p.id,
			orgId: device.orgId,
			locationId: device.locationId,
			deviceId: device.deviceId,
			ticketNumber: p.ticketNumber,
			businessDate: p.businessDate,
			source: p.source,
			type: p.type,
			paymentStatus: paymentStatusFor(minor(total), minor(0), minor(0)),
			customerName: p.customerName ?? null,
			customerPhone: p.customerPhone ?? null,
			tableLabel: p.type === "dine_in" ? (p.tableLabel ?? null) : null,
			note: p.note ?? null,
			pricesIncludeTax: p.pricesIncludeTax,
			...computed,
			createdBy: ctx.member.memberId,
			placedAt: new Date(p.placedAt),
		});
	} catch (err) {
		if (isUniqueViolation(err, "orders_ticket_uq")) {
			throw reject("ticket_taken", "ticket number already used today");
		}
		throw err;
	}
	await tx.insert(orderLines).values(
		lines.map(({ input, priced: l }, i) => ({
			id: input.id,
			orgId: device.orgId,
			orderId: p.id,
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
	return { entityVersion: 1 };
}

export async function setFulfillment(
	ctx: MutationCtx,
	p: SetFulfillment,
): Promise<MutationOutcome> {
	const o = await lockOrder(ctx.tx, p.orderId, ctx.device.locationId);
	checkBaseVersion(ctx, o);
	if (o.fulfillmentStatus === p.to) return { entityVersion: o.version };
	if (p.to === "cancelled" && !p.reason) {
		throw reject("reason_required", "cancelling needs a reason");
	}
	const check = checkFulfillmentTransition(
		o.fulfillmentStatus,
		p.to,
		o.paymentStatus,
		fulfillmentPolicyFor(o),
	);
	if (!check.ok) {
		throw reject(check.error, `cannot go ${o.fulfillmentStatus} -> ${p.to}`);
	}
	const now = ctx.now;
	const [u] = await ctx.tx
		.update(orders)
		.set({
			fulfillmentStatus: p.to,
			version: sql`${orders.version} + 1`,
			...(p.to === "ready" ? { readyAt: now } : {}),
			...(p.to === "preparing" ? { readyAt: null } : {}),
			...(p.to === "completed" ? { completedAt: now } : {}),
			...(p.to === "cancelled"
				? { cancelledAt: now, cancelReason: p.reason ?? null }
				: {}),
		})
		.where(eq(orders.id, o.id))
		.returning({ version: orders.version });
	return { entityVersion: u?.version ?? o.version + 1 };
}

/**
 * Void one line. Totals are re-summed from the remaining lines' stored
 * amounts, which is exact because tax is rounded per line.
 */
export async function voidLine(
	ctx: MutationCtx,
	p: VoidLine,
): Promise<MutationOutcome> {
	const { tx } = ctx;
	const o = await lockOrder(tx, p.orderId, ctx.device.locationId);
	checkBaseVersion(ctx, o);
	if (
		o.fulfillmentStatus === "completed" ||
		o.fulfillmentStatus === "cancelled"
	) {
		throw reject("order_closed", "order is closed; refund instead");
	}
	const voided = await tx
		.update(orderLines)
		.set({
			voidedAt: ctx.now,
			voidedBy: ctx.member.memberId,
			voidReason: p.reason,
		})
		.where(
			and(
				eq(orderLines.id, p.lineId),
				eq(orderLines.orderId, o.id),
				isNull(orderLines.voidedAt),
			),
		)
		.returning({ id: orderLines.id });
	if (voided.length === 0)
		throw reject("line_not_voidable", "no such open line");

	const [t] = await tx
		.select({
			subtotal: sql<string>`coalesce(sum(${orderLines.lineTotal}), 0)`,
			discountTotal: sql<string>`coalesce(sum(${orderLines.lineDiscount}), 0)`,
			taxTotal: sql<string>`coalesce(sum(${orderLines.lineTax}), 0)`,
		})
		.from(orderLines)
		.where(and(eq(orderLines.orderId, o.id), isNull(orderLines.voidedAt)));
	const subtotal = Number(t?.subtotal ?? 0);
	const discountTotal = Number(t?.discountTotal ?? 0);
	const taxTotal = Number(t?.taxTotal ?? 0);
	const total = o.pricesIncludeTax ? subtotal : subtotal + taxTotal;

	const ledger = await tx
		.select({ amount: payments.amount, state: payments.state })
		.from(payments)
		.where(eq(payments.orderId, o.id));
	const ok = ledger.filter((r) => r.state === "succeeded");
	const paid = ok.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0);
	const refunded = -ok
		.filter((r) => r.amount < 0)
		.reduce((a, r) => a + r.amount, 0);
	if (paid - refunded > total) {
		throw reject("refund_first", "line is paid for; refund before voiding");
	}
	const [u] = await tx
		.update(orders)
		.set({
			subtotal,
			discountTotal,
			taxTotal,
			total,
			paymentStatus: paymentStatusFor(
				minor(total),
				minor(paid),
				minor(refunded),
			),
			version: sql`${orders.version} + 1`,
		})
		.where(eq(orders.id, o.id))
		.returning({ version: orders.version });
	return { entityVersion: u?.version ?? o.version + 1 };
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
	const e = err as { code?: string; constraint_name?: string; cause?: unknown };
	const pg = e?.code ? e : (e?.cause as typeof e | undefined);
	return (
		pg?.code === "23505" &&
		(constraint === undefined || pg.constraint_name === constraint)
	);
}
