import { type DeviceMe, parsePairingCode } from "@bite/contracts";
import { useState } from "react";
import { ApiClient, type ApiConfig } from "../api/client.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { QrScanner } from "./QrScanner.js";

/**
 * Pair this tablet with a location. The back office shows a pairing code
 * (API address + device token) as a QR: scan it, or paste it. Typing the two
 * values by hand is still there for when neither works.
 */
export function PairScreen(props: {
	onPaired: (cfg: ApiConfig, device: DeviceMe) => void;
}) {
	const { t, lang, setLang } = useI18n();
	const [baseUrl, setBaseUrl] = useState("");
	const [token, setToken] = useState("");
	const [code, setCode] = useState("");
	const [scanning, setScanning] = useState(false);
	const [manual, setManual] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function pair(cfg: ApiConfig) {
		setBusy(true);
		setError(null);
		try {
			const me = await new ApiClient(cfg).me();
			props.onPaired(cfg, me);
		} catch (err) {
			// Show what was tried, so a wrong address can be fixed by hand.
			setBaseUrl(cfg.baseUrl);
			setToken(cfg.deviceToken);
			setManual(true);
			setError(
				t("pair.failed", {
					error: err instanceof Error ? err.message : String(err),
				}),
			);
		} finally {
			setBusy(false);
		}
	}

	/** True when the text was a pairing code (and pairing has started). */
	function tryCode(text: string): boolean {
		const p = parsePairingCode(text);
		if (!p) return false;
		setScanning(false);
		void pair({ baseUrl: p.serverUrl, deviceToken: p.token });
		return true;
	}

	return (
		<div className="center-screen">
			<div className="card narrow pair">
				<div className="row">
					<h1>{t("pair.title")}</h1>
					<span className="spacer" />
					<button
						type="button"
						onClick={() => setLang(lang === "en" ? "ar" : "en")}
					>
						{t("lang.toggle")}
					</button>
				</div>
				<p className="muted">{t("pair.hint")}</p>

				{scanning ? (
					<>
						<QrScanner
							label={t("pair.scan")}
							accept={tryCode}
							onUnavailable={() => {
								setScanning(false);
								setError(t("pair.noCamera"));
							}}
						/>
						<button type="button" onClick={() => setScanning(false)}>
							{t("till.cancel")}
						</button>
					</>
				) : (
					<button
						type="button"
						className="primary big"
						disabled={busy}
						onClick={() => {
							setError(null);
							setScanning(true);
						}}
					>
						{t("pair.scan")}
					</button>
				)}

				{!scanning && (
					<label>
						{t("pair.paste")}
						<input
							dir="ltr"
							value={code}
							autoComplete="off"
							autoCapitalize="off"
							spellCheck={false}
							placeholder="bitepair:…"
							disabled={busy}
							onChange={(e) => {
								const v = e.target.value;
								setCode(v);
								if (v.trim() && !tryCode(v) && v.trim().length > 20)
									setError(t("pair.badCode"));
								else setError(null);
							}}
						/>
					</label>
				)}

				{error && <p className="error">{error}</p>}

				{!scanning && !manual && (
					<button
						type="button"
						className="link"
						onClick={() => setManual(true)}
					>
						{t("pair.manual")}
					</button>
				)}
				{!scanning && manual && (
					<form
						className="stack"
						onSubmit={(e) => {
							e.preventDefault();
							void pair({
								baseUrl: baseUrl.trim(),
								deviceToken: token.trim(),
							});
						}}
					>
						<label>
							{t("pair.server")}
							<input
								dir="ltr"
								inputMode="url"
								placeholder="https://api.example.com"
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								required
							/>
						</label>
						<label>
							{t("pair.token")}
							<input
								dir="ltr"
								value={token}
								onChange={(e) => setToken(e.target.value)}
								required
								autoComplete="off"
							/>
						</label>
						<button type="submit" className="primary" disabled={busy}>
							{t("pair.submit")}
						</button>
					</form>
				)}
			</div>
		</div>
	);
}
