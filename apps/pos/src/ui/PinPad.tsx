import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.js";

/** Numeric PIN entry. Digits stay LTR in Arabic, like on every phone keypad. */
export function PinPad(props: {
	busy: boolean;
	error: string | null;
	onSubmit: (pin: string) => void;
	onBack: () => void;
	onType?: () => void;
}) {
	const { t } = useI18n();
	const [pin, setPin] = useState("");
	function press(d: string) {
		props.onType?.();
		setPin((p) => (p + d).slice(0, 8));
	}
	return (
		<div className="pinpad">
			<div className="pin-dots" dir="ltr">
				{"•".repeat(pin.length) || " "}
			</div>
			{props.error && <p className="error">{props.error}</p>}
			<div className="keys" dir="ltr">
				{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
					<button
						type="button"
						key={d}
						onClick={() => press(d)}
						disabled={props.busy}
					>
						{d}
					</button>
				))}
				<button
					type="button"
					onClick={() => (pin ? setPin(pin.slice(0, -1)) : props.onBack())}
				>
					{pin ? "⌫" : t("lock.back")}
				</button>
				<button type="button" onClick={() => press("0")} disabled={props.busy}>
					0
				</button>
				<button
					type="button"
					className="primary"
					disabled={props.busy || pin.length < 4}
					onClick={() => {
						props.onSubmit(pin);
						setPin("");
					}}
				>
					OK
				</button>
			</div>
		</div>
	);
}
