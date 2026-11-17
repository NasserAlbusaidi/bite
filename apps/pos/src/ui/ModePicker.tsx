import { useI18n } from "../i18n/I18nProvider.js";
import type { Mode } from "./App.js";

export function ModePicker({ onPick }: { onPick: (m: Mode) => void }) {
	const { t } = useI18n();
	return (
		<section className="mode-picker">
			<h1>{t("mode.pick")}</h1>
			<div className="mode-options">
				<button
					type="button"
					className="mode-card"
					onClick={() => onPick("pos")}
				>
					<span className="mode-title">{t("mode.pos")}</span>
					<span className="mode-hint">{t("mode.pos.hint")}</span>
				</button>
				<button
					type="button"
					className="mode-card"
					onClick={() => onPick("kds")}
				>
					<span className="mode-title">{t("mode.kds")}</span>
					<span className="mode-hint">{t("mode.kds.hint")}</span>
				</button>
			</div>
		</section>
	);
}
