import { encodePairingCode, formatConnectCode } from "@bite/contracts";
import { Badge, Dialog, Icon, Sheet, Spinner, useToast } from "@bite/ui";
import { useEffect, useState } from "react";
import { data, Link, useFetcher, useRevalidator } from "react-router";
import { QrCode } from "../components/QrCode";
import { adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import { agoText } from "../lib/branch-settings";
import type { AdminDevice, DeviceConnectCode } from "../lib/contracts";
import { codeUsed, deviceState, nextDeviceName } from "../lib/devices";
import type { MessageKey } from "../lib/i18n";
import { pairingServerUrl } from "../lib/links";
import { loadPlaces } from "../lib/places";
import { selectedLocationId } from "../lib/selected-location";
import { useShell } from "../lib/use-shell";
import type { Route } from "./+types/devices";

/**
 * Tablets and screens for the selected branch. Built for someone who has
 * never set up a till: pick what the tablet is for, type the code it shows
 * into the tablet, watch it turn green. No names, prefixes, tokens or server
 * addresses to fill in; those are picked for them and changeable later.
 */
export async function clientLoader() {
	const api = adminApi();
	const places = await loadPlaces(api);
	const locationId = selectedLocationId(places);
	if (!locationId) throw data(null, { status: 404 });
	const [devices, staff] = await Promise.all([
		api.devices(locationId),
		api.staff().catch(() => []),
	]);
	const canSignIn = staff.some(
		(s) =>
			s.isActive &&
			s.hasPin &&
			s.locations.some((l) => l.locationId === locationId),
	);
	return { locationId, devices, canSignIn };
}

type Action =
	| { intent: "add"; deviceId: string; name: string; code: DeviceConnectCode }
	| { intent: "code"; deviceId: string; name: string; code: DeviceConnectCode }
	| { intent: "rename"; ok: true; name: string }
	| { intent: "remove"; ok: true }
	| { intent: string; error: MessageKey };

export async function clientAction({
	request,
}: Route.ClientActionArgs): Promise<Action> {
	const api = adminApi();
	const f = await request.formData();
	const intent = String(f.get("intent") ?? "");
	const id = String(f.get("deviceId") ?? "");
	const name = String(f.get("name") ?? "").trim();
	try {
		if (intent === "add") {
			const kind = f.get("kind") === "kds" ? "kds" : "pos";
			const r = await api.registerDevice({
				locationId: String(f.get("locationId") ?? ""),
				name,
				kind,
			});
			return {
				intent,
				deviceId: r.deviceId,
				name,
				code: {
					pairingCode: r.pairingCode,
					pairingExpiresAt: r.pairingExpiresAt,
				},
			};
		}
		if (intent === "code")
			return { intent, deviceId: id, name, code: await api.connectCode(id) };
		if (intent === "rename") {
			if (!name || name.length > 80) return { intent, error: "required_field" };
			await api.renameDevice(id, name);
			return { intent, ok: true, name };
		}
		if (intent === "remove") {
			await api.revokeDevice(id);
			return { intent, ok: true };
		}
	} catch (e) {
		if (e instanceof AdminApiError && e.status === 402)
			return { intent, error: "dv_plan_limit" };
		if (e instanceof AdminApiError && e.status < 500)
			return { intent, error: "dv_add_failed" };
		throw e;
	}
	return { intent, error: "dv_add_failed" };
}

type Connecting = {
	deviceId: string;
	name: string;
	code: DeviceConnectCode;
};

export default function DevicesPage({ loaderData }: Route.ComponentProps) {
	const { t, lang, place } = useShell();
	const { devices, locationId, canSignIn } = loaderData;
	const toast = useToast();
	const adder = useFetcher<typeof clientAction>();
	const coder = useFetcher<typeof clientAction>();
	const [picking, setPicking] = useState(false);
	const [connecting, setConnecting] = useState<Connecting | null>(null);
	const [renaming, setRenaming] = useState<AdminDevice | null>(null);
	const [moving, setMoving] = useState<AdminDevice | null>(null);
	const [removing, setRemoving] = useState<AdminDevice | null>(null);
	const live = devices.filter((d) => !d.revokedAt);
	const removed = devices.filter((d) => d.revokedAt);
	const branch = place?.name ?? "";

	// A new tablet, or a new code for one: straight to the connect screen.
	useEffect(() => {
		for (const f of [adder, coder]) {
			const r = f.state === "idle" ? f.data : undefined;
			if (r && "code" in r) {
				setPicking(false);
				setConnecting({ deviceId: r.deviceId, name: r.name, code: r.code });
			}
		}
	}, [adder.state, adder.data, coder.state, coder.data, adder, coder]);
	const addError =
		adder.state === "idle" && adder.data && "error" in adder.data
			? adder.data.error
			: undefined;

	const getCode = (d: AdminDevice) =>
		coder.submit(
			{ intent: "code", deviceId: d.id, name: d.name },
			{ method: "post" },
		);

	return (
		<>
			<div className="page-head">
				<div>
					<h1>{t("devices")}</h1>
					<p className="muted small page-sub">{t("dv_sub", { branch })}</p>
				</div>
				{live.length > 0 && (
					<button
						type="button"
						className="btn btn--primary"
						onClick={() => setPicking(true)}
					>
						<Icon name="plus" />
						{t("dv_add")}
					</button>
				)}
			</div>

			{live.length === 0 ? (
				<section className="card dv-empty">
					<span className="dv-empty__icon" aria-hidden="true">
						<Icon name="tablet" size={36} />
					</span>
					<h2>{t("dv_empty_title")}</h2>
					<ol className="dv-steps">
						<li>{t("dv_empty_1")}</li>
						<li>{t("dv_empty_2")}</li>
						<li>{t("dv_empty_3")}</li>
					</ol>
					<button
						type="button"
						className="btn btn--primary dv-big"
						onClick={() => setPicking(true)}
					>
						<Icon name="plus" />
						{t("dv_add")}
					</button>
				</section>
			) : (
				<ul className="dv-list">
					{live.map((d) => (
						<DeviceRow
							key={d.id}
							d={d}
							onCode={() => getCode(d)}
							onRename={() => setRenaming(d)}
							onMove={() => setMoving(d)}
							onRemove={() => setRemoving(d)}
							busy={coder.state !== "idle"}
						/>
					))}
				</ul>
			)}

			{removed.length > 0 && (
				<details className="dv-removed">
					<summary>{t("dv_removed_list", { n: removed.length })}</summary>
					<ul className="dv-list">
						{removed.map((d) => (
							<li key={d.id} className="dv-row dv-row--removed">
								<span className="dv-row__icon" aria-hidden="true">
									<Icon name={d.kind === "kds" ? "monitor" : "tablet"} />
								</span>
								<span className="dv-row__main">
									<strong>{d.name}</strong>
									<span className="muted small">{t(`kind_${d.kind}`)}</span>
								</span>
								<Badge>{t("revoked")}</Badge>
							</li>
						))}
					</ul>
				</details>
			)}

			{/* 1. What is it for? One tap adds it. */}
			<Sheet
				open={picking}
				onClose={() => setPicking(false)}
				title={t("dv_pick_title")}
			>
				<div className="dv-pick">
					{(["pos", "kds"] as const).map((kind) => (
						<button
							key={kind}
							type="button"
							className="dv-pick__card"
							disabled={adder.state !== "idle"}
							onClick={() =>
								adder.submit(
									{
										intent: "add",
										kind,
										locationId,
										name: nextDeviceName(kind, devices, (n) =>
											t(kind === "kds" ? "dv_default_kds" : "dv_default_pos", {
												n,
											}),
										),
									},
									{ method: "post" },
								)
							}
						>
							<span className="dv-pick__icon" aria-hidden="true">
								<Icon name={kind === "kds" ? "monitor" : "tablet"} size={32} />
							</span>
							<strong>
								{t(kind === "kds" ? "dv_pick_kds" : "dv_pick_pos")}
							</strong>
							<span className="muted">
								{t(kind === "kds" ? "dv_pick_kds_desc" : "dv_pick_pos_desc")}
							</span>
						</button>
					))}
				</div>
				{adder.state !== "idle" && <Spinner />}
				{addError && (
					<p className="error small" role="alert">
						{t(addError)}
					</p>
				)}
				<p className="muted small">{t("dv_pick_hint")}</p>
			</Sheet>

			{/* 2. Type the code on the tablet. Turns green by itself. */}
			<Sheet
				open={connecting !== null}
				onClose={() => setConnecting(null)}
				title={
					connecting ? t("dv_connect_title", { name: connecting.name }) : ""
				}
			>
				{connecting && (
					<ConnectPanel
						key={connecting.code.pairingCode}
						c={connecting}
						devices={devices}
						canSignIn={canSignIn}
						branch={branch}
						onNewCode={() =>
							coder.submit(
								{
									intent: "code",
									deviceId: connecting.deviceId,
									name: connecting.name,
								},
								{ method: "post" },
							)
						}
						onDone={() => setConnecting(null)}
						onAnother={() => {
							setConnecting(null);
							setPicking(true);
						}}
						lang={lang}
					/>
				)}
			</Sheet>

			<RenameDialog d={renaming} onClose={() => setRenaming(null)} />

			<Dialog
				open={moving !== null}
				onClose={() => setMoving(null)}
				title={t("dv_move_title", { name: moving?.name ?? "" })}
				footer={
					<div className="actions-row">
						<button
							type="button"
							className="btn"
							onClick={() => setMoving(null)}
						>
							{t("cancel")}
						</button>
						<button
							type="button"
							className="btn btn--primary"
							onClick={() => {
								if (moving) getCode(moving);
								setMoving(null);
							}}
						>
							{t("dv_move_go")}
						</button>
					</div>
				}
			>
				<p>{t("dv_move_body")}</p>
			</Dialog>

			<RemoveDialog
				d={removing}
				onClose={() => setRemoving(null)}
				onRemoved={(name) => toast(t("dv_removed", { name }), "neutral")}
			/>
		</>
	);
}

function DeviceRow({
	d,
	onCode,
	onRename,
	onMove,
	onRemove,
	busy,
}: {
	d: AdminDevice;
	onCode: () => void;
	onRename: () => void;
	onMove: () => void;
	onRemove: () => void;
	busy: boolean;
}) {
	const { t, lang } = useShell();
	const st = deviceState(d);
	const [menu, setMenu] = useState(false);
	return (
		<li className={`dv-row dv-row--${st.kind}`}>
			<span className="dv-row__icon" aria-hidden="true">
				<Icon name={d.kind === "kds" ? "monitor" : "tablet"} size={22} />
			</span>
			<span className="dv-row__main">
				<strong className="dv-row__name">{d.name}</strong>
				<span className="muted small">
					{t(`kind_${d.kind}`)} ·{" "}
					<span dir="auto">{t("dv_tickets", { prefix: d.ticketPrefix })}</span>
				</span>
			</span>
			<span className="dv-row__status">
				<span className={`dv-dot dv-dot--${st.kind}`} aria-hidden="true" />
				<span>
					<span className="dv-row__state">
						{st.kind === "on"
							? t("dv_status_on")
							: st.kind === "off"
								? t("dv_status_off", { ago: agoText(st.minutesAgo, lang) })
								: st.kind === "waiting"
									? t("dv_status_waiting")
									: t("dv_status_new")}
					</span>
					{st.kind === "off" && (
						<span className="muted small">{t("dv_status_off_hint")}</span>
					)}
				</span>
			</span>
			<span className="dv-row__actions">
				{(st.kind === "waiting" || st.kind === "new") && (
					<button
						type="button"
						className="btn btn--primary"
						onClick={onCode}
						disabled={busy}
					>
						{st.kind === "waiting" ? t("dv_show_code") : t("dv_connect")}
					</button>
				)}
				<span className="dv-menu">
					<button
						type="button"
						className="btn dv-icon-btn"
						aria-label={t("dv_actions", { name: d.name })}
						aria-expanded={menu}
						onClick={() => setMenu((m) => !m)}
					>
						<Icon name="settings" />
					</button>
					{menu && (
						<span
							className="dv-menu__list"
							role="menu"
							onMouseLeave={() => setMenu(false)}
							onBlur={(e) => {
								if (!e.currentTarget.contains(e.relatedTarget)) setMenu(false);
							}}
						>
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									setMenu(false);
									onRename();
								}}
							>
								{t("dv_rename")}
							</button>
							{(st.kind === "on" || st.kind === "off") && (
								<button
									type="button"
									role="menuitem"
									onClick={() => {
										setMenu(false);
										onMove();
									}}
								>
									{t("dv_move")}
								</button>
							)}
							<button
								type="button"
								role="menuitem"
								className="danger"
								onClick={() => {
									setMenu(false);
									onRemove();
								}}
							>
								{t("dv_remove")}
							</button>
						</span>
					)}
				</span>
			</span>
		</li>
	);
}

