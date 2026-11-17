import { useCallback, useEffect, useState } from "react";
import type { SqlDriver } from "../db/driver.js";
import { kvGet, kvSet } from "../db/kv.js";
import { I18nProvider, useI18n } from "../i18n/I18nProvider.js";
import type { Lang } from "../i18n/i18n.js";
import { KdsShell } from "./KdsShell.js";
import { ModePicker } from "./ModePicker.js";
import { PosShell } from "./PosShell.js";
import { SyncBadge } from "./SyncBadge.js";

export type Mode = "pos" | "kds";

type Settings = { mode: Mode | null; lang: Lang };

export function App({ db }: { db: SqlDriver }) {
	const [settings, setSettings] = useState<Settings | null>(null);

	useEffect(() => {
		(async () => {
			const mode = (await kvGet(db, "device.mode")) as Mode | null;
			const lang = ((await kvGet(db, "device.lang")) as Lang | null) ?? "en";
			setSettings({ mode, lang });
		})();
	}, [db]);

	const saveLang = useCallback(
		(l: Lang) => void kvSet(db, "device.lang", l),
		[db],
	);

	if (!settings) return null;
	return (
		<I18nProvider initial={settings.lang} onChange={saveLang}>
			<Shell
				db={db}
				mode={settings.mode}
				setMode={(mode) => {
					setSettings({ ...settings, mode });
					void (mode
						? kvSet(db, "device.mode", mode)
						: db.run("DELETE FROM kv WHERE key = 'device.mode'"));
				}}
			/>
		</I18nProvider>
	);
}

function Shell(props: {
	db: SqlDriver;
	mode: Mode | null;
	setMode: (m: Mode | null) => void;
}) {
	const { t, lang, setLang } = useI18n();
	return (
		<div className="app">
			<header className="topbar">
				<strong>{t("app.title")}</strong>
				<span className="spacer" />
				<SyncBadge db={props.db} />
				{props.mode && (
					<button type="button" onClick={() => props.setMode(null)}>
						{t("mode.switch")}
					</button>
				)}
				<button
					type="button"
					onClick={() => setLang(lang === "en" ? "ar" : "en")}
				>
					{t("lang.toggle")}
				</button>
			</header>
			<main>
				{props.mode === "pos" && <PosShell />}
				{props.mode === "kds" && <KdsShell />}
				{props.mode === null && <ModePicker onPick={props.setMode} />}
			</main>
		</div>
	);
}
