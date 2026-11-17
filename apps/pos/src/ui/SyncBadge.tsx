import { useEffect, useState } from "react";
import type { SqlDriver } from "../db/driver.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { type SyncCounts, syncCounts } from "../sync/status.js";

export function SyncBadge({ db }: { db: SqlDriver }) {
	const { t } = useI18n();
	const [counts, setCounts] = useState<SyncCounts>({
		pending: 0,
		attention: 0,
	});
	const [online, setOnline] = useState(navigator.onLine);

	useEffect(() => {
		let alive = true;
		const tick = () => syncCounts(db).then((c) => alive && setCounts(c));
		tick();
		const id = setInterval(tick, 3_000);
		const on = () => setOnline(true);
		const off = () => setOnline(false);
		window.addEventListener("online", on);
		window.addEventListener("offline", off);
		return () => {
			alive = false;
			clearInterval(id);
			window.removeEventListener("online", on);
			window.removeEventListener("offline", off);
		};
	}, [db]);

	if (counts.attention > 0) {
		return (
			<span className="badge badge-bad">
				{t("sync.attention", { count: counts.attention })}
			</span>
		);
	}
	if (!online) {
		return (
			<span className="badge badge-warn">
				{t("sync.offline", { count: counts.pending })}
			</span>
		);
	}
	if (counts.pending > 0) {
		return (
			<span className="badge badge-warn">
				{t("sync.pending", { count: counts.pending })}
			</span>
		);
	}
	return <span className="badge badge-ok">{t("sync.online")}</span>;
}
