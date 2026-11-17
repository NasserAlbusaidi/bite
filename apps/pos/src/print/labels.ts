import type { Lang } from "../i18n/i18n.js";
import { translate } from "../i18n/i18n.js";
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
