import { useEffect, useState } from "react";
import { listCachedStaff, type StaffMember } from "../auth/staff.js";
import { useI18n } from "../i18n/I18nProvider.js";
import { loginError, loginWithPin } from "./login.js";
import { PinPad } from "./PinPad.js";
import { useServices } from "./services.js";

/**
 * A manager steps up and types their PIN. The approved action is queued
 * under the manager's id, because the server checks the role of whoever is
 * named on the mutation, not who is logged in to the till.
 */
export function ManagerApproval(props: {
	what: string;
	onApproved: (manager: StaffMember) => void;
	onCancel: () => void;
}) {
	const { db, api } = useServices();
	const { t } = useI18n();
	const [managers, setManagers] = useState<StaffMember[]>([]);
	const [who, setWho] = useState<StaffMember | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void listCachedStaff(db).then((s) =>
			setManagers(s.filter((m) => m.role === "manager")),
		);
	}, [db]);

	async function submit(pin: string) {
		if (!who) return;
		setBusy(true);
		const res = await loginWithPin(db, api, who.memberId, pin);
		setBusy(false);
		if (!res.ok) return setError(loginError(t, res, who.displayName));
		if (res.member.role !== "manager") return setError(t("approve.notManager"));
		props.onApproved(res.member);
	}

	return (
		<div className="sheet-backdrop">
			<div className="sheet narrow">
				<h2>{t("approve.title")}</h2>
				<p className="muted">{props.what}</p>
				{!who && (
					<div className="staff-grid">
						{managers.length === 0 && (
							<p className="muted">{t("approve.noManagers")}</p>
						)}
						{managers.map((m) => (
							<button
								type="button"
								key={m.memberId}
								className="tile"
								onClick={() => setWho(m)}
							>
								<span className="tile-title">{m.displayName}</span>
							</button>
						))}
					</div>
				)}
				{who && (
					<>
						<p>{t("lock.pin", { name: who.displayName })}</p>
						<PinPad
							busy={busy}
							error={error}
							onType={() => setError(null)}
							onSubmit={submit}
							onBack={() => setWho(null)}
						/>
					</>
				)}
				<div className="row">
					<span className="spacer" />
					<button type="button" onClick={props.onCancel}>
						{t("till.cancel")}
					</button>
				</div>
			</div>
		</div>
	);
}

/** Run `fn` as the logged-in member if they are a manager, otherwise ask one to approve. */
export function useManagerGate() {
	const { member } = useServices();
	const [pending, setPending] = useState<{
		what: string;
		run: (managerId: string) => void;
	} | null>(null);
	const gate = (what: string, run: (managerId: string) => void) =>
		member.role === "manager"
			? run(member.memberId)
			: setPending({ what, run });
	const sheet = pending ? (
		<ManagerApproval
			what={pending.what}
			onCancel={() => setPending(null)}
			onApproved={(m) => {
				setPending(null);
				pending.run(m.memberId);
			}}
		/>
	) : null;
	return { gate, sheet };
}
