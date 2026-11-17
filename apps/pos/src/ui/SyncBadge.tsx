import { useEffect, useState } from "react";
import type { SqlDriver } from "../db/driver.js";
import { useI18n } from "../i18n/I18nProvider.js";
import type { SyncEngine, SyncState } from "../sync/engine.js";
import { type SyncCounts, syncCounts } from "../sync/status.js";

export function SyncBadge({
	db,
	sync,
	onOpen,
}: {
	db: SqlDriver;
	sync: SyncEngine;
	onOpen: () => void;
}) {
	const { t } = useI18n();
	const [counts, setCounts] = useState<SyncCounts>({
		pending: 0,
		attention: 0,
	});
	const [state, setState] = useState<SyncState>(sync.state);

	useEffect(() => {
		let alive = true;
		const tick = () => syncCounts(db).then((c) => alive && setCounts(c));
		tick();
		const id = setInterval(tick, 2_000);
		const unsub = sync.subscribe(setState);
		return () => {
			alive = false;
			clearInterval(id);
			unsub();
		};
	}, [db, sync]);

	const title = state.lastError ?? undefined;
	if (counts.attention > 0) {
		return (
			<button
				type="button"
				className="badge badge-bad"
				title={title}
				onClick={onOpen}
			>
				{t("sync.attention", { count: counts.attention })}
			</button>
		);
	}
	if (!state.online) {
		return (
			<span className="badge badge-warn" title={title}>
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
