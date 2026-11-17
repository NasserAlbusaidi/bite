# @bite/ui

Bite's design system for the guest menu, the POS/KDS and the back office:
tokens, base styles, self-hosted fonts and a small set of React components.
Arabic and English are both first-class; everything uses logical properties,
so RTL needs no overrides.

The brand comes from the legacy app (`pos-system/bite/resources/brand` and the
v2 tokens in `resources/css/app.css`): forest, pine and lime greens, Bai
Jamjuree for Latin, IBM Plex Sans Arabic for Arabic. This package keeps that
look and fixes what was wrong with it (see "Changes from the legacy system").

## Use it

```tsx
import "@bite/ui/styles.css"; // once, at the app root
import { Button, Money, UiProvider } from "@bite/ui";

<html lang="ar" dir="rtl" data-theme="light" data-density="touch">
	<UiProvider lang="ar">
		<Button>أضف</Button>
		<Money amount={1850} currency={{ code: "OMR", decimals: 3 }} />
	</UiProvider>
</html>;
```

- `data-theme`: `light` (default), `dark`, or `system`. It works on any element,
  so a dark kitchen panel can sit inside a light app.
- `data-density`: `comfortable` (guest menu, default), `touch` (POS till),
  `compact` (back office), `far` (kitchen screen read from across the room).
- `lang="ar"` switches the font stack and adds Arabic line spacing.
- App CSS should use the semantic tokens (`--surface`, `--text`, `--text-muted`,
  `--action`, `--on-action`, `--danger`…), never `--brand-*` or hex values.
  ui styles sit in `@layer bite.base, bite.components`, so app CSS wins
  without `!important`.

## Tokens

`src/tokens.ts` is the source of truth. After changing it run
`pnpm --filter @bite/ui tokens` to regenerate `src/tokens.css`; a test fails
if the two disagree. Another test checks every text/background pair in both
themes against WCAG AA (4.5:1 text, 3:1 focus rings and borders), so a token
change that hurts legibility can't merge.

## Components

Button, IconButton, TextField, TextArea, SelectField, Field (custom
controls), Card, Badge, Money, Sheet, Dialog, Tabs, ToastProvider/useToast,
Keypad (+ `applyKey`), QuantityStepper, Logo, Icon, Spinner.

`tenantAccent(hex)` turns a shop's brand colour into CSS variables for the
guest menu, picking a readable text colour and refusing colours that can't
meet AA.

## Gallery

`pnpm --filter @bite/ui gallery` serves every component with English/Arabic,
light/dark and density toggles at http://localhost:5180.

## Changes from the legacy system

- Lime, olive and green are fills only. As text they fail contrast (lime on
  white is 2.1:1), so there is no lime text token.
- Muted text darkened from #6E7A66 (4.2:1 on cream) to #56634F.
- One spacing ramp (1–12, no gaps) and one radius set. The legacy app had two.
- New: dark theme, densities, tenant accent guard, `<Money>` with bidi
  isolation and the Rial sign, wordmarks as vector SVG (traced from the brand
  PNGs) instead of rasters.
