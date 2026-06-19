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
  a faint starfield and nebula, constellation-gold, aurora-teal.

The bridge between them is deliberate: **gold** is the through-line (compass ink
by day → constellation lines by night), **teal** carries the seas/aurora, and
body text stays a warm parchment-cream in both so the dark theme reads as _night_,
never as generic "dark mode."

## Where it lives

Everything is a layer of CSS custom properties — the single source of truth.

| File                                 | Role                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `apps/web/src/styles/tokens.css`     | Semantic tokens for both themes (colour, type, spacing, radius, motion, terrain). |
| `apps/web/src/styles/base.css`       | Reset, document typography, the table atmosphere (grain / starfield).             |
| `apps/web/src/styles/components.css` | Reusable token-driven classes every slice adopts.                                 |
| `apps/web/src/styles.css`            | Entry point: fonts → tokens → base → components.                                  |
| `apps/web/src/app/styleguide/`       | The living `/styleguide` reference page.                                          |

**Rule for slices:** style from semantic tokens and the component classes — never
hard-code a hex value. Ask for a role (`--ink`, `--gold`, `--terrain-forest`),
not a colour.

## Typography

| Role               | Family             | Notes                                                                   |
| ------------------ | ------------------ | ----------------------------------------------------------------------- |
| Display            | **Cinzel**         | Engraved Roman caps — cartouche titles, the wordmark, section eyebrows. |
| Body / UI          | **Spectral**       | Literary serif designed for screens — panels, controls, prose.          |
| Coordinates / code | **JetBrains Mono** | Hex coordinates (`q · r`), tokens, keys — the signature numeric detail. |

Type scale is modular (~1.25): `--text-2xs` (11px) → `--text-3xl` (41px). Cartouche
lettering uses `--tracking-wider` (0.14em) uppercase.

## Colour — semantic roles

Tokens are named by role, themed by value. Light values live on `:root`; dark
overrides under `:root[data-theme='dark']`.

| Token           | Role                                     | Parchment | Astral    |
| --------------- | ---------------------------------------- | --------- | --------- |
| `--bg`          | The table                                | `#ece0c6` | `#0d1124` |
| `--surface`     | Paper / panels                           | `#f5ecd6` | `#161c38` |
| `--ink`         | Primary text                             | `#2f2416` | `#e9e2cf` |
| `--ink-muted`   | Secondary text                           | `#6f5d40` | `#aeb2cc` |
| `--gold`        | Primary accent (compass / constellation) | `#9a6a16` | `#e6b652` |
| `--sea`         | Secondary (seas / aurora)                | `#2f6f6a` | `#54c8bb` |
| `--astra`       | Tertiary (dusk / nebula)                 | `#5a4aa6` | `#a18cf0` |
| `--ember`       | Danger (marginalia)                      | `#a4402e` | `#e88a6f` |
| `--positive`    | Confirm / "online"                       | `#4a6f2f` | `#86c46a` |
| `--line-strong` | Drawn rules / borders                    | `#a8946a` | `#3d4878` |

**Terrain fills** (`--terrain-grass|forest|ocean|mountain|desert|marsh`) are the
base type of a hex, tuned to read as hand-tinted washes on each theme's canvas.

## Spacing, radius, motion

- **Spacing** — 4px base: `--space-1` (4px) → `--space-9` (96px).
- **Radius** — `--radius-sm` (3px) → `--radius-xl` (16px), plus `--radius-full`.
- **Motion** — durations `--dur-fast/base/slow`; eases `--ease-out`, `--ease-spring`.
  The shell plays one orchestrated, staggered load (header → rails → canvas → map)
  and respects `prefers-reduced-motion`.

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
