import { useI18n } from "../i18n/I18nProvider.js";

/** Placeholder until order pull + realtime land (KDS PR). */
export function KdsShell() {
	const { t } = useI18n();
	return <p className="empty">{t("kds.empty")}</p>;
}
