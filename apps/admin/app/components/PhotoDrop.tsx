import { useRef, useState } from "react";
import { adminApi } from "../lib/api";
import { AdminApiError } from "../lib/api-types";
import { shrinkImage } from "../lib/image-resize";
import { useShell } from "../lib/use-shell";
import { Thumb } from "./Thumb";

/**
 * A product photo you can drop a file on or click to pick one. Shrinks it in
 * the browser, uploads it, and hands back the URL. Links still work beside it.
 */
export function PhotoDrop({
	url,
	name,
	onUploaded,
	className = "",
	compact = false,
}: {
	url: string | null;
	name: string;
	onUploaded: (url: string) => void;
	className?: string;
	/** Thumbnail only (menu rows): no caption, errors as a tooltip. */
	compact?: boolean;
}) {
	const { t } = useShell();
	const input = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const take = async (file: File | undefined) => {
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			setError(t("photo_upload_failed"));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const small = await shrinkImage(file);
			onUploaded(await adminApi().uploadImage(small));
		} catch (e) {
			setError(
				e instanceof AdminApiError && e.status === 404
					? t("photo_uploads_off")
					: t("photo_upload_failed"),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className={`photo-drop${over ? " is-over" : ""}${busy ? " is-busy" : ""}${compact ? " photo-drop--compact" : ""} ${className}`}
		>
			<button
				type="button"
				className="photo-drop__btn"
				onDragOver={(e) => {
					if (![...e.dataTransfer.types].includes("Files")) return;
					e.preventDefault();
					e.stopPropagation();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={(e) => {
					if (!e.dataTransfer.files.length) return;
					e.preventDefault();
					e.stopPropagation();
					setOver(false);
					void take(e.dataTransfer.files[0]);
				}}
				onClick={() => input.current?.click()}
				disabled={busy}
				aria-label={url ? t("photo_change", { name }) : t("photo_add")}
				title={error ?? (compact ? t("photo_drop") : undefined)}
			>
				<Thumb url={url} name={name} className={className} />
				{busy && (
					<span className="photo-drop__busy">{t("photo_uploading")}</span>
				)}
			</button>
			{!compact && (
				<span className="muted small photo-drop__hint">{t("photo_drop")}</span>
			)}
			{error && !compact && (
				<span className="error small" role="alert">
					{error}
				</span>
			)}
			{error && compact && (
				<span className="photo-drop__flag" role="alert" title={error}>
					!
				</span>
			)}
			<input
				ref={input}
				type="file"
				accept="image/jpeg,image/png,image/webp,image/gif"
				className="sr-only"
				tabIndex={-1}
				aria-hidden="true"
				onChange={(e) => {
					void take(e.currentTarget.files?.[0]);
					e.currentTarget.value = "";
				}}
			/>
		</div>
	);
}
