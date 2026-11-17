import type { CashMovementKind } from "@bite/contracts";
import { useCallback, useEffect, useState } from "react";
import {
	addCashMovement,
	type CashSession,
	closeCashSession,
	openCashSession,
	openSession,
	type SessionReport,
	sessionReport,
} from "../domain/cash.js";
import { loadMenu } from "../domain/menu.js";
import { useI18n } from "../i18n/I18nProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { reportLabels } from "../print/labels.js";
import { sessionReportTicket } from "../print/report.js";
import { fmt, parseAmount } from "./money.js";
import { methodLabel } from "./receipts.js";
import { useServices } from "./services.js";

const KINDS: CashMovementKind[] = ["pay_in", "pay_out", "drop"];

/** The drawer: X report, pay in/out, safe drops, and closing with a count (Z report). */
export function DrawerSheet(props: { onClose: () => void }) {
	const { db, sync, member, print, device } = useServices();
	const { t, lang, dir } = useI18n();
	const [session, setSession] = useState<CashSession | null>(null);
	const [report, setReport] = useState<SessionReport | null>(null);
	const [z, setZ] = useState<SessionReport | null>(null);
	const [tz, setTz] = useState<{ timeZone: string; cutoff: number } | null>(
		null,
	);
	const [float, setFloat] = useState("");
	const [kind, setKind] = useState<CashMovementKind>("pay_out");
	const [amount, setAmount] = useState("");
	const [reason, setReason] = useState("");
	const [counted, setCounted] = useState("");
	const [closing, setClosing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		const s = await openSession(db);
		setSession(s);
		setReport(s ? await sessionReport(db, s.id) : null);
	}, [db]);

	useEffect(() => {
		void reload();
		void loadMenu(db).then(
			(m) =>
				m &&
				setTz({
					timeZone: m.location.timezone,
					cutoff: m.location.dayCutoffMinutes,
				}),
		);
	}, [db, reload]);

	function printReport(r: SessionReport) {
		void print
			.print(
				"receipt",
				sessionReportTicket(
					r,
					reportLabels(lang, r.session.closedAt !== null),
					{
						deviceName: device.name,
						timeZone: tz?.timeZone ?? "UTC",
						dir,
					},
				),
			)
			.then((res) => {
				const bad = res.find((x) => !x.ok);
				if (bad && !bad.ok)
					setError(t("pay.printFailed", { error: bad.error }));
			});
	}

	async function start() {
		const f = parseAmount(float || "0");
		if (f === null || !tz) return setError(t("drawer.badAmount"));
		await openCashSession(db, {
			openingFloat: f,
			memberId: member.memberId,
			at: Date.now(),
			timeZone: tz.timeZone,
			dayCutoffMinutes: tz.cutoff,
		});
		sync.kick();
		setFloat("");
		await reload();
	}

	async function move() {
		if (!session) return;
		const a = parseAmount(amount);
		if (a === null || a <= 0) return setError(t("drawer.badAmount"));
		const res = await addCashMovement(db, {
			sessionId: session.id,
			kind,
			amount: a,
			reason,
			memberId: member.memberId,
		});
		if (!res.ok) return setError(t(`drawer.error.${res.error}` as MessageKey));
		sync.kick();
		setAmount("");
		setReason("");
		setError(null);
		await reload();
	}

	async function close() {
		if (!session) return;
		const c = parseAmount(counted);
		if (c === null) return setError(t("drawer.badAmount"));
		const res = await closeCashSession(db, {
			sessionId: session.id,
			countedCash: c,
			memberId: member.memberId,
			at: Date.now(),
		});
		sync.kick();
		setZ(res);
		printReport(res);
		await reload();
	}

	const shown = z ?? report;
	return (
		<div className="sheet-backdrop">
			<div className="sheet">
				<div className="row">
					<h2>{z ? t("report.z") : t("drawer.title")}</h2>
					<span className="spacer" />
					{shown && (
						<button type="button" onClick={() => printReport(shown)}>
							{t("drawer.print")}
						</button>
					)}
					<button type="button" onClick={props.onClose}>
						{t("settings.close")}
					</button>
				</div>
				{error && <p className="error">{error}</p>}

				{!session && !z && (
					<div className="stack">
						<p className="muted">{t("drawer.none")}</p>
						<label className="stack">
							<span>{t("drawer.float")}</span>
							<input
								className="field"
								inputMode="decimal"
								dir="ltr"
								value={float}
								placeholder="0.000"
								onChange={(e) => setFloat(e.target.value)}
							/>
						</label>
						<button type="button" className="primary big" onClick={start}>
							{t("drawer.start")}
						</button>
					</div>
				)}

				{shown && <ReportView r={shown} />}

				{session && !z && !closing && (
					<>
						<h3>{t("drawer.movement")}</h3>
						<div className="seg wide">
							{KINDS.map((k) => (
								<button
									type="button"
									key={k}
									className={kind === k ? "active" : ""}
									onClick={() => setKind(k)}
								>
									{t(`drawer.${k}`)}
								</button>
							))}
						</div>
						<div className="row">
							<input
								className="field"
								inputMode="decimal"
								dir="ltr"
								placeholder="0.000"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
							/>
							<input
								className="field grow"
								placeholder={t("orders.reason")}
								value={reason}
								maxLength={200}
								onChange={(e) => setReason(e.target.value)}
							/>
							<button
								type="button"
								disabled={!amount || !reason.trim()}
								onClick={move}
							>
								{t("drawer.record")}
							</button>
						</div>
						<div className="row">
							<span className="spacer" />
							<button
								type="button"
								className="danger big"
								onClick={() => setClosing(true)}
							>
								{t("drawer.close")}
							</button>
						</div>
					</>
				)}

				{session && closing && !z && (
					<div className="stack">
						<p className="muted">{t("drawer.countHint")}</p>
						<label className="stack">
							<span>{t("drawer.counted")}</span>
							<input
								className="field"
								inputMode="decimal"
								dir="ltr"
								placeholder="0.000"
								value={counted}
								onChange={(e) => setCounted(e.target.value)}
							/>
						</label>
						<div className="row">
							<button type="button" onClick={() => setClosing(false)}>
								{t("till.cancel")}
							</button>
							<span className="spacer" />
							<button
								type="button"
								className="danger big"
								disabled={!counted}
								onClick={close}
							>
								{t("drawer.closeConfirm")}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function ReportView({ r }: { r: SessionReport }) {
	const { t, lang } = useI18n();
	const line = (label: string, v: number, strong = false) => (
		<div className={strong ? "row strong" : "row"}>
			<span>{label}</span>
			<span className="spacer" />
			<span>{fmt(v, lang)}</span>
		</div>
	);
	return (
		<div className="totals report">
			<div className="row muted">
				<span>{t("report.orders")}</span>
				<span className="spacer" />
				<span>{r.orders}</span>
			</div>
			{Object.entries(r.byMethod).map(([m, v]) =>
				v ? (
					<div key={m}>
						{line(
							`${methodLabel(lang, m as "cash")} ${t("report.sales")}`,
							v.sales,
						)}
						{v.refunds > 0 &&
							line(
								`${methodLabel(lang, m as "cash")} ${t("report.refunds")}`,
								-v.refunds,
							)}
					</div>
				) : null,
			)}
			<hr />
			{line(t("drawer.float"), r.session.openingFloat)}
			{r.carried !== 0 && line(t("drawer.carried"), r.carried)}
			{r.payIns > 0 && line(t("drawer.pay_in"), r.payIns)}
			{r.payOuts > 0 && line(t("drawer.pay_out"), -r.payOuts)}
			{r.drops > 0 && line(t("drawer.drop"), -r.drops)}
			{line(t("report.expected"), r.expectedCash, true)}
			{r.session.countedCash !== null &&
				line(t("drawer.counted"), r.session.countedCash)}
			{r.variance !== null && (
				<div className={r.variance === 0 ? "row strong" : "row strong error"}>
					<span>{t("report.variance")}</span>
					<span className="spacer" />
					<span>{fmt(r.variance, lang)}</span>
				</div>
			)}
			{r.unsynced > 0 && (
				<p className="muted small">
					{t("report.unsyncedHint", { count: r.unsynced })}
				</p>
			)}
		</div>
	);
}
