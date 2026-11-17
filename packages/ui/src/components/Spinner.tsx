import { useUi } from "../context";

export function Spinner({ label }: { label?: string }) {
	const { t } = useUi();
	return (
		<span className="bite-spinner" role="status">
			<span className="bite-sr-only">{label ?? t("loading")}</span>
		</span>
	);
}
