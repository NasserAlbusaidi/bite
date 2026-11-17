import { formatDecimal, type Minor } from "@bite/core";
import type { SessionReport } from "../domain/cash.js";
import type { Ticket, TicketBlock } from "./ticket.js";

export type ReportLabels = {
	title: string;
	opened: string;
	closed: string;
	float: string;
	sales: string;
	refunds: string;
	tips: string;
	payIns: string;
	payOuts: string;
	drops: string;
	expected: string;
	counted: string;
	variance: string;
	orders: string;
	unsynced: string;
	currency: string;
	method: (m: string) => string;
};

/** X report while the drawer is open, Z report once it is closed. */
export function sessionReportTicket(
	r: SessionReport,
	l: ReportLabels,
	opts: { deviceName: string; timeZone: string; dir: Ticket["dir"] },
): Ticket {
	const money = (m: number) => `${formatDecimal(m as Minor)} ${l.currency}`;
	const when = (iso: string) =>
		new Intl.DateTimeFormat("en-GB", {
			timeZone: opts.timeZone,
			day: "2-digit",
			month: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(new Date(iso));
	const blocks: TicketBlock[] = [
		{ kind: "text", text: l.title, align: "center", bold: true, size: 2 },
		{ kind: "text", text: opts.deviceName, align: "center" },
		{ kind: "text", text: r.session.businessDate, align: "center" },
		{ kind: "pair", left: l.opened, right: when(r.session.openedAt) },
	];
	if (r.session.closedAt)
		blocks.push({
			kind: "pair",
			left: l.closed,
			right: when(r.session.closedAt),
		});
	blocks.push(
		{ kind: "rule" },
		{ kind: "pair", left: l.orders, right: String(r.orders) },
	);
	for (const [method, t] of Object.entries(r.byMethod)) {
		if (!t) continue;
		blocks.push({
			kind: "pair",
			left: `${l.method(method)} ${l.sales} (${t.count})`,
			right: money(t.sales),
		});
		if (t.refunds > 0)
			blocks.push({
				kind: "pair",
				left: `${l.method(method)} ${l.refunds}`,
				right: money(-t.refunds),
			});
	}
	if (r.tips > 0)
		blocks.push({ kind: "pair", left: l.tips, right: money(r.tips) });
	blocks.push(
		{ kind: "rule" },
		{ kind: "pair", left: l.float, right: money(r.session.openingFloat) },
	);
	if (r.payIns)
		blocks.push({ kind: "pair", left: l.payIns, right: money(r.payIns) });
	if (r.payOuts)
		blocks.push({ kind: "pair", left: l.payOuts, right: money(-r.payOuts) });
	if (r.drops)
		blocks.push({ kind: "pair", left: l.drops, right: money(-r.drops) });
	blocks.push({
		kind: "pair",
		left: l.expected,
		right: money(r.expectedCash),
		bold: true,
	});
	if (r.session.countedCash !== null && r.variance !== null) {
		blocks.push(
			{ kind: "pair", left: l.counted, right: money(r.session.countedCash) },
			{
				kind: "pair",
				left: l.variance,
				right: money(r.variance),
				bold: true,
			},
		);
	}
	if (r.unsynced > 0)
		blocks.push(
			{ kind: "rule" },
			{ kind: "text", text: `${l.unsynced}: ${r.unsynced}`, bold: true },
		);
	blocks.push({ kind: "feed", lines: 3 });
	return { blocks, dir: opts.dir, cut: true };
}
