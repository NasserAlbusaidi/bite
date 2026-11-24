import type { FulfillmentStatus, Order } from "@bite/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { kitchenOrders, moveTicket, nextStatus } from "../domain/kitchen.js";
import { useI18n } from "../i18n/I18nProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import { useServices } from "./services.js";

const COLUMNS: {
	status: FulfillmentStatus;
	title: MessageKey;
	action: MessageKey;
}[] = [
	{ status: "pending", title: "kds.new", action: "kds.start" },
	{ status: "preparing", title: "kds.preparing", action: "kds.done" },
	{ status: "ready", title: "kds.ready", action: "kds.collected" },
];

/** Short two-tone chime via WebAudio: no asset, works offline. */
function chime() {
	try {
		const ctx = new AudioContext();
		for (const [i, f] of [880, 1320].entries()) {
			const o = ctx.createOscillator();
			const g = ctx.createGain();
			o.frequency.value = f;
			g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
			g.gain.exponentialRampToValueAtTime(
				0.001,
				ctx.currentTime + i * 0.18 + 0.35,
			);
			o.connect(g).connect(ctx.destination);
			o.start(ctx.currentTime + i * 0.18);
			o.stop(ctx.currentTime + i * 0.18 + 0.4);
		}
	} catch {
		// no audio (tests, locked autoplay)
	}
}

export function KdsShell() {
	const { db, sync, member } = useServices();
	const { t, lang } = useI18n();
	const [orders, setOrders] = useState<Order[]>([]);
	const [now, setNow] = useState(Date.now());
	const [sound, setSound] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const seen = useRef<Set<string> | null>(null);

	const reload = useCallback(async () => {
		const list = await kitchenOrders(db);
		const ids = new Set(
			list.filter((o) => o.fulfillmentStatus === "pending").map((o) => o.id),
		);
		if (seen.current && sound && [...ids].some((id) => !seen.current?.has(id)))
			chime();
		seen.current = new Set([...(seen.current ?? []), ...ids]);
		setOrders(list);
	}, [db, sound]);

	useEffect(() => {
		void reload();
		const off = sync.onOrdersChanged(() => void reload());
		const tick = setInterval(() => setNow(Date.now()), 15_000);
		return () => {
			off();
			clearInterval(tick);
		};
	}, [sync, reload]);

	async function move(o: Order, to: FulfillmentStatus) {
		const res = await moveTicket(db, {
			orderId: o.id,
			to,
			memberId: member.memberId,
		});
		if (!res.ok)
			setError(t("kds.failed", { ticket: o.ticketNumber, error: res.error }));
		else setError(null);
		await reload();
		sync.kick();
	}

	const name = (x: { en: string; ar?: string | undefined }) =>
		(lang === "ar" && x.ar) || x.en;

	return (
		<div className="kds">
			<div className="kds-bar">
				{error && <span className="error">{error}</span>}
				<span className="spacer" />
				<button type="button" onClick={() => setSound(!sound)}>
					{sound ? t("kds.sound") : t("kds.soundOff")}
				</button>
			</div>
			<div className="kds-cols">
				{COLUMNS.map((col) => {
					const list = orders.filter((o) => o.fulfillmentStatus === col.status);
					return (
						<section key={col.status} className={`kds-col kds-${col.status}`}>
							<h2>
								{t(col.title)} <span className="muted">{list.length}</span>
							</h2>
							{list.map((o) => {
								const mins = Math.max(
									0,
									Math.floor((now - Date.parse(o.placedAt)) / 60_000),
								);
								const late =
									col.status !== "ready" && mins >= 15
										? "late"
										: mins >= 8 && col.status !== "ready"
											? "warn"
											: "";
								const next = nextStatus(o.fulfillmentStatus);
								return (
									<article key={o.id} className={`ticket ${late}`}>
										<header className="row">
											<strong className="ticket-no">{o.ticketNumber}</strong>
											{o.tableLabel ? (
												<span className="table-tag">
													{t("order.tableNo", { table: o.tableLabel })}
												</span>
											) : (
												<span className="muted">
													{o.type === "dine_in"
														? t("order.dineIn")
														: t("order.takeaway")}
												</span>
											)}
											<span className="spacer" />
											<span className="age">
												{t("kds.minutes", { count: mins })}
											</span>
										</header>
										{o.customerName && (
											<div className="muted">{o.customerName}</div>
										)}
										<ul>
											{o.lines
												.filter((l) => !l.voidedAt)
												.map((l) => (
													<li key={l.id}>
														<strong>{l.quantity}×</strong> {name(l.name)}
														{l.modifiers.map((m) => (
															<div key={m.optionId} className="mod">
																+ {name(m.name)}
															</div>
														))}
														{l.note && <div className="note">‼ {l.note}</div>}
													</li>
												))}
										</ul>
										{o.note && <div className="note">‼ {o.note}</div>}
										<div className="row">
											{col.status === "ready" && (
												<button
													type="button"
													onClick={() => move(o, "preparing")}
												>
													{t("kds.recall")}
												</button>
											)}
											<span className="spacer" />
											{next && (
												<button
													type="button"
													className="primary big"
													onClick={() => move(o, next)}
												>
													{t(col.action)}
												</button>
											)}
										</div>
									</article>
								);
							})}
						</section>
					);
				})}
			</div>
		</div>
	);
}
