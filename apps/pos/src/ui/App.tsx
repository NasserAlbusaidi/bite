import type { DeviceMe } from "@bite/contracts";
import { Logo } from "@bite/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient, type ApiConfig } from "../api/client.js";
import type { StaffMember } from "../auth/staff.js";
import type { SqlDriver } from "../db/driver.js";
import { kvGet, kvSet } from "../db/kv.js";
import { I18nProvider, useI18n } from "../i18n/I18nProvider.js";
import type { Lang } from "../i18n/i18n.js";
import type { PrintService } from "../print/printers.js";
import { SyncEngine } from "../sync/engine.js";
import { connectRealtime } from "../sync/realtime.js";
import { KdsShell } from "./KdsShell.js";
import { LockScreen } from "./LockScreen.js";
import { PairScreen } from "./PairScreen.js";
import { ProblemsSheet } from "./ProblemsSheet.js";
import { createPrintService } from "./printing.js";
import { SERVICE_EVENT, ServiceCalls } from "./ServiceCalls.js";
import { SettingsSheet } from "./SettingsSheet.js";
import { SyncBadge } from "./SyncBadge.js";
import { ServicesCtx } from "./services.js";
import { TillScreen } from "./TillScreen.js";

type Paired = { cfg: ApiConfig; device: DeviceMe };

export function App({ db }: { db: SqlDriver }) {
	const [boot, setBoot] = useState<{
		lang: Lang;
		paired: Paired | null;
	} | null>(null);

	useEffect(() => {
		(async () => {
			const lang = ((await kvGet(db, "device.lang")) as Lang | null) ?? "en";
			const raw = await kvGet(db, "device.pairing");
			setBoot({ lang, paired: raw ? (JSON.parse(raw) as Paired) : null });
		})();
	}, [db]);

	const saveLang = useCallback(
		(l: Lang) => void kvSet(db, "device.lang", l),
		[db],
	);

	if (!boot) return null;
	return (
		<I18nProvider initial={boot.lang} onChange={saveLang}>
			{boot.paired ? (
				<PairedApp
					db={db}
					paired={boot.paired}
					onUnpair={async () => {
						await db.run(
							"DELETE FROM kv WHERE key IN ('device.pairing', 'sync.cursor', 'menu.version')",
						);
						setBoot({ ...boot, paired: null });
					}}
				/>
			) : (
				<PairScreen
					onPaired={async (cfg, device) => {
						const paired = { cfg, device };
						await kvSet(db, "device.pairing", JSON.stringify(paired));
						setBoot({ ...boot, paired });
					}}
				/>
			)}
		</I18nProvider>
	);
}

function PairedApp(props: {
	db: SqlDriver;
	paired: Paired;
	onUnpair: () => void;
}) {
	const { db, paired } = props;
	const api = useMemo(() => new ApiClient(paired.cfg), [paired.cfg]);
	const sync = useMemo(
		() => new SyncEngine(db, api, paired.device.deviceId),
		[db, api, paired.device.deviceId],
	);
	const [print, setPrint] = useState<{
		service: PrintService;
		holder: { printers: import("../print/printers.js").PrinterConfig[] };
	} | null>(null);
	const [member, setMember] = useState<StaffMember | null>(null);
	const [settings, setSettings] = useState(false);
	const [problems, setProblems] = useState(false);
	const { t, lang, setLang } = useI18n();

	const { onUnpair } = props;
	useEffect(() => {
		sync.start();
		// Realtime events are hints: every one (and every reconnect) just triggers a pull.
		const rt = connectRealtime({
			baseUrl: paired.cfg.baseUrl,
			deviceToken: paired.cfg.deviceToken,
			deviceId: paired.device.deviceId,
			handlers: {
				onReady: () => sync.kick(),
				onEvent: (e) =>
					e.type === "service.changed"
						? window.dispatchEvent(new Event(SERVICE_EVENT))
						: sync.kick(),
				onRevoked: onUnpair,
			},
		});
		return () => {
			rt.stop();
			sync.stop();
		};
	}, [sync, paired, onUnpair]);
	useEffect(() => {
		void createPrintService(db).then(setPrint);
	}, [db]);

	if (!print) return null;
	if (!member)
		return (
			<LockScreen
				db={db}
				api={api}
				deviceKind={paired.device.kind}
				onUnlock={setMember}
			/>
		);

	const services = {
		db,
		api,
		sync,
		device: paired.device,
		print: print.service,
		member,
		lock: () => {
			api.clearStaff();
			setMember(null);
		},
	};
	return (
		<ServicesCtx.Provider value={services}>
			<div
				className="app"
				{...(paired.device.kind === "kds"
					? { "data-theme": "dark", "data-density": "far" }
					: {})}
			>
				<header className="topbar">
					<Logo height={22} className="topbar__logo" />
					<strong>{paired.device.name}</strong>
					<span className="muted">{member.displayName}</span>
					<span className="spacer" />
					<SyncBadge db={db} sync={sync} onOpen={() => setProblems(true)} />
					<button
						type="button"
						onClick={() => setLang(lang === "en" ? "ar" : "en")}
					>
						{t("lang.toggle")}
					</button>
					<button type="button" onClick={() => setSettings(true)}>
						{t("settings.title")}
					</button>
					<button type="button" onClick={services.lock}>
						{t("lock.lock")}
					</button>
				</header>
				<main className="main-full">
					{paired.device.kind === "kds" ? <KdsShell /> : <TillScreen />}
				</main>
				{paired.device.kind !== "kds" && <ServiceCalls />}
				{problems && <ProblemsSheet onClose={() => setProblems(false)} />}
				{settings && (
					<SettingsSheet
						holder={print.holder}
						onClose={() => setSettings(false)}
						onUnpair={props.onUnpair}
					/>
				)}
			</div>
		</ServicesCtx.Provider>
	);
}
