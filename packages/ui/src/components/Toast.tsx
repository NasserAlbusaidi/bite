import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { useUi } from "../context";
import { IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";

export type ToastTone = "neutral" | "success" | "warning" | "danger";
type ToastItem = { id: number; message: ReactNode; tone: ToastTone };
type Show = (message: ReactNode, tone?: ToastTone) => void;

const ToastContext = createContext<Show>(() => {});
const ICON: Record<ToastTone, IconName> = {
	neutral: "info",
	success: "check",
	warning: "alert",
	danger: "alert",
};

/** Short confirmations ("Sent to kitchen"). Not for anything the user must act on. */
export function ToastProvider({
	children,
	durationMs = 4000,
}: {
	children: ReactNode;
	durationMs?: number;
}) {
	const { t } = useUi();
	const [items, setItems] = useState<ToastItem[]>([]);
	const seq = useRef(0);
	const dismiss = useCallback(
		(id: number) => setItems((all) => all.filter((x) => x.id !== id)),
		[],
	);
	const show = useCallback<Show>(
		(message, tone = "neutral") => {
			seq.current += 1;
			const id = seq.current;
			setItems((all) => [...all.slice(-2), { id, message, tone }]);
			setTimeout(() => dismiss(id), durationMs);
		},
		[dismiss, durationMs],
	);
	const value = useMemo(() => show, [show]);
	return (
		<ToastContext value={value}>
			{children}
			<section className="bite-toasts" aria-label={t("notifications")}>
				<ul role="status" aria-live="polite">
					{items.map((item) => (
						<li key={item.id} className={`bite-toast bite-toast--${item.tone}`}>
							<Icon name={ICON[item.tone]} />
							<span className="bite-toast__msg">{item.message}</span>
							<IconButton
								icon="close"
								size="sm"
								label={t("dismiss")}
								onClick={() => dismiss(item.id)}
							/>
						</li>
					))}
				</ul>
			</section>
		</ToastContext>
	);
}

export const useToast = () => useContext(ToastContext);
