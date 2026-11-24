import { formatDecimal, type Minor } from "@bite/core";

/**
 * Printer-agnostic ticket. Builders produce this; encoders turn it into
 * ESC/POS bytes (text or raster). Nothing here knows about a transport.
 */
export type TicketBlock =
	| {
			kind: "text";
			text: string;
			align?: "start" | "center" | "end";
			bold?: boolean;
			/** 2 = double width and height. */
			size?: 1 | 2;
	  }
	/** Label on the start side, value on the end side ("Total ...... 4.500"). */
	| { kind: "pair"; left: string; right: string; bold?: boolean }
	| { kind: "rule" }
	| { kind: "feed"; lines: number };

export type Ticket = {
	blocks: TicketBlock[];
	/** Paper direction for raster rendering; text mode is always LTR. */
	dir: "ltr" | "rtl";
	cut: boolean;
	openDrawer?: boolean;
};

export type TicketLineInput = {
	quantity: number;
	name: string;
	modifiers: string[];
	note?: string | null;
	lineTotal: Minor;
	voided?: boolean;
};

export type TicketOrderInput = {
	ticketNumber: string;
	type: "dine_in" | "takeaway";
	placedAt: Date;
	timeZone: string;
	lines: TicketLineInput[];
	note?: string | null;
	customerName?: string | null;
	tableLabel?: string | null;
};

export type TicketLabels = {
	dineIn: string;
	takeaway: string;
	note: string;
	orderNote: string;
	subtotal: string;
	discount: string;
	tax: string;
	total: string;
	paid: string;
	change: string;
	vatNumber: string;
	thanks: string;
	currency: string;
};

function time(d: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(d);
}

/**
 * Kitchen ticket. No prices. Notes are shouted because they carry allergens
 * (same rule as the legacy PrintNodeService). Voided lines are printed struck
 * so the kitchen sees what to stop making.
 */
export function kitchenTicket(
	order: TicketOrderInput,
	l: TicketLabels,
	dir: Ticket["dir"] = "ltr",
): Ticket {
	const blocks: TicketBlock[] = [
		{
			kind: "text",
			text: order.ticketNumber,
			align: "center",
			bold: true,
			size: 2,
		},
		{
			kind: "text",
			text:
				order.type === "dine_in"
					? order.tableLabel
						? `${l.dineIn} · ${order.tableLabel}`
						: l.dineIn
					: l.takeaway,
			align: "center",
			bold: true,
		},
		{
			kind: "text",
			text: time(order.placedAt, order.timeZone),
			align: "center",
		},
	];
	if (order.customerName) {
		blocks.push({ kind: "text", text: order.customerName, align: "center" });
	}
	blocks.push({ kind: "rule" });
	for (const line of order.lines) {
		const prefix = line.voided ? "VOID " : "";
		blocks.push({
			kind: "text",
			text: `${prefix}${line.quantity}x ${line.name}`,
			bold: true,
			size: 2,
		});
		for (const m of line.modifiers)
			blocks.push({ kind: "text", text: `  + ${m}` });
		if (line.note) {
			blocks.push({
				kind: "text",
				text: `  ** ${l.note}: ${line.note}`,
				bold: true,
			});
		}
	}
	blocks.push({ kind: "rule" });
	if (order.note) {
		blocks.push({
			kind: "text",
			text: `** ${l.orderNote}: ${order.note}`,
			bold: true,
		});
		blocks.push({ kind: "rule" });
	}
	blocks.push({ kind: "feed", lines: 3 });
	return { blocks, dir, cut: true };
}

export type ReceiptInput = TicketOrderInput & {
	locationName: string;
	vatNumber?: string | null;
	subtotal: Minor;
	discountTotal: Minor;
	taxTotal: Minor;
	total: Minor;
	payments: { label: string; amount: Minor }[];
	change?: Minor;
	openDrawer?: boolean;
};

export function receipt(
	r: ReceiptInput,
	l: TicketLabels,
	dir: Ticket["dir"] = "ltr",
): Ticket {
	const money = (m: Minor) => `${formatDecimal(m)} ${l.currency}`;
	const blocks: TicketBlock[] = [
		{
			kind: "text",
			text: r.locationName,
			align: "center",
			bold: true,
			size: 2,
		},
	];
	if (r.vatNumber) {
		blocks.push({
			kind: "text",
			text: `${l.vatNumber}: ${r.vatNumber}`,
			align: "center",
		});
	}
	blocks.push(
		{ kind: "text", text: `#${r.ticketNumber}`, align: "center", bold: true },
		{ kind: "text", text: time(r.placedAt, r.timeZone), align: "center" },
		{ kind: "rule" },
	);
	for (const line of r.lines) {
		if (line.voided) continue;
		blocks.push({
			kind: "pair",
			left: `${line.quantity}x ${line.name}`,
			right: formatDecimal(line.lineTotal),
		});
		for (const m of line.modifiers)
			blocks.push({ kind: "text", text: `  + ${m}` });
	}
	blocks.push(
		{ kind: "rule" },
		{ kind: "pair", left: l.subtotal, right: money(r.subtotal) },
	);
	if (r.discountTotal > 0) {
		blocks.push({
			kind: "pair",
			left: l.discount,
			right: `-${money(r.discountTotal)}`,
		});
	}
	blocks.push(
		{ kind: "pair", left: l.tax, right: money(r.taxTotal) },
		{ kind: "pair", left: l.total, right: money(r.total), bold: true },
		{ kind: "rule" },
	);
	for (const p of r.payments)
		blocks.push({ kind: "pair", left: p.label, right: money(p.amount) });
	if (r.change !== undefined && r.change > 0) {
		blocks.push({ kind: "pair", left: l.change, right: money(r.change) });
	}
	blocks.push(
		{ kind: "feed", lines: 1 },
		{ kind: "text", text: l.thanks, align: "center" },
		{ kind: "feed", lines: 3 },
	);
	return { blocks, dir, cut: true, ...(r.openDrawer && { openDrawer: true }) };
}

/** Text mode can only do printable ASCII reliably across cheap thermal printers. */
export function isAsciiOnly(t: Ticket): boolean {
	const ok = (s: string) => /^[\x20-\x7E]*$/.test(s);
	return t.blocks.every((b) =>
		b.kind === "text"
			? ok(b.text)
			: b.kind === "pair"
				? ok(b.left) && ok(b.right)
				: true,
	);
}
