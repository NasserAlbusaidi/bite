import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client.js";
import {
	cacheStaffList,
	listCachedStaff,
	pinLogin,
	type StaffMember,
} from "../auth/staff.js";
import type { SqlDriver } from "../db/driver.js";
import { useI18n } from "../i18n/I18nProvider.js";

export function LockScreen(props: {
	db: SqlDriver;
	api: ApiClient;
	onUnlock: (m: StaffMember) => void;
}) {
	const { db, api } = props;
	const { t, lang, setLang } = useI18n();
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [who, setWho] = useState<StaffMember | null>(null);
	const [pin, setPin] = useState("");
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
		const res = await pinLogin(
			db,
			async (memberId, value) => {
				const r = await api.pinLogin(memberId, value);
				return {
					memberId: r.member.memberId,
					displayName: r.member.displayName,
					role: r.member.role,
				};
			},
			who.memberId,
			p,
		);
		setBusy(false);
		setPin("");
		if (res.ok) return props.onUnlock(res.member);
		setError(
			res.reason === "wrong_pin"
				? t("lock.wrong")
				: res.reason === "offline_unknown"
					? t("lock.offlineUnknown", { name: who.displayName })
					: res.reason === "offline_expired"
						? t("lock.offlineExpired")
						: res.reason === "rate_limited"
							? t("lock.rateLimited")
							: (res.message ?? "error"),
		);
	}

	function press(d: string) {
		setError(null);
		const next = (pin + d).slice(0, 8);
		setPin(next);
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
								<span className="muted">{s.role}</span>
							</button>
						))}
					</div>
				)}
				{who && (
					<div className="pinpad">
						<div className="pin-dots" dir="ltr">
							{"•".repeat(pin.length) || " "}
						</div>
						{error && <p className="error">{error}</p>}
						<div className="keys" dir="ltr">
							{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
								<button
									type="button"
									key={d}
									onClick={() => press(d)}
									disabled={busy}
								>
									{d}
								</button>
							))}
							<button
								type="button"
								onClick={() => (pin ? setPin(pin.slice(0, -1)) : setWho(null))}
							>
								{pin ? "⌫" : t("lock.back")}
							</button>
							<button type="button" onClick={() => press("0")} disabled={busy}>
								0
							</button>
							<button
								type="button"
								className="primary"
								disabled={busy || pin.length < 4}
								onClick={() => submit(pin)}
							>
								OK
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
