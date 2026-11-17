import { useState } from "react";
import { newId } from "../domain/ids.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { ticketLabels } from "../print/labels.js";
import type { PrinterConfig, PrinterRole } from "../print/printers.js";
import { kitchenTicket } from "../print/ticket.js";
import { savePrinters } from "./printing.js";
import { useServices } from "./services.js";

export function SettingsSheet(props: {
	holder: { printers: PrinterConfig[] };
	onClose: () => void;
	onUnpair: () => void;
}) {
	const { db, print } = useServices();
	const { t, lang } = useI18n();
	const [printers, setPrinters] = useState(props.holder.printers);
	const [draft, setDraft] = useState({
		name: "",
		host: "",
		wide: true,
		roles: ["receipt"] as PrinterRole[],
	});
	const [status, setStatus] = useState<string | null>(null);

	async function persist(next: PrinterConfig[]) {
		setPrinters(next);
		props.holder.printers = next;
		await savePrinters(db, next);
	}

	function toggleRole(r: PrinterRole) {
		setDraft((d) => ({
			...d,
			roles: d.roles.includes(r)
				? d.roles.filter((x) => x !== r)
				: [...d.roles, r],
		}));
	}

	async function test(p: PrinterConfig) {
		const res = await print.printTo(
			p,
			kitchenTicket(
				{
					ticketNumber: "TEST",
					type: "takeaway",
					placedAt: new Date(),
					timeZone: "Asia/Muscat",
					lines: [
						{ quantity: 1, name: p.name, modifiers: [], lineTotal: 0 as never },
					],
				},
				ticketLabels(lang),
				lang === "ar" ? "rtl" : "ltr",
			),
		);
		setStatus(res.ok ? "OK" : res.error);
	}

	return (
		<div className="sheet-backdrop">
			<div className="sheet">
				<div className="row">
					<h2>{t("settings.title")}</h2>
					<span className="spacer" />
					<button type="button" onClick={props.onClose}>
						{t("settings.close")}
					</button>
				</div>
				<h3>{t("settings.printers")}</h3>
				{printers.map((p) => (
					<div key={p.id} className="row line">
						<span>
							<strong>{p.name}</strong>{" "}
							<span className="muted" dir="ltr">
								{p.transport.type === "tcp"
									? `${p.transport.host}:${p.transport.port}`
									: p.transport.type}
							</span>{" "}
							<span className="muted">
								{p.roles
									.map((r) =>
										r === "receipt"
											? t("settings.roleReceipt")
											: t("settings.roleKitchen"),
									)
									.join(", ")}
							</span>
						</span>
						<span className="spacer" />
						<button type="button" onClick={() => test(p)}>
							{t("settings.test")}
						</button>
						<button
							type="button"
							onClick={() => persist(printers.filter((x) => x.id !== p.id))}
						>
							{t("settings.remove")}
						</button>
					</div>
				))}
				{status && <p className="muted">{status}</p>}
				<form
					className="stack"
					onSubmit={(e) => {
						e.preventDefault();
						if (!draft.host || draft.roles.length === 0) return;
						void persist([
							...printers,
							{
								id: newId(),
								name: draft.name || draft.host,
								roles: draft.roles,
								columns: draft.wide ? 48 : 32,
								dots: draft.wide ? 576 : 384,
								mode: "auto",
								transport: { type: "tcp", host: draft.host.trim(), port: 9100 },
							},
						]);
						setDraft({ name: "", host: "", wide: true, roles: ["receipt"] });
					}}
				>
					<h4>{t("settings.addPrinter")}</h4>
					<div className="row">
						<input
							placeholder={t("settings.printerName")}
							value={draft.name}
							onChange={(e) => setDraft({ ...draft, name: e.target.value })}
						/>
						<input
							dir="ltr"
							inputMode="decimal"
							placeholder="192.168.1.50"
							value={draft.host}
							onChange={(e) => setDraft({ ...draft, host: e.target.value })}
						/>
						<select
							value={draft.wide ? "80" : "58"}
							onChange={(e) =>
								setDraft({ ...draft, wide: e.target.value === "80" })
							}
						>
							<option value="80">80mm</option>
							<option value="58">58mm</option>
						</select>
					</div>
					<div className="row">
						<label className="check">
							<input
								type="checkbox"
								checked={draft.roles.includes("receipt")}
								onChange={() => toggleRole("receipt")}
							/>
							{t("settings.roleReceipt")}
						</label>
						<label className="check">
							<input
								type="checkbox"
								checked={draft.roles.includes("kitchen")}
								onChange={() => toggleRole("kitchen")}
							/>
							{t("settings.roleKitchen")}
						</label>
						<span className="spacer" />
						<button type="submit" className="primary">
							{t("settings.save")}
						</button>
					</div>
				</form>
				<hr />
				<button type="button" className="danger" onClick={props.onUnpair}>
					{t("settings.unpair")}
				</button>
			</div>
		</div>
	);
}
