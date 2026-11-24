import { Icon, type IconName } from "@bite/ui";
import {
	type KeyboardEvent,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type { T } from "../lib/i18n";
import { matchScore } from "../lib/nav";

export type Command = {
	id: string;
	label: string;
	/** Extra words the search also looks at (the other language, an email). */
	keywords?: string[];
	hint?: string | undefined;
	group: string;
	icon: IconName;
	run: () => void;
};

const MAX_PER_GROUP = 6;

/**
 * Ctrl/Cmd+K: one box to jump to any page, branch, staff member or product,
 * or run a shell action. Built on <dialog> for focus trapping and Escape.
 * The list is a listbox driven from the input (aria-activedescendant), so the
 * focus never leaves the search field.
 */
export function CommandPalette({
	open,
	onClose,
	commands,
	t,
}: {
	open: boolean;
	onClose: () => void;
	commands: Command[];
	t: T;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const listId = useId();
	const [q, setQ] = useState("");
	const [active, setActive] = useState(0);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open && !el.open) {
			setQ("");
			setActive(0);
			el.showModal();
			input.current?.focus();
		}
		if (!open && el.open) el.close();
	}, [open]);

	const results = useMemo(() => {
		const scored = commands
			.map((c, i) => ({
				c,
				i,
				s: matchScore(q, c.label, ...(c.keywords ?? [])),
			}))
			.filter((x) => x.s > 0);
		if (q.trim()) scored.sort((a, b) => b.s - a.s || a.i - b.i);
		const perGroup = new Map<string, number>();
		const out: Command[] = [];
		for (const { c } of scored) {
			const n = perGroup.get(c.group) ?? 0;
			if (n >= MAX_PER_GROUP) continue;
			perGroup.set(c.group, n + 1);
			out.push(c);
		}
		// Keep groups together in the order they first appear.
		const order = [...new Set(out.map((c) => c.group))];
		return order.flatMap((g) => out.filter((c) => c.group === g));
	}, [commands, q]);

	const pick = (c: Command | undefined) => {
		if (!c) return;
		onClose();
		c.run();
	};

	const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive((a) => (results.length ? (a + 1) % results.length : 0));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((a) =>
				results.length ? (a - 1 + results.length) % results.length : 0,
			);
		} else if (e.key === "Enter") {
			e.preventDefault();
			pick(results[active]);
		}
	};

	useEffect(() => {
		document
			.getElementById(`${listId}-${active}`)
			?.scrollIntoView({ block: "nearest" });
	}, [active, listId]);

	let lastGroup = "";
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap; Escape is the keyboard equivalent (native cancel)
		<dialog
			ref={ref}
			className="palette"
			aria-label={t("palette_label")}
			onCancel={(e) => {
				e.preventDefault();
				onClose();
			}}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="palette__box">
				<label className="palette__search">
					<Icon name="search" />
					<span className="sr-only">{t("palette_label")}</span>
					<input
						ref={input}
						value={q}
						onChange={(e) => {
							setQ(e.target.value);
							setActive(0);
						}}
						onKeyDown={onKey}
						placeholder={t("search_anything")}
						role="combobox"
						aria-expanded="true"
						aria-controls={listId}
						aria-activedescendant={
							results[active] ? `${listId}-${active}` : undefined
						}
						autoComplete="off"
						spellCheck={false}
					/>
					<kbd>Esc</kbd>
				</label>
				<div className="palette__list" id={listId} role="listbox">
					{results.length === 0 && (
						<p className="palette__empty">{t("palette_empty", { q })}</p>
					)}
					{results.map((c, i) => {
						const head = c.group !== lastGroup;
						lastGroup = c.group;
						return (
							<div key={c.id} role="presentation">
								{head && (
									<div className="palette__group" role="presentation">
										{c.group}
									</div>
								)}
								<div
									id={`${listId}-${i}`}
									role="option"
									aria-selected={i === active}
									tabIndex={-1}
									className="palette__item"
									onMouseMove={() => setActive(i)}
									onClick={() => pick(c)}
									onKeyDown={() => undefined}
								>
									<Icon name={c.icon} className="pal-ico" />
									<span className="palette__label">{c.label}</span>
									{c.hint && <span className="palette__hint">{c.hint}</span>}
								</div>
							</div>
						);
					})}
				</div>
				<p className="palette__foot">
					<span>↑↓</span> {t("palette_keys")}
				</p>
			</div>
		</dialog>
	);
}
