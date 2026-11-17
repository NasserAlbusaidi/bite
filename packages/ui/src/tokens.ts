/**
 * Bite design tokens. The single source of truth: `tokens.css` is generated
 * from this file (`pnpm --filter @bite/ui tokens`) and a test fails if the
 * checked-in CSS is stale.
 *
 * Three layers:
 * 1. brand: the palette from the brand pack. Apps never use these directly.
 * 2. semantic: what apps style with (--text, --surface, --action…), per theme.
 * 3. density: control sizes and type size per surface (guest, POS, admin, KDS).
 *
 * Imported by Node scripts with type stripping, so keep it dependency-free.
 */

export const brand = {
	forest: "#004225",
	pine: "#0B6B2E",
	green: "#37B34A",
	lime: "#7AC70C",
	olive: "#B7C40D",
	lime300: "#98D641",
	lime200: "#C3E88A",
	lime100: "#E6F4CE",
	cream: "#F6F8F1",
	mist: "#ECF1E6",
	line: "#DCE4D2",
	charcoal: "#16241B",
	white: "#FFFFFF",
} as const;

/** Semantic colour roles. Every theme defines every role. */
export type ColorRole =
	| "bg"
	| "surface"
	| "surface-sunken"
	| "surface-inverse"
	| "text"
	| "text-strong"
	| "text-muted"
	| "text-inverse"
	| "line"
	| "line-strong"
	| "action"
	| "action-hover"
	| "on-action"
	| "secondary"
	| "secondary-hover"
	| "on-secondary"
	| "link"
	| "focus"
	| "success"
	| "success-bg"
	| "warning"
	| "warning-bg"
	| "danger"
	| "danger-hover"
	| "danger-bg"
	| "on-danger"
	| "overlay";

export type Theme = Record<ColorRole, string>;

/**
 * Lime is the signature colour, but it is only ever a fill (with forest text
 * on it). As text on white it is 2.1:1. That is why there is no lime text role.
 */
export const light: Theme = {
	bg: brand.cream,
	surface: brand.white,
	"surface-sunken": brand.mist,
	"surface-inverse": brand.forest,
	text: brand.charcoal,
	"text-strong": brand.forest,
	"text-muted": "#56634F",
	"text-inverse": brand.white,
	line: brand.line,
	"line-strong": "#7E8F72",
	action: brand.lime,
	"action-hover": brand.lime300,
	"on-action": brand.forest,
	secondary: brand.forest,
	"secondary-hover": "#0A5534",
	"on-secondary": brand.white,
	link: brand.pine,
	focus: brand.forest,
	success: brand.pine,
	"success-bg": brand.lime100,
	warning: "#875400",
	"warning-bg": "#FBF0D9",
	danger: "#B4321B",
	"danger-hover": "#962814",
	"danger-bg": "#FBE9E6",
	"on-danger": brand.white,
	overlay: "rgb(12 22 17 / 0.48)",
};

/** Dark: kitchen screens by default, the till at night. Green-black, not grey. */
export const dark: Theme = {
	bg: "#0B1510",
	surface: "#13221A",
	"surface-sunken": "#0F1C15",
	"surface-inverse": brand.lime200,
	text: "#E7EEE2",
	"text-strong": "#F4F8F1",
	"text-muted": "#A3B09B",
	"text-inverse": "#0B1510",
	line: "#26392D",
	"line-strong": "#5E7A66",
	action: brand.lime,
	"action-hover": brand.lime300,
	"on-action": brand.forest,
	secondary: brand.lime200,
	"secondary-hover": brand.lime100,
	"on-secondary": "#0B1510",
	link: brand.lime300,
	focus: brand.lime300,
	success: brand.lime300,
	"success-bg": "#1C3A25",
	warning: "#F2C46B",
	"warning-bg": "#3A2C10",
	danger: "#FF9A88",
	"danger-hover": "#FFB4A6",
	"danger-bg": "#3E1A14",
	"on-danger": "#2A0C06",
	overlay: "rgb(0 0 0 / 0.6)",
};

export const themes = { light, dark } as const;
export type ThemeName = keyof typeof themes;

/** Text-on-background pairs that must meet WCAG AA (4.5:1) in every theme. */
export const textPairs: ReadonlyArray<readonly [ColorRole, ColorRole]> = [
	["text", "bg"],
	["text", "surface"],
	["text", "surface-sunken"],
	["text-strong", "surface"],
	["text-muted", "bg"],
	["text-muted", "surface"],
	["text-muted", "surface-sunken"],
	["text-inverse", "surface-inverse"],
	["on-action", "action"],
	["on-action", "action-hover"],
	["on-secondary", "secondary"],
	["on-secondary", "secondary-hover"],
	["link", "surface"],
	["link", "bg"],
	["success", "success-bg"],
	["success", "surface"],
	["warning", "warning-bg"],
	["warning", "surface"],
	["danger", "danger-bg"],
	["danger", "surface"],
	["on-danger", "danger"],
	["on-danger", "danger-hover"],
];

/** Non-text pairs that must meet 3:1 (focus ring, input borders). */
export const uiPairs: ReadonlyArray<readonly [ColorRole, ColorRole]> = [
	["focus", "bg"],
	["focus", "surface"],
	["line-strong", "surface"],
];

/** Fixed scales, the same on every surface. Whole pixels render crisply on tablets. */
export const space = {
	0: "0",
	1: "4px",
	2: "8px",
	3: "12px",
	4: "16px",
	5: "20px",
	6: "24px",
	7: "32px",
	8: "40px",
	9: "48px",
	10: "64px",
	11: "80px",
	12: "96px",
} as const;

