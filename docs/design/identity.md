# Hexly visual identity

> **The cartographer's table, by starlight.**
> One identity told at two hours of the day. Live reference: run the app and
> open [`/styleguide`](http://localhost:4200/styleguide).

Hexly is a hex-map editor for TTRPG worldbuilding, so the identity leans
cartographic — an old sea-chart on a drafting table. The two themes are the
**same table at two times of day**, not a light mode and an unrelated dark mode:

- **Parchment** (light) — an aged sea-chart: warm cream stock, sepia iron-gall
  ink, compass-gold, verdigris seas, burnt-sienna marginalia.
- **Astral** (dark) — the same chart under the night sky: midnight-indigo paper,
  constellation-gold, aurora-teal.

The bridge between them is deliberate: **gold** is the through-line (compass ink
by day → constellation lines by night), **teal** carries the seas/aurora, and
body text stays a warm parchment-cream in both so the dark theme reads as _night_,
never as generic "dark mode."

## Where it lives

The design tokens **are** Tailwind's theme — one source of truth (ADR-0020).

| File                             | Role                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/web/src/styles.css`        | Entry point + the `@theme` block: the utility-shaped tokens (colour, type, spacing, radius, shadow, fonts). |
| `apps/web/src/styles/tokens.css` | The dark-theme overrides (reassigning the generated `--color-*`/`--shadow-*`) + non-utility tokens (motion, layout rails). |
| `apps/web/src/styles/base.css`   | Reset, document typography, the flat table background (`@layer base`).                    |
| `apps/web/src/app/styleguide/`   | The living `/styleguide` reference page.                                                  |

Primitives (`Button`, `Panel`, `Tool`, …) own their **scoped** styles and consume
the tokens directly (ADR-0007); there is no global component sheet.

**Rule for slices:** style from semantic tokens — never hard-code a hex value.
Ask for a role (`--color-ink`, `--color-gold`, `--color-terrain-forest`), not a
colour. A lint rule (`hexly-design/*`) enforces that every `var(--…)` resolves to
a defined token and that spacing utilities stay on the curated scale.

### Tailwind

Tailwind v4 is wired in (`@tailwindcss/postcss`, configured in
`apps/web/.postcssrc.json`; `@import "tailwindcss"` in `styles.css`). Every
utility-shaped token is declared in the `@theme static` block, so the same value
both generates an on-brand, theme-aware utility (`bg-surface`, `text-ink`,
`text-gold`, `border-line-strong`, `font-display`, `rounded-lg`,
`bg-terrain-forest`, `gap-5`, `text-md`) **and** is emitted as a CSS variable on
`:root`/`:host` for scoped component styles to consume via `var(--…)`. Colours and
shadows are declared non-`inline` so `[data-theme='dark']` (tokens.css) can
reassign the generated `--color-*`/`--shadow-*`; `static` disables theme-variable
tree-shaking so tokens read only by the Canvas renderer (`getComputedStyle`) or by
raw `var(--…)` still resolve. Spacing is bridged with explicit `--spacing-1..9`
keys, which Tailwind resolves before its `calc(var(--spacing) * N)` multiplier — so
the bespoke non-linear scale survives under the same names. Use utilities for
slice/shell layout; primitives keep their scoped styles.

## Typography

| Role               | Family             | Notes                                                                   |
| ------------------ | ------------------ | ----------------------------------------------------------------------- |
| Display            | **Cinzel**         | Engraved Roman caps — cartouche titles, the wordmark, section eyebrows. |
| Body / UI          | **Source Serif 4** | Literary serif drawn for screen text — panels, controls, prose. (Replaced Cormorant Garamond, whose thin display strokes read poorly at body sizes.) |
| Coordinates / code | **JetBrains Mono** | Hex coordinates (`q · r`), tokens, keys — the signature numeric detail. |

Type scale is modular (~1.25): `--text-2xs` (11px) → `--text-3xl` (41px). Cartouche
lettering uses `--tracking-wider` (0.14em) uppercase.

## Colour — semantic roles

Tokens are named by role, themed by value. The light value lives in the `@theme`
block (emitted to `:root`); `:root[data-theme='dark']` reassigns the generated
`--color-*`.

| Token                 | Role                                     | Parchment | Astral    |
| --------------------- | ---------------------------------------- | --------- | --------- |
| `--color-bg`          | The table                                | `#ece0c6` | `#0d1124` |
| `--color-surface`     | Paper / panels                           | `#f5ecd6` | `#161c38` |
| `--color-ink`         | Primary text                             | `#2f2416` | `#e9e2cf` |
| `--color-ink-muted`   | Secondary text                           | `#6f5d40` | `#aeb2cc` |
| `--color-gold`        | Primary accent (compass / constellation) | `#9a6a16` | `#e6b652` |
| `--color-sea`         | Secondary (seas / aurora)                | `#2f6f6a` | `#54c8bb` |
| `--color-astra`       | Tertiary (dusk / nebula)                 | `#5a4aa6` | `#a18cf0` |
| `--color-ember`       | Danger (marginalia)                      | `#a4402e` | `#e88a6f` |
| `--color-positive`    | Confirm / "online"                       | `#4a6f2f` | `#86c46a` |
| `--color-line-strong` | Drawn rules / borders                    | `#a8946a` | `#3d4878` |

**Terrain fills** (`--color-terrain-grass|forest|ocean|mountain|desert|marsh|sky`)
are the base type of a hex, tuned to read as hand-tinted washes on each theme's
canvas. The Canvas renderer reads them by name (ADR-0003).

## Spacing, radius, motion

- **Spacing** — bespoke, non-linear, bridged as explicit `@theme` keys:
  `--spacing-1` (4px) → `--spacing-9` (96px). Drives `p-`/`m-`/`gap-` utilities.
- **Radius** — `--radius-sm` (3px) → `--radius-xl` (16px), plus `--radius-full`.
- **Motion** — durations `--dur-fast/base/slow`; eases `--ease-out`, `--ease-spring`.
  Reserved for interaction (hovers, presses) and theme transitions — no entrance
  animation on first render. Respects `prefers-reduced-motion`.

## Theming mechanics

- The active theme is the `data-theme` attribute on `<html>`.
- `ThemeService` (`apps/web/src/app/core/theme.service.ts`) owns it, persists to
  `localStorage` (`hexly-theme`), and falls back to the OS preference when unset.
- An inline boot script in `index.html` applies the theme **before first paint**
  (no flash). An explicit user choice always beats the OS preference.

## App shell

The chrome downstream slices adopt: a header (wordmark, map title, theme toggle,
share), a left **tool palette** named in the domain's own vocabulary (Terrain,
Feature, Overlay, Region, Label), a **canvas frame** rendering the infinite hex
plane (themed grid mask, terrain washes, a selected hex, surrounding Void, compass
and zoom instruments), a right **inspector** showing the selected hex's Note, and
a status bar. See `apps/web/src/app/editor-shell/`.
