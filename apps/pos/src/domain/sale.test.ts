import { AddPayment, CreatePosOrder } from "@bite/contracts";
import {
	type BasisPoints,
	localClock,
	type Minor,
	priceLines,
} from "@bite/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { SqlDriver } from "../db/driver.js";
import { migrate } from "../db/migrations.js";
import { openSqlJs } from "../db/sqljs-driver.js";
import { listOutbox } from "../sync/outbox.js";
import {
	menuFixture,
	O_OAT,
	P_CROISSANT,
	P_FLAT,
	P_SOLDOUT,
	PROMO,
} from "../test/fixtures.js";
import { newId } from "./ids.js";
import { prepareMenu } from "./menu.js";
import { commitSale, quote, type TillLine, upsertOrders } from "./sale.js";

const MEMBER = "0190f000-0000-7000-8000-0000000000aa";
const SESSION = "0190f000-0000-7000-8000-0000000000bb";
// 2026-11-18 01:30 in Muscat (UTC+4): before the 4am cutoff, so business day is the 17th.
const AT = Date.parse("2026-11-17T21:30:00Z");

const line = (
	productId: string,
	quantity = 1,
	mods: string[] = [],
): TillLine => ({
	lineId: newId(),
	productId,
	quantity,
	modifierOptionIds: mods,
});

let db: SqlDriver;
beforeEach(async () => {
	db = await openSqlJs();
	await migrate(db);
});

describe("quote", () => {
	it("prices with core: modifiers, category promotion, inclusive VAT", () => {
		const q = quote(
			prepareMenu(menuFixture()),
			[line(P_FLAT, 2, [O_OAT]), line(P_CROISSANT)],
			AT,
		);
		if (!q.ok) throw new Error(JSON.stringify(q.errors));
		// 2 x (1.800 + 0.300) + 1.250 - 10% (1.125)
		expect(q.priced.total).toBe(4_200 + 1_125);
		expect(q.priced.lines[1]?.promotionId).toBe(PROMO);
		expect(q.priced.discountTotal).toBe(125);
	});

	it("flags 86'd items and missing required modifiers, all at once", () => {
		const q = quote(
			prepareMenu(menuFixture()),
			[line(P_FLAT), line(P_SOLDOUT)],
			AT,
		);
		expect(q.ok).toBe(false);
		if (q.ok) return;
		expect(q.errors.map((e) => e.code).sort()).toEqual([
			"modifier_below_min",
			"product_unavailable",
		]);
	});
});

