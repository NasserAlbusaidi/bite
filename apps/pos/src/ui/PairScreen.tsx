import {
	CONNECT_CODE_LENGTH,
	type DeviceMe,
	formatConnectCode,
	normalizeConnectCode,
	parsePairingCode,
} from "@bite/contracts";
import { useState } from "react";
import {
	ApiClient,
	type ApiConfig,
	defaultServerUrl,
	pairWithCode,
} from "../api/client.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { SyncHttpError } from "../sync/transport.js";
import { QrScanner } from "./QrScanner.js";

type PairError =
	| "pair.wrongCode"
	| "pair.tooMany"
	| "pair.offline"
	| "pair.noCamera"
	| "pair.badQr";

/** What to tell someone whose code didn't go through, in plain words. */
export function pairError(err: unknown): PairError {
	if (err instanceof SyncHttpError) {
		if (err.status === 404 || err.status === 401) return "pair.wrongCode";
		if (err.status === 429) return "pair.tooMany";
	}
	// Network down, DNS, a proxy's 502: all "can't reach Bite" to a person.
	return "pair.offline";
}

/**
 * First screen on a new tablet. Someone types the 8-character code the back
 * office shows (or scans its QR) and the tablet is connected: no server
 * address, no token. Those two are still under "Advanced settings" for
 * support and self-hosting.
 */
export function PairScreen(props: {
	onPaired: (cfg: ApiConfig, device: DeviceMe) => void;
}) {
	const { t, lang, setLang } = useI18n();
	const [server, setServer] = useState(defaultServerUrl);
	const [typed, setTyped] = useState("");
	const [token, setToken] = useState("");
	const [scanning, setScanning] = useState(false);
	const [busy, setBusy] = useState(false);
	// A key, not text, so switching language re-words a showing error.
	const [error, setError] = useState<PairError | null>(null);

	async function connect(baseUrl: string, code: string) {
		setBusy(true);
		setError(null);
		try {
			const { cfg, device } = await pairWithCode(baseUrl, code);
			props.onPaired(cfg, device);
		} catch (err) {
			setError(pairError(err));
		} finally {
			setBusy(false);
		}
	}

	async function connectWithToken(cfg: ApiConfig) {
		setBusy(true);
		setError(null);
		try {
			props.onPaired(cfg, await new ApiClient(cfg).me());
		} catch (err) {
			setError(pairError(err));
		} finally {
			setBusy(false);
		}
	}

	/** A scanned or pasted QR payload. True when it was one of ours. */
	function tryQr(text: string): boolean {
		const p = parsePairingCode(text);
		if (!p) return false;
		setScanning(false);
		setServer(p.serverUrl);
		if ("code" in p) {
			setTyped(formatConnectCode(p.code));
			void connect(p.serverUrl, p.code);
		} else
			void connectWithToken({ baseUrl: p.serverUrl, deviceToken: p.token });
		return true;
	}

	function onType(raw: string) {
		setError(null);
		if (raw.trim().startsWith("bitepair:")) {
			if (!tryQr(raw)) setError("pair.badQr");
			return;
		}
		// Letters and digits only, shown as XXXX-XXXX while typing.
		const clean = raw
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "")
			.slice(0, CONNECT_CODE_LENGTH);
		setTyped(formatConnectCode(clean));
		const code = normalizeConnectCode(clean);
		// The last letter goes straight in: no button to find.
		if (code && !busy) void connect(server, code);
	}

	const code = normalizeConnectCode(typed);

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

				{scanning ? (
					<>
						<QrScanner
							label={t("pair.scan")}
							accept={tryQr}
							onUnavailable={() => {
								setScanning(false);
								setError("pair.noCamera");
							}}
						/>
						<button type="button" onClick={() => setScanning(false)}>
							{t("till.cancel")}
						</button>
					</>
				) : (
					<>
						<ol className="pair-steps">
							<li>{t("pair.step1")}</li>
							<li>{t("pair.step2")}</li>
							<li>{t("pair.step3")}</li>
						</ol>
						<form
							className="stack"
							onSubmit={(e) => {
								e.preventDefault();
								if (code) void connect(server, code);
							}}
						>
							<label className="pair-code">
								<span className="sr-only">{t("pair.codeLabel")}</span>
								<input
									className="pair-code__input"
									dir="ltr"
									value={typed}
									onChange={(e) => onType(e.target.value)}
									placeholder="XXXX-XXXX"
									autoComplete="off"
									autoCapitalize="characters"
									autoCorrect="off"
									spellCheck={false}
									enterKeyHint="go"
									aria-label={t("pair.codeLabel")}
									aria-invalid={error ? true : undefined}
									disabled={busy}
									// biome-ignore lint/a11y/noAutofocus: the only thing to do on this screen
									autoFocus
								/>
							</label>
							<button
								type="submit"
								className="primary big"
								disabled={busy || !code}
							>
								{busy ? t("pair.connecting") : t("pair.connect")}
							</button>
						</form>
					</>
				)}

				{error && (
					<p className="pair-error" role="alert">
						{t(error)}
					</p>
				)}

				{!scanning && (
					<>
						<p className="pair-or muted">{t("pair.or")}</p>
						<button
							type="button"
							className="big"
							disabled={busy}
							onClick={() => {
								setError(null);
								setScanning(true);
							}}
						>
							{t("pair.scan")}
						</button>
						<details className="pair-advanced">
							<summary>{t("pair.advanced")}</summary>
							<form
								className="stack"
								onSubmit={(e) => {
									e.preventDefault();
									void connectWithToken({
										baseUrl: server.trim(),
										deviceToken: token.trim(),
									});
								}}
							>
								<label>
									{t("pair.server")}
									<input
										dir="ltr"
										inputMode="url"
										value={server}
										onChange={(e) => setServer(e.target.value)}
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
								<button type="submit" disabled={busy}>
									{t("pair.submit")}
								</button>
							</form>
						</details>
					</>
				)}
			</div>
		</div>
	);
}