/** Every 3 seconds while open, until the tablet shows up or the code runs out. */
function ConnectPanel({
	c,
	devices,
	canSignIn,
	branch,
	onNewCode,
	onDone,
	onAnother,
	lang,
}: {
	c: Connecting;
	devices: AdminDevice[];
	canSignIn: boolean;
	branch: string;
	onNewCode: () => void;
	onDone: () => void;
	onAnother: () => void;
	lang: "en" | "ar";
}) {
	const { t } = useShell();
	const revalidator = useRevalidator();
	const [now, setNow] = useState(Date.now);
	const [copied, setCopied] = useState(false);
	const done = codeUsed(devices, c.deviceId, c.code.pairingExpiresAt, now);
	const expired = !done && now >= Date.parse(c.code.pairingExpiresAt);

	useEffect(() => {
		if (done || expired) return;
		const timer = window.setInterval(() => {
			setNow(Date.now());
			if (revalidator.state === "idle") void revalidator.revalidate();
		}, 3000);
		return () => window.clearInterval(timer);
	}, [done, expired, revalidator]);

	if (done)
		return (
			<div className="dv-connected" role="status">
				<span className="dv-connected__check" aria-hidden="true">
					<Icon name="check" size={40} />
				</span>
				<h3>{t("dv_connected_title", { name: c.name })}</h3>
				{canSignIn ? (
					<p className="muted">{t("dv_connected_body")}</p>
				) : (
					<p className="dv-nudge">
						{t("dv_no_pin_staff", { branch })}{" "}
						<Link to="/staff/new">{t("dv_add_person")}</Link>
					</p>
				)}
				<div className="actions-row">
					<button type="button" className="btn btn--primary" onClick={onDone}>
						{t("done")}
					</button>
					<button type="button" className="btn" onClick={onAnother}>
						{t("dv_add_another")}
					</button>
				</div>
			</div>
		);

	const pretty = formatConnectCode(c.code.pairingCode);
	const until = new Date(c.code.pairingExpiresAt).toLocaleTimeString(
		lang === "ar" ? "ar-OM" : "en-GB",
		{ timeStyle: "short", numberingSystem: "latn" },
	);
	return (
		<div className="dv-connect">
			<ol className="dv-steps">
				<li>{t("dv_step_open")}</li>
				<li>
					{t("dv_step_type")}
					<span
						className={`dv-code${expired ? " dv-code--expired" : ""}`}
						dir="ltr"
					>
						{pretty}
					</span>
				</li>
			</ol>
			{expired ? (
				<div className="dv-expired" role="alert">
					<span>{t("dv_expired")}</span>
					<button
						type="button"
						className="btn btn--primary"
						onClick={onNewCode}
					>
						<Icon name="refresh" />
						{t("dv_new_code")}
					</button>
				</div>
			) : (
				<>
					<div className="dv-connect__qr">
						<QrCode
							value={encodePairingCode({
								serverUrl: pairingServerUrl(),
								code: c.code.pairingCode,
							})}
							size={148}
							label={t("pair_qr_alt")}
						/>
						<p className="muted small">{t("dv_step_scan")}</p>
					</div>
					<p className="dv-waiting" role="status">
						<Spinner />
						<span>{t("dv_waiting")}</span>
					</p>
					<div className="dv-connect__foot">
						<span className="muted small">
							{t("dv_code_life", { time: until })}
						</span>
						<button
							type="button"
							className="link-btn small"
							onClick={() =>
								navigator.clipboard?.writeText(pretty).then(
									() => setCopied(true),
									() => setCopied(false),
								)
							}
						>
							<Icon name="copy" size={14} />
							{copied ? t("copied") : t("dv_copy_code")}
						</button>
					</div>
				</>
			)}
		</div>
	);
}

