import { Icon } from "@bite/ui";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { Lang, T } from "../lib/i18n";
import type { ServiceActionResult } from "../routes/service";

/** After a call, the same button rests this long before it can ring again. */
const COOLDOWN_MS = 45_000;

type Kind = "waiter" | "bill";

/**
 * "Call a waiter" and "Bring the bill" for a guest who scanned a table QR.
 * The till shows the call until staff mark it done.
 */
export function ServiceBar({
	lang,
	slug,
	table,
	t,
}: {
	lang: Lang;
	slug: string;
	table: string;
	t: T;
}) {
	const fetcher = useFetcher<ServiceActionResult>();
	const [sent, setSent] = useState<{ kind: Kind; until: number } | null>(null);
	const busy = fetcher.state !== "idle";
	const pending = busy ? (fetcher.formData?.get("kind") as Kind | null) : null;

	useEffect(() => {
		const d = fetcher.data;
		if (d?.ok && fetcher.state === "idle") {
			setSent({ kind: d.kind, until: Date.now() + COOLDOWN_MS });
			navigator.vibrate?.(40);
		}
	}, [fetcher.data, fetcher.state]);

	useEffect(() => {
		if (!sent) return;
		const id = setTimeout(() => setSent(null), sent.until - Date.now());
		return () => clearTimeout(id);
	}, [sent]);

	const call = (kind: Kind) =>
		fetcher.submit(
			{ kind, table },
			{ method: "post", action: `/${lang}/${slug}/service` },
		);

	const button = (kind: Kind) => {
		const done = sent?.kind === kind;
		return (
			<button
				type="button"
				className={`service__btn${done ? " is-sent" : ""}`}
				disabled={busy || done}
				onClick={() => call(kind)}
				aria-busy={pending === kind || undefined}
			>
				<Icon name={done ? "check" : kind === "waiter" ? "users" : "receipt"} />
				<span>
					{t(
						done
							? kind === "waiter"
								? "service_waiter_sent"
								: "service_bill_sent"
							: kind === "waiter"
								? "service_waiter"
								: "service_bill",
					)}
				</span>
			</button>
		);
	};

	return (
		<section className="service" aria-label={t("service_title")}>
			{button("waiter")}
			{button("bill")}
			{fetcher.data && !fetcher.data.ok && fetcher.state === "idle" && (
				<p className="error small" role="alert">
					{t("service_error")}
				</p>
			)}
			<p className="bite-sr-only" aria-live="polite">
				{sent
					? t(
							sent.kind === "waiter"
								? "service_waiter_sent"
								: "service_bill_sent",
						)
					: ""}
			</p>
		</section>
	);
}
