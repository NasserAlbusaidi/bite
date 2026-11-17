import type { DeviceMe } from "@bite/contracts";
import { useState } from "react";
import { ApiClient, type ApiConfig } from "../api/client.js";
import { useI18n } from "../i18n/I18nProvider.js";

export function PairScreen(props: {
	onPaired: (cfg: ApiConfig, device: DeviceMe) => void;
}) {
	const { t, lang, setLang } = useI18n();
	const [baseUrl, setBaseUrl] = useState("");
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const cfg = { baseUrl: baseUrl.trim(), deviceToken: token.trim() };
		try {
			const me = await new ApiClient(cfg).me();
			props.onPaired(cfg, me);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="center-screen">
			<form className="card narrow" onSubmit={submit}>
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
				{error && <p className="error">{t("pair.failed", { error })}</p>}
				<button type="submit" className="primary" disabled={busy}>
					{t("pair.submit")}
				</button>
			</form>
		</div>
	);
}
