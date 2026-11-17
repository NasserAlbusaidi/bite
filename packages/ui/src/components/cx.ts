/** Join class names, skipping falsy ones. */
export const cx = (...names: Array<string | false | null | undefined>) =>
	names.filter(Boolean).join(" ");
