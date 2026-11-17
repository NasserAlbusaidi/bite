import { useI18n } from "../i18n/I18nProvider.js";

/** Placeholder until the menu pull and cart land (next PR). */
export function PosShell() {
	const { t } = useI18n();
	return <p className="empty">{t("pos.empty")}</p>;
}
