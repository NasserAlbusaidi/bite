import { formatDecimal, type Minor, splitEqually } from "@bite/core";
import { useState } from "react";
import type { CashSession } from "../domain/cash.js";
import type { TenderInput } from "../domain/sale.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { fmt, parseAmount } from "./money.js";
import { methodLabel } from "./receipts.js";

/** Quick cash buttons: exact, then the next round notes above the amount. */
export function quickCash(amount: number): number[] {
	const notes = [500, 1_000, 5_000, 10_000, 20_000, 50_000];
	const out = new Set<number>([amount]);
	// The next multiple of each note: 1.500 offers 2.000, not just 5.000.
	for (const n of notes) out.add(Math.ceil(amount / n) * n);
	return [...out].sort((a, b) => a - b).slice(0, 4);
}

const GUESTS = [2, 3, 4, 5] as const;

/**
 * Takes the money for one bill: `total` is what is owed right now (a new
 * sale's total, or the balance left on an existing order).
 *
 * One tender is the fast path. "Split bill" takes it in parts: equal shares
 * for N guests (core `splitEqually`, so the baisa add up) or any amount per
 * part, each part cash or card. Parts are held here and handed to `onCharge`
 * together once nothing is left, so a half-taken bill is never stored.
 */
export function PaySheet(props: {
	total: number;
	/** Shown beside the title: the ticket being paid, when it already has one. */
	ticket?: string;
	drawer: CashSession | null;
	/** Servers may take payment but not open a drawer (the server rejects cash.open). */
	canOpenDrawer: boolean;
	onOpenDrawer: (float: number) => Promise<void>;
	onCancel: () => void;
	onCharge: (tenders: TenderInput[]) => Promise<string | null | undefined>;
}) {
	const { t, lang } = useI18n();
	const [method, setMethod] = useState<"cash" | "card">("cash");
	const [tenderedText, setTenderedText] = useState("");
	const [floatText, setFloatText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [parts, setParts] = useState<(TenderInput & { key: number })[]>([]);
	const [splitting, setSplitting] = useState(false);
	/** Equal shares still to take, next one first. */
	const [shares, setShares] = useState<number[] | null>(null);
	const [guests, setGuests] = useState<number | null>(null);
	const [partText, setPartText] = useState("");
	/** Change owed on the part just taken: that guest is still standing there. */
	const [partChange, setPartChange] = useState<number | null>(null);

	const taken = parts.reduce((s, p) => s + p.amount, 0);
	const left = props.total - taken;
	const typed = parseAmount(partText);
	const partInvalid =
		partText.trim() !== "" && (typed === null || typed <= 0 || typed > left);
	const amount =
		typed !== null && typed > 0 && typed <= left
			? typed
			: Math.min(shares?.[0] ?? left, left);
	const isLast = amount === left;

	const tendered = parseAmount(tenderedText);
	const change =
		tendered !== null && tendered >= amount ? tendered - amount : null;

	async function take(tender: TenderInput) {
		setError(null);
		if (!isLast) {
			setParts([...parts, { ...tender, key: Date.now() }]);
			setShares(shares && shares.length > 1 ? shares.slice(1) : null);
			setPartText("");
			setTenderedText("");
			setPartChange(
				tender.tendered !== undefined && tender.tendered > tender.amount
					? tender.tendered - tender.amount
					: null,
			);
			return;
		}
		setBusy(true);
		const err = await props.onCharge([
			...parts.map(({ key: _key, ...p }) => p),
			tender,
		]);
		setBusy(false);
		if (err) setError(t("pay.failed", { error: err }));
	}

	function removePart(i: number) {
		setParts(parts.filter((_, j) => j !== i));
		// The plan no longer adds up; start the split again from what's left.
		setShares(null);
		setPartChange(null);
	}

	const needsDrawer = method === "cash" && !props.drawer;

	return (
		<div className="sheet-backdrop">
			<div className="sheet narrow pay">
				<div className="row">
					<h2>
						{t("pay.title")}
						{props.ticket && (
							<>
								{" "}
								<bdi dir="ltr" className="muted">
									{props.ticket}
								</bdi>
							</>
						)}
					</h2>
					<span className="spacer" />
					<span className="huge">{fmt(props.total, lang)}</span>
				</div>

				{parts.length > 0 && (
					<div className="pay-parts">
						{parts.map((p, i) => (
							<div className="row" key={p.key}>
								<span>
									{i + 1}. {methodLabel(lang, p.method)}
								</span>
								<span className="spacer" />
								<span className="amount">{fmt(p.amount, lang)}</span>
								<button
									type="button"
									className="icon-btn"
									disabled={busy}
									aria-label={t("pay.removePart")}
									onClick={() => removePart(i)}
								>
									×
								</button>
							</div>
						))}
						<div className="row strong">
							<span>{t("pay.left")}</span>
							<span className="spacer" />
							<span className="amount">{fmt(left, lang)}</span>
						</div>
					</div>
				)}
				{partChange !== null && (
					<p className="notice">
						{t("pay.change", { amount: fmt(partChange, lang) })}
					</p>
				)}

				{!splitting && parts.length === 0 ? (
					<button
						type="button"
						className="link"
						onClick={() => setSplitting(true)}
					>
						{t("pay.splitBill")}
					</button>
				) : (
					<div className="stack pay-split">
						<div className="stack pay-split__shares">
							<span>{t("pay.splitEqual")}</span>
							<div className="chips">
								{GUESTS.map((n) => (
									<button
										type="button"
										key={n}
										className={shares && guests === n ? "chip active" : "chip"}
										disabled={busy || left < n}
										onClick={() => {
											setShares(splitEqually(left as Minor, n));
											setGuests(n);
											setPartText("");
										}}
									>
										<bdi dir="ltr">÷ {n}</bdi>
									</button>
								))}
							</div>
						</div>
						<label>
							{t("pay.partAmount")}
							<input
								dir="ltr"
								inputMode="decimal"
								placeholder={formatDecimal(amount as Minor)}
								value={partText}
								onChange={(e) => {
									setPartText(e.target.value);
									setShares(null);
								}}
							/>
						</label>
						{partInvalid && (
							<p className="error">
								{t("orders.amountMax", { amount: fmt(left, lang) })}
							</p>
						)}
						{!isLast && (
							<p className="strong">
								{t("pay.thisPart", { amount: fmt(amount, lang) })}
							</p>
						)}
					</div>
				)}

				<div className="seg wide">
					<button
						type="button"
						className={method === "cash" ? "active" : ""}
						onClick={() => setMethod("cash")}
					>
						{t("pay.cash")}
					</button>
					<button
						type="button"
						className={method === "card" ? "active" : ""}
						onClick={() => setMethod("card")}
					>
						{t("pay.card")}
					</button>
				</div>

				{needsDrawer && !props.canOpenDrawer && (
					<p className="muted">{t("drawer.askCashier")}</p>
				)}

				{needsDrawer && props.canOpenDrawer && (
					<div className="stack">
						<h3>{t("drawer.open")}</h3>
						<label>
							{t("drawer.float")}
							<input
								dir="ltr"
								inputMode="decimal"
								placeholder="20.000"
								value={floatText}
								onChange={(e) => setFloatText(e.target.value)}
							/>
						</label>
						<button
							type="button"
							className="primary"
							disabled={parseAmount(floatText) === null}
							onClick={() => props.onOpenDrawer(parseAmount(floatText) ?? 0)}
						>
							{t("drawer.start")}
						</button>
					</div>
				)}

				{method === "cash" && !needsDrawer && (
					<div className="stack">
						<div className="chips">
							{quickCash(amount).map((a) => (
								<button
									type="button"
									key={a}
									className="chip"
									disabled={busy || partInvalid}
									onClick={() =>
										take({
											method: "cash",
											amount: amount as Minor,
											tendered: a as Minor,
										})
									}
								>
									{a === amount ? t("pay.exact") : fmt(a, lang)}
								</button>
							))}
						</div>
						<label>
							{t("pay.tendered")}
							<input
								dir="ltr"
								inputMode="decimal"
								value={tenderedText}
								onChange={(e) => setTenderedText(e.target.value)}
							/>
						</label>
						{change !== null && (
							<p className="huge">
								{t("pay.change", { amount: fmt(change, lang) })}
							</p>
						)}
					</div>
				)}

				{error && <p className="error">{error}</p>}
				<div className="row pay-actions">
					<button type="button" onClick={props.onCancel} disabled={busy}>
						{t("till.cancel")}
					</button>
					{method === "cash" && !needsDrawer && (
						<button
							type="button"
							className="primary big grow"
							disabled={
								busy || partInvalid || change === null || tendered === null
							}
							onClick={() =>
								tendered !== null &&
								take({
									method: "cash",
									amount: amount as Minor,
									tendered: tendered as Minor,
								})
							}
						>
							{t("pay.confirm")}
						</button>
					)}
					{method === "card" && (
						<button
							type="button"
							className="primary big grow"
							disabled={busy || partInvalid}
							onClick={() => take({ method: "card", amount: amount as Minor })}
						>
							{t("pay.confirm")} · {fmt(amount, lang)}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