export const fontSize = {
	xs: "12px",
	sm: "14px",
	base: "16px",
	md: "18px",
	lg: "22px",
	xl: "28px",
	"2xl": "34px",
	"3xl": "44px",
} as const;

export const radius = {
	sm: "8px",
	md: "14px",
	lg: "22px",
	xl: "32px",
	pill: "999px",
} as const;

export const font = {
	sans: '"Bai Jamjuree", "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", sans-serif',
	arabic:
		'"IBM Plex Sans Arabic", "Bai Jamjuree", system-ui, -apple-system, "Segoe UI", "Geeza Pro", sans-serif',
	mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

export const motion = {
	"ease-out": "cubic-bezier(0.22, 1, 0.36, 1)",
	"ease-bounce": "cubic-bezier(0.34, 1.56, 0.64, 1)",
	"dur-fast": "140ms",
	"dur-base": "240ms",
	"dur-slow": "420ms",
} as const;

/** Shadows are tinted with forest so they read as part of the palette. */
export const shadow = {
	sm: "0 1px 2px rgb(0 66 37 / 0.08), 0 1px 3px rgb(0 66 37 / 0.06)",
	md: "0 8px 24px rgb(0 66 37 / 0.12), 0 2px 6px rgb(0 66 37 / 0.06)",
	lg: "0 18px 48px rgb(0 66 37 / 0.18)",
	offset: `6px 6px 0 ${brand.pine}`,
} as const;

export const darkShadow = {
	sm: "0 1px 2px rgb(0 0 0 / 0.4)",
	md: "0 8px 24px rgb(0 0 0 / 0.45)",
	lg: "0 18px 48px rgb(0 0 0 / 0.55)",
	offset: `6px 6px 0 ${brand.forest}`,
} as const;

/**
 * Density per surface. comfortable = guest menu (default), touch = POS till,
 * compact = back office, far = kitchen screen read from two metres away.
 */
export const densities = {
	comfortable: {
		"control-h": "48px",
		"control-px": "20px",
		"text-body": fontSize.base,
		"text-label": fontSize.sm,
		"gap-stack": space[4],
		"pad-card": space[5],
	},
	touch: {
		"control-h": "56px",
		"control-px": "24px",
		"text-body": fontSize.md,
		"text-label": fontSize.base,
		"gap-stack": space[4],
		"pad-card": space[5],
	},
	compact: {
		"control-h": "36px",
		"control-px": "14px",
		"text-body": fontSize.sm,
		"text-label": fontSize.xs,
		"gap-stack": space[3],
		"pad-card": space[4],
	},
	far: {
		"control-h": "64px",
		"control-px": "28px",
		"text-body": fontSize.lg,
		"text-label": fontSize.md,
		"gap-stack": space[5],
		"pad-card": space[6],
	},
} as const;
export type Density = keyof typeof densities;

/** Line heights: Arabic glyphs are taller, so Arabic gets more leading. */
export const leading = {
	latin: { tight: "1.2", normal: "1.5", loose: "1.7" },
	arabic: { tight: "1.35", normal: "1.65", loose: "1.85" },
} as const;

const block = (
	selector: string,
	vars: Record<string, string>,
	colorScheme?: "light" | "dark",
) =>
	`${selector} {\n${Object.entries(vars)
		.map(
			([k, v]) =>
				`\t--${k}: ${v.replace(/#[0-9a-f]{3,8}\b/gi, (h) => h.toLowerCase())};`,
		)
		.concat(colorScheme ? [`\tcolor-scheme: ${colorScheme};`] : [])
		.join("\n")}\n}\n`;

const prefixed = (prefix: string, obj: Record<string, string>) =>
	Object.fromEntries(Object.entries(obj).map(([k, v]) => [`${prefix}${k}`, v]));

const themeVars = (t: Theme, s: Record<string, string>) => ({
	...t,
	...prefixed("shadow-", s),
});

/** The generated stylesheet. Deterministic, so the freshness test can compare. */
export function toCss(): string {
	const root = {
		...prefixed(
			"brand-",
			Object.fromEntries(
				Object.entries(brand).map(([k, v]) => [
					k.replace(/(\d+)/, "-$1").toLowerCase(),
					v,
				]),
			),
		),
		...prefixed(
			"space-",
			Object.fromEntries(Object.entries(space).map(([k, v]) => [k, v])),
		),
		...prefixed("fs-", fontSize),
		...prefixed("radius-", radius),
		...prefixed("font-", font),
		...motion,
		...prefixed("leading-", leading.latin),
		...themeVars(light, shadow),
		...densities.comfortable,
	};
	return [
		"/* Generated from src/tokens.ts by `pnpm --filter @bite/ui tokens`. Do not edit. */\n",
		block(":root", root),
		block('[lang="ar"]', {
			...prefixed("leading-", leading.arabic),
			"font-sans": font.arabic,
		}),
		block('[data-theme="light"]', themeVars(light, shadow), "light"),
		block('[data-theme="dark"]', themeVars(dark, darkShadow), "dark"),
		`@media (prefers-color-scheme: dark) {\n${block(
			'[data-theme="system"]',
			themeVars(dark, darkShadow),
			"dark",
		)
			.split("\n")
			.map((l) => (l ? `\t${l}` : l))
			.join("\n")}}\n`,
		...Object.entries(densities).map(([name, vars]) =>
			block(`[data-density="${name}"]`, vars),
		),
		// Every transition and animation in @bite/ui reads these durations.
		`@media (prefers-reduced-motion: reduce) {\n${block(":root", {
			"dur-fast": "1ms",
			"dur-base": "1ms",
			"dur-slow": "1ms",
		})
			.split("\n")
			.map((l) => (l ? `\t${l}` : l))
			.join("\n")}}\n`,
	].join("\n");
}
