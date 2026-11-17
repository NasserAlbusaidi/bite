import type { Order, PaymentMethod } from "@bite/contracts";
import type { Minor } from "@bite/core";
import type { Lang } from "../i18n/i18n.js";
import { translate } from "../i18n/i18n.js";
import { ticketLabels } from "../print/labels.js";
import {
	kitchenTicket,
	receipt,
	type Ticket,
	type TicketOrderInput,
} from "../print/ticket.js";

export const loc = (
	text: { en: string; ar?: string | undefined },
	lang: Lang,
) => (lang === "ar" && text.ar) || text.en;

export function methodLabel(lang: Lang, m: PaymentMethod): string {
	return m === "cash"
		? translate(lang, "pay.cash")
		: m === "card"
			? translate(lang, "pay.card")
			: translate(lang, "pay.other");
}

function base(order: Order, timeZone: string, lang: Lang): TicketOrderInput {
	return {
		ticketNumber: order.ticketNumber,
		type: order.type === "dine_in" ? "dine_in" : "takeaway",
		placedAt: new Date(order.placedAt),
		timeZone,
		note: order.note,
		customerName: order.customerName,
		lines: order.lines.map((l) => ({
			quantity: l.quantity,
			name: loc(l.name, lang),
			modifiers: l.modifiers.map((m) => loc(m.name, lang)),
			note: l.note,
			lineTotal: l.lineTotal as Minor,
			voided: l.voidedAt !== null,
		})),
	};
}

export function kitchenFor(
	order: Order,
	timeZone: string,
	lang: Lang,
	dir: Ticket["dir"],
): Ticket {
	return kitchenTicket(base(order, timeZone, lang), ticketLabels(lang), dir);
}

export function receiptFor(
	order: Order,
	opts: {
		timeZone: string;
		lang: Lang;
		dir: Ticket["dir"];
		locationName: string;
		/** Signed: refunds are negative and print as such. */
		payments: { method: PaymentMethod; amount: number }[];
		change?: number;
		openDrawer?: boolean;
		reprint?: boolean;
	},
): Ticket {
	const { lang } = opts;
	const t = receipt(
		{
			...base(order, opts.timeZone, lang),
			locationName: opts.locationName,
			subtotal: order.subtotal as Minor,
			discountTotal: order.discountTotal as Minor,
			taxTotal: order.taxTotal as Minor,
			total: order.total as Minor,
			payments: opts.payments.map((p) => ({
				label:
					p.amount < 0
						? `${translate(lang, "orders.refund")} ${methodLabel(lang, p.method)}`
						: methodLabel(lang, p.method),
				amount: p.amount as Minor,
			})),
			...(opts.change !== undefined && { change: opts.change as Minor }),
			...(opts.openDrawer && { openDrawer: true }),
		},
		ticketLabels(lang),
		opts.dir,
	);
	if (opts.reprint) {
		t.blocks.splice(1, 0, {
			kind: "text",
			text: translate(lang, "orders.copy"),
			align: "center",
			bold: true,
		});
	}
	return t;
}
