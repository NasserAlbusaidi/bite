import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.js";
import type { MessageKey } from "../i18n/messages.js";
import {
	dismissProblem,
	listProblems,
	type ProblemGroup,
	retryProblem,
} from "../sync/problems.js";
import { useManagerGate } from "./ManagerApproval.js";
import { useServices } from "./services.js";

/**
 * Changes the server refused. Nothing here is dropped silently: a refusal
 * stays until someone re-sends it (conflicts only) or a manager sets it
 * aside after fixing things by hand.
 */
export function ProblemsSheet(props: { onClose: () => void }) {
	const { db, sync } = useServices();
	const { t } = useI18n();
	const [groups, setGroups] = useState<ProblemGroup[]>([]);
	const [error, setError] = useState<string | null>(null);
	const { gate, sheet } = useManagerGate();

	const reload = useCallback(
		async () => setGroups(await listProblems(db)),
		[db],
	);
	useEffect(() => {
		void reload();
		const off = sync.subscribe(() => void reload());
		return () => {
			off();
		};
	}, [reload, sync]);

	return (
		<div className="sheet-backdrop">
			<div className="sheet">
				<div className="row">
					<h2>{t("problems.title")}</h2>
					<span className="spacer" />
					<button type="button" onClick={props.onClose}>
						{t("settings.close")}
					</button>
				</div>
				{error && <p className="error">{error}</p>}
				{groups.length === 0 && <p className="muted">{t("problems.none")}</p>}
				{groups.map((g) => (
					<div key={g.entityId} className="problem">
						<div className="row">
							<strong dir="ltr">
								{g.ticketNumber ?? t(kindLabel(g.items[0]?.kind))}
							</strong>
							<span className="spacer" />
							{g.retryable && (
								<button
									type="button"
									className="primary"
									onClick={async () => {
										const r = await retryProblem(db, g.entityId);
										if (!r.ok) setError(r.error);
										sync.kick();
										await reload();
									}}
								>
									{t("problems.retry")}
								</button>
							)}
							<button
								type="button"
								onClick={() =>
									gate(t("problems.approveDismiss"), async () => {
										await dismissProblem(db, g.entityId);
										sync.kick();
										await reload();
									})
								}
							>
								{t("problems.dismiss")}
							</button>
						</div>
						<ul>
							{g.items.map((i) => (
								<li key={i.id}>
									<span className={i.reason === "blocked" ? "muted" : "error"}>
										{t(kindLabel(i.kind))} · {t(`problems.${i.reason}`)}
									</span>
									{i.result?.error && (
										<div className="small">
											{i.result.error.message} ({i.result.error.code})
										</div>
									)}
								</li>
							))}
						</ul>
						<p className="muted small">
							{t(
								g.retryable ? "problems.hintConflict" : "problems.hintRejected",
							)}
						</p>
					</div>
				))}
			</div>
			{sheet}
		</div>
	);
}

function kindLabel(kind: string | undefined): MessageKey {
	return `problems.kind.${kind ?? "order.create"}` as MessageKey;
}
