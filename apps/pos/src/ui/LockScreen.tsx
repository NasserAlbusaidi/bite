import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.js";
import {
	cacheStaffList,
	listCachedStaff,
	type StaffMember,
} from "../auth/staff.js";
import type { SqlDriver } from "../db/driver.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { loginError, loginWithPin } from "./login.js";
import { PinPad } from "./PinPad.js";

export function LockScreen(props: {
	db: SqlDriver;
	api: ApiClient;
	/** A till only lists people the server lets sell; kitchen staff use the KDS. */
	deviceKind: string;
	onUnlock: (m: StaffMember) => void;
}) {
	const { db, api } = props;
	const { t, lang, setLang } = useI18n();
	const [allStaff, setStaff] = useState<StaffMember[]>([]);
	const staff =
		props.deviceKind !== "kds"
			? allStaff.filter((s) => s.role !== "kitchen")
			: allStaff;
	const [who, setWho] = useState<StaffMember | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		(async () => {
			setStaff(await listCachedStaff(db));
			try {
				const res = await api.staff();
				await cacheStaffList(db, res.staff);
				setStaff(await listCachedStaff(db));
			} catch {
				// Offline: the cached list is what we have.
			}
		})();
	}, [db, api]);

	async function submit(p: string) {
		if (!who) return;
		setBusy(true);
		const res = await loginWithPin(db, api, who.memberId, p);
		setBusy(false);
		if (res.ok) return props.onUnlock(res.member);
		setError(loginError(t, res, who.displayName));
	}

	return (
		<div className="center-screen">
			<div className="card">
				<div className="row">
					<h1>
						{who ? t("lock.pin", { name: who.displayName }) : t("lock.title")}
					</h1>
					<span className="spacer" />
					<button
						type="button"
						onClick={() => setLang(lang === "en" ? "ar" : "en")}
					>
						{t("lang.toggle")}
					</button>
				</div>
				{!who && (
					<div className="staff-grid">
						{staff.length === 0 && <p className="muted">{t("lock.noStaff")}</p>}
						{staff.map((s) => (
							<button
								type="button"
								key={s.memberId}
								className="tile"
								onClick={() => setWho(s)}
							>
								<span className="tile-title">{s.displayName}</span>
								<span className="muted">{t(`role.${s.role}`)}</span>
							</button>
						))}
					</div>
				)}
				{who && (
					<PinPad
						busy={busy}
						error={error}
						onType={() => setError(null)}
						onSubmit={submit}
						onBack={() => setWho(null)}
					/>
				)}
			</div>
		</div>
	);
}
