import { type ReactNode, useEffect, useId, useRef } from "react";
import { useUi } from "../context";
import { IconButton } from "./Button";
import { cx } from "./cx";

type ModalProps = {
	open: boolean;
	/** Called on Escape, the close button, or a tap on the backdrop. */
	onClose: () => void;
	title: ReactNode;
	children?: ReactNode;
	/** Sticky action row (e.g. the primary button). */
	footer?: ReactNode;
	className?: string;
};

/**
 * Built on the native <dialog>, so focus trapping, Escape and the top layer
 * come from the browser. Sheet slides up from the bottom on phones and sits
 * centred on wide screens; Dialog is always centred and narrower.
 */
function Modal({
	kind,
	open,
	onClose,
	title,
	children,
	footer,
	className,
}: ModalProps & { kind: "sheet" | "dialog" }) {
	const ref = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const { t } = useUi();

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		if (!open && el.open) el.close();
	}, [open]);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the click is the backdrop tap; the keyboard equivalent is Escape, handled natively via onCancel
		<dialog
			ref={ref}
			className={cx("bite-modal", `bite-modal--${kind}`, className)}
			aria-labelledby={titleId}
			onCancel={(e) => {
				e.preventDefault();
				onClose();
			}}
			onClick={(e) => {
				// A click on the dialog element itself is a click on the backdrop.
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="bite-modal__panel">
				<header className="bite-modal__head">
					<h2 id={titleId} className="bite-modal__title">
						{title}
					</h2>
					<IconButton icon="close" label={t("close")} onClick={onClose} />
				</header>
				<div className="bite-modal__body">{children}</div>
				{footer && <footer className="bite-modal__foot">{footer}</footer>}
			</div>
		</dialog>
	);
}

export const Sheet = (props: ModalProps) => <Modal kind="sheet" {...props} />;
export const Dialog = (props: ModalProps) => <Modal kind="dialog" {...props} />;