describe("commitSale", () => {
	it("queues order.create + payment that pass the contracts and re-price to the same totals", async () => {
		const menu = prepareMenu(menuFixture());
		const res = await commitSale(db, {
			menu,
			lines: [line(P_FLAT, 2, [O_OAT]), line(P_CROISSANT)],
			at: AT,
			type: "takeaway",
			ticketPrefix: "A",
			memberId: MEMBER,
			tenders: [
				{ method: "cash", amount: 5_325 as Minor, tendered: 10_000 as Minor },
			],
			cashSessionId: SESSION,
		});
		if (!res.ok) throw new Error(res.error);
		expect(res.change).toBe(4_675);
		expect(res.order.ticketNumber).toBe("A-001");
		expect(res.order.businessDate).toBe("2026-11-17");
		expect(res.order.paymentStatus).toBe("paid");

		const outbox = await listOutbox(db);
		expect(outbox.map((m) => [m.kind, m.entityId])).toEqual([
			["order.create", res.order.id],
			["order.addPayment", res.order.id],
		]);
		const create = CreatePosOrder.parse(outbox[0]?.payload);
		const pay = AddPayment.parse(outbox[1]?.payload);
		expect(pay).toMatchObject({
			amount: 5_325,
			tendered: 10_000,
			method: "cash",
			cashSessionId: SESSION,
		});

		// What the server does: re-price the snapshotted line inputs with core.
		const loc = menu.snapshot.location;
		const recheck = priceLines(
			create.lines.map((l) => ({
				productId: l.productId,
				categoryId: menu.catalog.get(l.productId)?.categoryId ?? null,
				name: l.name as { en: string },
				quantity: l.quantity,
				listUnitPrice: l.listUnitPrice as Minor,
				taxBps: l.taxBps as BasisPoints,
				modifiers: l.modifiers.map((m) => ({
					...m,
					name: m.name as { en: string },
					priceDelta: m.priceDelta as Minor,
				})),
			})),
			{
				settings: {
					pricesIncludeTax: create.pricesIncludeTax,
					taxBps: loc.taxBps as BasisPoints,
					locationId: loc.locationId,
				},
				promotions: menu.promotions,
				at: localClock(Date.parse(create.placedAt), loc.timezone),
			},
		);
		if (!recheck.ok) throw new Error("recheck failed");
		expect({
			subtotal: recheck.value.subtotal,
			discountTotal: recheck.value.discountTotal,
			taxTotal: recheck.value.taxTotal,
			total: recheck.value.total,
		}).toEqual(create.expectedTotals);
		expect(create.lines.map((l) => l.promotionId)).toEqual([null, PROMO]);
	});

	it("refuses overpayment by card and cash without a session, and writes nothing", async () => {
		const menu = prepareMenu(menuFixture());
		const base = {
			menu,
			lines: [line(P_CROISSANT)],
			at: AT,
			type: "dine_in" as const,
			ticketPrefix: "A",
			memberId: MEMBER,
		};
		const card = await commitSale(db, {
			...base,
			tenders: [{ method: "card", amount: 9_999 as Minor }],
			cashSessionId: null,
		});
		expect(card).toEqual({ ok: false, error: "overpayment" });
		const cash = await commitSale(db, {
			...base,
			tenders: [{ method: "cash", amount: 1_125 as Minor }],
			cashSessionId: null,
		});
		expect(cash).toEqual({ ok: false, error: "no_cash_session" });
		expect(await listOutbox(db)).toHaveLength(0);
	});

	it("split tender: card + cash adds up, ticket numbers increase", async () => {
		const menu = prepareMenu(menuFixture());
		const sale = (tenders: Parameters<typeof commitSale>[1]["tenders"]) =>
			commitSale(db, {
				menu,
				lines: [line(P_CROISSANT, 2)],
				at: AT,
				type: "dine_in",
				ticketPrefix: "B",
				memberId: MEMBER,
				tenders,
				cashSessionId: SESSION,
			});
		const a = await sale([
			{ method: "card", amount: 1_000 as Minor },
			{ method: "cash", amount: 1_250 as Minor, tendered: 2_000 as Minor },
		]);
		if (!a.ok) throw new Error(a.error);
		expect(a.payments.map((p) => p.amount)).toEqual([1_000, 1_250]);
		expect(a.change).toBe(750);
		const b = await sale([{ method: "card", amount: 2_250 as Minor }]);
		if (!b.ok) throw new Error(b.error);
		expect(b.order.ticketNumber).toBe("B-002");
	});
});

describe("upsertOrders", () => {
	it("server copy replaces the local one; older versions never win", async () => {
		const menu = prepareMenu(menuFixture());
		const res = await commitSale(db, {
			menu,
			lines: [line(P_CROISSANT)],
			at: AT,
			type: "dine_in",
			ticketPrefix: "A",
			memberId: MEMBER,
			tenders: [{ method: "card", amount: 1_125 as Minor }],
			cashSessionId: null,
		});
		if (!res.ok) throw new Error(res.error);
		const v2 = {
			...res.order,
			version: 2,
			fulfillmentStatus: "preparing" as const,
		};
		await upsertOrders(db, [v2]);
		await upsertOrders(db, [
			{ ...res.order, version: 1, fulfillmentStatus: "pending" as const },
		]);
		const [row] = await db.all<{ fulfillment_status: string; version: number }>(
			"SELECT * FROM orders",
		);
		expect(row).toMatchObject({ fulfillment_status: "preparing", version: 2 });
	});
});