function RenameDialog({
	d,
	onClose,
}: {
	d: AdminDevice | null;
	onClose: () => void;
}) {
	const { t } = useShell();
	const toast = useToast();
	const f = useFetcher<typeof clientAction>();
	const [name, setName] = useState("");
	useEffect(() => {
		if (d) setName(d.name);
	}, [d]);
	useEffect(() => {
		if (
			f.state === "idle" &&
			f.data &&
			"ok" in f.data &&
			f.data.intent === "rename"
		) {
			toast(t("dv_renamed", { name: f.data.name }));
			onClose();
		}
	}, [f.state, f.data, onClose, t, toast]);
	return (
		<Dialog
			open={d !== null}
			onClose={onClose}
			title={t("dv_rename_title", { name: d?.name ?? "" })}
		>
			<f.Form method="post" className="form">
				<input type="hidden" name="intent" value="rename" />
				<input type="hidden" name="deviceId" value={d?.id ?? ""} />
				<label>
					{t("device_name")}
					<input
						name="name"
						className="input"
						value={name}
						onChange={(e) => setName(e.target.value)}
						maxLength={80}
						required
						autoFocus
					/>
					<span className="muted small">{t("dv_rename_hint")}</span>
				</label>
				<div className="actions-row">
					<button type="button" className="btn" onClick={onClose}>
						{t("cancel")}
					</button>
					<button
						type="submit"
						className="btn btn--primary"
						disabled={f.state !== "idle"}
					>
						{t("save")}
					</button>
				</div>
			</f.Form>
		</Dialog>
	);
}

function RemoveDialog({
	d,
	onClose,
	onRemoved,
}: {
	d: AdminDevice | null;
	onClose: () => void;
	onRemoved: (name: string) => void;
}) {
	const { t } = useShell();
	const f = useFetcher();
	return (
		<Dialog
			open={d !== null}
			onClose={onClose}
			title={t("dv_remove_title", { name: d?.name ?? "" })}
			footer={
				<div className="actions-row">
					<button type="button" className="btn" onClick={onClose}>
						{t("cancel")}
					</button>
					<button
						type="button"
						className="btn btn--danger"
						onClick={() => {
							if (!d) return;
							f.submit(
								{ intent: "remove", deviceId: d.id },
								{ method: "post" },
							);
							onRemoved(d.name);
							onClose();
						}}
					>
						{t("dv_remove")}
					</button>
				</div>
			}
		>
			<p>{t("dv_remove_body")}</p>
		</Dialog>
	);
}
