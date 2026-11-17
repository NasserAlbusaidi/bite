import type { Minor } from "@bite/core";
import { useState } from "react";
import type { CashSession } from "../domain/cash.js";
import type { TenderInput } from "../domain/sale.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { fmt, parseAmount } from "./money.js";

/** Quick cash buttons: exact, then the next round notes above the total. */
function quickCash(total: number): number[] {
	const notes = [1_000, 5_000, 10_000, 20_000, 50_000];
	const out = new Set<number>([total]);
	for (const n of notes) if (n > total) out.add(Math.ceil(total / n) * n);
	return [...out].slice(0, 4);
}

export function PaySheet(props: {
	total: number;
	drawer: CashSession | null;
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

	const tendered = parseAmount(tenderedText);
	const change =
		tendered !== null && tendered >= props.total
			? tendered - props.total
			: null;

	async function go(tenders: TenderInput[]) {
		setBusy(true);
		setError(null);
		const err = await props.onCharge(tenders);
		setBusy(false);
		if (err) setError(t("pay.failed", { error: err }));
	}

	const needsDrawer = method === "cash" && !props.drawer;

	return (
		<div className="sheet-backdrop">
			<div className="sheet narrow">
				<div className="row">
					<h2>{t("pay.title")}</h2>
					<span className="spacer" />
					<span className="huge">{fmt(props.total, lang)}</span>
				</div>
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

				{needsDrawer && (
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
							{quickCash(props.total).map((a) => (
								<button
									type="button"
									key={a}
									className="chip"
									disabled={busy}
									onClick={() =>
										go([
											{
												method: "cash",
												amount: props.total as Minor,
												tendered: a as Minor,
											},
										])
									}
								>
									{a === props.total ? t("pay.exact") : fmt(a, lang)}
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
						<button
							type="button"
							className="primary big"
							disabled={busy || change === null || tendered === null}
							onClick={() =>
								tendered !== null &&
								go([
									{
										method: "cash",
										amount: props.total as Minor,
										tendered: tendered as Minor,
									},
								])
							}
						>
							{t("pay.confirm")}
						</button>
					</div>
				)}

				{method === "card" && (
					<button
						type="button"
						className="primary big"
						disabled={busy}
						onClick={() =>
							go([{ method: "card", amount: props.total as Minor }])
						}
					>
						{t("pay.confirm")} · {fmt(props.total, lang)}
					</button>
				)}

				{error && <p className="error">{error}</p>}
				<button type="button" onClick={props.onCancel} disabled={busy}>
					{t("till.cancel")}
				</button>
			</div>
		</div>
	);
}
