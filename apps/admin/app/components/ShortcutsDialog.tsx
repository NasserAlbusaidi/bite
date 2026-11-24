import { Dialog } from "@bite/ui";
import type { T } from "../lib/i18n";
import { ACCOUNT_GO, type NavItem } from "../lib/nav";

/** The "?" sheet: every keyboard shortcut the back office knows. */
export function ShortcutsDialog({
	open,
	onClose,
	items,
	mac,
	t,
}: {
	open: boolean;
	onClose: () => void;
	items: readonly NavItem[];
	mac: boolean;
	t: T;
}) {
	const go = [
		...items.flatMap((i) => (i.go ? [{ key: i.go, label: t(i.key) }] : [])),
		{ key: ACCOUNT_GO, label: t("account") },
	];
	return (
		<Dialog open={open} onClose={onClose} title={t("keys_title")}>
			<div className="keys">
				<section>
					<h3 className="keys__head">{t("keys_general")}</h3>
					<dl className="keys__list">
						<div>
							<dt>
								<kbd>{mac ? "⌘" : "Ctrl"}</kbd> <kbd>K</kbd>
							</dt>
							<dd>{t("search_anything")}</dd>
						</div>
						<div>
							<dt>
								<kbd>/</kbd>
							</dt>
							<dd>{t("search_anything")}</dd>
						</div>
						<div>
							<dt>
								<kbd>?</kbd>
							</dt>
							<dd>{t("keys_title")}</dd>
						</div>
						<div>
							<dt>
								<kbd>Esc</kbd>
							</dt>
							<dd>{t("close")}</dd>
						</div>
					</dl>
				</section>
				<section>
					<h3 className="keys__head">{t("keys_go")}</h3>
					<dl className="keys__list">
						{go.map((g) => (
							<div key={g.key}>
								<dt>
									<kbd>G</kbd> <kbd>{g.key.toUpperCase()}</kbd>
								</dt>
								<dd>{g.label}</dd>
							</div>
						))}
					</dl>
				</section>
			</div>
		</Dialog>
	);
}
