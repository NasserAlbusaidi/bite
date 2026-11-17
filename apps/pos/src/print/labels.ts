import type { Lang } from "../i18n/i18n.js";
import { translate } from "../i18n/i18n.js";
import type { ReportLabels } from "./report.js";
import type { TicketLabels } from "./ticket.js";

export function ticketLabels(lang: Lang): TicketLabels {
	const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
	return {
		dineIn: t("order.dineIn"),
		takeaway: t("order.takeaway"),
		note: t("order.note"),
		orderNote: t("order.orderNote"),
		subtotal: t("money.subtotal"),
		discount: t("money.discount"),
		tax: t("money.tax"),
		total: t("money.total"),
		paid: t("money.paid"),
		change: t("money.change"),
		vatNumber: t("money.vatNumber"),
		thanks: t("receipt.thanks"),
		currency: t("money.currency"),
	};
}

export function reportLabels(lang: Lang, closed: boolean): ReportLabels {
	const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
	return {
		title: t(closed ? "report.z" : "report.x"),
		opened: t("report.opened"),
		closed: t("report.closed"),
		float: t("drawer.float"),
		carried: t("drawer.carried"),
		sales: t("report.sales"),
		refunds: t("report.refunds"),
		tips: t("report.tips"),
		payIns: t("drawer.pay_in"),
		payOuts: t("drawer.pay_out"),
		drops: t("drawer.drop"),
		expected: t("report.expected"),
		counted: t("drawer.counted"),
		variance: t("report.variance"),
		orders: t("report.orders"),
		unsynced: t("report.unsynced"),
		currency: t("money.currency"),
		method: (m) =>
			m === "cash"
				? t("pay.cash")
				: m === "card"
					? t("pay.card")
					: t("pay.other"),
	};
}
