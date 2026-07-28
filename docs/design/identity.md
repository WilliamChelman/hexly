# Hexly visual identity

> **The cartographer's table, by starlight.**
> One identity told at two hours of the day. Live reference: run the app and
> open [`/styleguide`](http://localhost:4200/styleguide).

Hexly is a hex-map editor for TTRPG worldbuilding, so the identity leans
cartographic — an old sea-chart on a drafting table. The two **ColorSchemes** are the
**same table at two times of day**, not a light mode and an unrelated dark mode:

- **Solar** (light) — a sunlit almanac: warm ivory stock, sepia iron-gall ink,
  heliograph gold, burnt-sienna marginalia, moss.
- **Astral** (dark) — the same chart under the night sky: midnight-indigo paper,
  constellation gold, coral marginalia, aurora green.

The bridge between them is deliberate: **gold** is the through-line (heliograph ink
by day → constellation lines by night), and body text stays a warm parchment-cream in
both so Astral reads as _night_, never as generic "dark mode."

**Vocabulary.** "Theme" no longer means the day/night axis. That axis is a
**ColorScheme** (`solar` / `astral`); a **Palette** is the anchor set one ColorScheme
is authored as; a **World Theme** is the presentation a World Owner authors for one
World. CONTEXT.md fixes all three, and this document uses no other word for any of
them (ADR-0075, ADR-0076).

## Three tiers

The design tokens **are** Tailwind's theme — one source of truth (ADR-0020) — and
since ADR-0075 that source is not flat:

- **Tier 1 — the Palette.** Eight anchor colours and three numeric knobs per
  ColorScheme, spelled `--palette-*`. Private: a component naming one is a lint error,
  and the derivation in `index.css` is very nearly its only reader.
- **Tier 2 — the semantic roles.** The 46 colour roles the UI styles itself from, each
  declared as **one expression over tier 1** rather than as a literal — one named
  literal aside (below). The expressions are byte-identical in both ColorSchemes; only
  the anchors and knobs differ.
- **Tier 3 — a plugin's own vocabulary**, declared in the plugin that names it. The
  boundary is what a token _means_, not who consumes it: `canvas-*` and `ink-stroke`
  stay in core because an infinite pan/zoom field and a legibility halo are
  design-system concepts, while the hex map's grid rule, marker inks, and terrain
  fills are the hex map's own.

Re-anchoring Hexly is therefore **twelve values per ColorScheme** — eight anchors,
three knobs, one named literal — against the 35 the flat layer demanded. That is what
makes a **World Theme** authorable rather than a project (ADR-0076).

`libs/web-styles/src/tokens/manifest.ts` is the contract: every token's tier, type,
public flag, and owning plugin, in one place because five things read it — the
`@property` registrations, the `no-unknown-design-token` allowlist, the `DesignToken`
union, the schema a stored World Theme is written through, and the theme editor's
controls (ADR-0075).

## Where it lives

| File                                                     | Role                                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/web-styles/src/index.css`                          | The `@theme static` block — tier 2, one derivation per role — plus type, radii and fonts, and the elevation `@utility` wrappers.                   |
| `libs/web-styles/src/tokens.css`                         | The two **Palettes** (tier 1), and what `@theme` can't hold: motion, layout rails, elevation, the sheen gradients.                                 |
| `libs/web-styles/src/base.css`                           | Reset, document typography, the flat table background (`@layer base`).                                                                             |
| `libs/web-styles/src/tokens/manifest.ts`                 | The token contract (above).                                                                                                                        |
| `libs/web-styles/src/tokens/design-token-properties.css` | The `@property` registrations, generated from the manifest by `pnpm tokens:generate`.                                                              |
| `libs/plugin-hexmap-web/src/hexmap-tokens.css`           | Tier 3 — the hex map's own vocabulary, derived from tier-2 roles so an Owner's field or ink carries into the map.                                  |
| `apps/web/src/styles.css`                                | Build entry point: self-hosted fonts, then `web-styles`, then each plugin's tier-3 sheet — plus the `@source` scan set, automatic detection off.   |
| `apps/web/src/app/pages/styleguide/`                     | The living `/styleguide` reference page — the one exemption from the tier gates, because rendering every token is what it is for.                  |
| `apps/web-e2e/src/design-tokens.table.json`              | Every declared token's **resolved** value in both ColorSchemes, asserted in a real engine by `design-tokens.spec.ts`. The ground truth for values. |

Primitives (`Button`, `Panel`, `Chip`, `Coord`, …) own their **scoped** styles and
consume the tokens directly (ADR-0007); there is no global component sheet, bar the
menu chrome, which belongs to directives that have no view to scope styles into.
Within those scoped `styles:` blocks, translatable props are expressed with `@apply`
(each component `@reference`s the global sheet); only the custom core — private-var
assignment, `color-mix`, gradients, bespoke transitions — stays raw CSS (ADR-0031).

**Rule for slices:** style from semantic tokens — never hard-code a hex value, and
never reach past tier 2. Ask for a role (`--color-ink`, `--color-accent`,
`--color-tone-3`), not a colour. `hexly-design/no-unknown-design-token` reads the
manifest and enforces the tiers: a component naming a `--palette-*` anchor, or another
plugin's tier-3 token, is an error. Two sibling rules fence the steps the tokens do not
generate — `no-builtin-shadow` (which bakes a light value, ADR-0021) and
`no-builtin-radius` (which ignores an Owner's radius set, ADR-0076). Spacing is
unfenced — it follows Tailwind's defaults (ADR-0030).

### Tailwind

Tailwind v4 is wired in (`@tailwindcss/postcss`, configured in
`apps/web/.postcssrc.json`; `@import 'tailwindcss' source(none)` in `index.css`). Every
utility-shaped token is declared in the `@theme static` block, so the same value both
generates an on-brand utility (`bg-surface`, `text-ink`, `text-accent`,
`border-line-strong`, `font-display`, `rounded-lg`, `text-tone-3`, `gap-5`, `text-md`)
**and** is emitted as a CSS variable on `:root` for scoped component styles to consume
via `var(--…)`. Colours are declared non-`inline` so the emitted `--color-*` carries the
**derivation itself** — which is why `[data-color-scheme='astral']` reassigns the
anchors and not the roles. `static` disables theme-variable tree-shaking so tokens read
only by a Canvas renderer (`getComputedStyle`) or by raw `var(--…)` still resolve.
Spacing uses Tailwind's default linear scale (`calc(var(--spacing) * N)`, 0.25rem base);
every step is open (ADR-0030). Use utilities for slice/shell layout; primitives keep
their scoped styles.

## Typography

| Role               | Family                | Notes                                                                                                                                                |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cartouche          | **Cinzel Decorative** | Engraved Roman caps — the wordmark, worn uppercase. Bundled at 700 only, which is the weight the cartouche wears.                                    |
| Display            | **Marcellus**         | Headings and section eyebrows — an inscriptional Roman face, bundled at 400 only.                                                                    |
| Body / UI          | **Source Serif 4**    | Literary serif drawn for screen text — panels, controls, prose. (Replaced Cormorant Garamond, whose thin display strokes read poorly at body sizes.) |
| Coordinates / code | **JetBrains Mono**    | Hex coordinates (`q · r`), tokens, keys — the signature numeric detail.                                                                              |

All four are self-hosted via `@fontsource`, in the weights and subsets the design uses;
the two critical faces are preloaded with `font-display: optional`, so first paint has
no FOUT. The four `--font-*` tokens are what a curated **font pairing** writes into
(ADR-0076), which is why the pairing is the unit and not a free-form family name.

Type scale is modular (~1.25): `--text-2xs` (11px) → `--text-3xl` (41px). Section
eyebrows use `--tracking-wider` (0.14em) uppercase; the cartouche wordmark takes the
gentler `--tracking-wide`.

## Colour — tier 1, the two Palettes

Authored in `libs/web-styles/src/tokens.css`, and reproduced here because they are the
only colour literals in the system and the only values a reader has to know. Hex,
because that is how an anchor is authored and how it ships — an 8-bit hex is what a
contrast floor has to clear — and the engine reads each one back as the identical
`rgb()` triple, so nothing is lost in the notation.

| Anchor                | What it anchors                         | Solar     | Astral    |
| --------------------- | --------------------------------------- | --------- | --------- |
| `--palette-page`      | The table / outer paper                 | `#f1e5c7` | `#0b0c1a` |
| `--palette-ink`       | Primary text ink                        | `#2e2412` | `#ece3cf` |
| `--palette-ink-quiet` | Secondary ink — **carries its own hue** | `#6f5a36` | `#9aa0c8` |
| `--palette-accent`    | The through-line accent                 | `#8c5e00` | `#d9b25a` |
| `--palette-danger`    | Danger (marginalia)                     | `#a4402e` | `#e88a6f` |
| `--palette-success`   | Confirm / "online"                      | `#4a6f2f` | `#86c46a` |
| `--palette-canvas`    | The map field                           | `#efe2bf` | `#12152e` |
| `--palette-soot`      | Shadow / scrim ink                      | `#3c2c16` | `#02020a` |

| Knob                   | Controls                                                              | Solar   | Astral |
| ---------------------- | --------------------------------------------------------------------- | ------- | ------ |
| `--palette-polarity`   | Scheme polarity (±1): every ramp direction and the paper chroma slope | `1`     | `-1`   |
| `--palette-line-alpha` | Opacity of the drawn-rule ramp                                        | `0.371` | `0.16` |
| `--palette-veil`       | Base opacity of shadows, scrims, and the vignette                     | `0.12`  | `0.5`  |

Two of the eight look redundant and are not. **Quiet ink** is its own anchor because its
hue _rotates_ between the ColorSchemes — sepia by day, lavender-grey by night — and off
the ink anchor at any fixed offset it collapses to grey. **Soot** is its own because
Solar's scrim ink sits _lighter_ than its text ink, so no other anchor reaches it. And
**polarity** is a finding rather than a fitting: Solar and Astral turned out to be mirror
images of each other, and the ±1 asserts that symmetry instead of re-deriving it by hand
each time a colour moves (ADR-0075).

## Colour — tier 2, the semantic roles

Tokens are named by role, and each is **one expression over the Palette above**, not a
value. Which is why this section does not tabulate hexes: 46 roles × 2
ColorSchemes would be a second source of truth that goes stale the moment an anchor
moves, and it would invite the reader to copy a colour rather than ask for a role. What
each role _means_ and how it derives survives a re-anchor; its current hex does not.
The resolved values live in `apps/web-e2e/src/design-tokens.table.json`, measured in a
real browser rather than recomputed.

| Family       | Roles                                                                    | How they derive                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paper        | `bg`, `bg-deep`, `surface`, `surface-raised`, `surface-sunken`           | Lightness steps off `--palette-page`, with chroma sloped against the step. The well sits below the page in Solar and above it in Astral — that swap is what polarity is for.                                                                                      |
| Scrim        | `overlay`                                                                | Soot at a power of the veil. Parented to soot, not the page, because a scrim is dark in **both** ColorSchemes.                                                                                                                                                    |
| Ink          | `ink`, `ink-strong`, `ink-muted`, `ink-faint`                            | `ink` and `ink-muted` are the two ink anchors; `ink-strong` (headings) and `ink-faint` (placeholders, disabled) are one polarity step off them.                                                                                                                   |
| Drawn rules  | `line`, `line-strong`, `line-faint`                                      | The accent at `--palette-line-alpha` × {1, 1.85, 0.44}. Translucent in both ColorSchemes, so a rule takes its colour from what it is drawn over.                                                                                                                  |
| Accent       | `accent`, `accent-strong`, `accent-soft`, `accent-glow`                  | The accent anchor, one polarity step, α 0.14, and the accent lifted to a light-source lightness.                                                                                                                                                                  |
| Accent sheen | `accent-sheen-bright`, `accent-sheen-deep`, `on-accent-sheen`, `on-fill` | The gilded material's two stops ride the **accent's own hue**, so a World anchored to violet does not keep a gold button. The two on-colours are `contrast-color()` pulled 10% back toward their ground, so an on-colour is never pure black or white (ADR-0006). |
| Status       | `danger`, `success` (+ `-soft`)                                          | The two status anchors, each `-soft` at the alpha the two ColorSchemes already agreed on.                                                                                                                                                                         |
| Categorical  | `tone-1…8` (+ `-soft`)                                                   | Hue rotations off `--color-accent`, on two lightness rows — see below.                                                                                                                                                                                            |
| Field        | `canvas-bg`, `canvas-mat`, `canvas-edge`, `canvas-glow`, `ink-stroke`    | The canvas anchor and its gradient's deep stop, the vignette off soot at the veil, and the legibility halo as the page pushed one step away from the ink. `canvas-glow` is the exception — see _Named literals_.                                                  |

Elevation is on the same footing: **one geometry for both ColorSchemes**, scaled by
`--shadow-lift` — the shape is shared, the travel re-themes. The alpha ladder is a _power_
of the veil rather than a multiple of it, and at Astral's veil that power is nearly flat
(α 0.50 → 0.71 across three levels), so the lift is what actually separates them at night:
a near-black shadow on near-black paper reads as offset and blur long before it reads as
darkness. The lift rides the polarity knob — 1 by day, 1.4 by night — and touches levels 2
and 3 only, a 1px shadow having no travel to scale (`--shadow-*`, raw vars wrapped as
`@utility`, ADR-0021).

**The categorical set** (`--color-tone-1…8`, plus `-soft`) is not a secondary and
tertiary accent — it is eight hue rotations off `--color-accent`, whose only job is
mutual distinguishability (ADR-0075). It is eight rather than twelve because the accent
sits _between_ danger and success on the hue circle, leaving one continuous ~161° arc:
cyan → blue → violet → magenta. That arc is the deuteranope confusion line — measured,
the eight collapse to ΔE00 0.2–1.3 under simulation — so **colour here is decoration**:
a chip carries its category in its text, its border, and the Entity Type's icon, never
in the `-soft` fill, whose eight variants sit under a just-noticeable difference apart.
Which type wears which tone is derived from the type id rather than stored, so a chip
and its World Graph node cannot disagree (`typeTone`, ADR-0075).

**Named literals.** Two colours resist derivation and are declared per ColorScheme
instead: `--color-canvas-glow` (`rgba(255, 240, 202, 0.55)` Solar,
`rgba(58, 70, 140, 0.26)` Astral) and the hex map's `--color-terrain-mountain`
(`#b9a489` / `#474264`). Both are a change of _hue_ between the ColorSchemes that the
field's own shift does not account for — two design ideas rather than one parameterised
one, so a formula that hit both anyway would promise a World Owner a generalisation it
does not have (ADR-0075).

## Colour — tier 3, the hex map's own

**Terrain fills** (`--color-terrain-grass|forest|ocean|mountain|desert|sky`) are the
base type of a hex, along with the grid rule and the marker inks
(`--color-hex-line`, `--color-feature-ink`, `--color-label-ink`, `--color-name-ink`).
They live in `libs/plugin-hexmap-web/src/hexmap-tokens.css` and are **out of the public
contract** — a per-World terrain set is its own feature (ADR-0075). Each derives from a
tier-2 role rather than from an anchor, so an Owner's field and ink carry into the map;
the wash that does it is documented beside the values. The one reach past tier 2 in the
whole system is here — `--color-hex-line` takes `--palette-line-alpha`, because no role
spells that knob and a relative colour function destructures a single colour. They stay
`@property`-registered despite being private: the Canvas renderer reads them by name
(ADR-0003).

## Spacing, radius, motion

- **Spacing** — Tailwind's default linear scale, `calc(var(--spacing) * N)` off a
  `0.25rem` base; every step open, no curated keys (ADR-0030). Drives `p-`/`m-`/`gap-`
  utilities; scoped styles take a value as `calc(var(--spacing) * N)`.
- **Radius** — `--radius-sm` (3px) → `--radius-xl` (16px), plus `--radius-full`. Public:
  a World Theme carries its own radius set, which is why `no-builtin-radius` bars the
  Tailwind steps that would silently ignore it.
- **Motion** — durations `--dur-instant/fast/base/slow`; eases `--ease-out`,
  `--ease-in-out`, `--ease-spring`. Reserved for interaction (hovers, presses) and the
  ColorScheme transition — no entrance animation on first render. Respects
  `prefers-reduced-motion`, and deliberately **out** of the World Theme contract: motion
  is a reader's accessibility concern, not an author's to set.

## ColorScheme mechanics

- The active ColorScheme is the `data-color-scheme` attribute on `<html>`.
- `ColorSchemeService` (`libs/web-core/src/services/color-scheme.service.ts`) owns it,
  persists to `localStorage` (`hexly-color-scheme`, unscoped so the pre-paint script can
  read it), roams it via the account bag for a signed-in user (ADR-0038), and falls back
  to the OS preference when unset.
- An inline boot script in `index.html` applies the ColorScheme **before first paint**
  (no flash). An explicit user choice always beats the OS preference.
- Token declarations key off `[data-color-scheme]` on **any** element, not
  `:root[data-color-scheme]` — that widening is what lets `hexlyPalette` read Hexly's own
  anchors past a painted World Theme (ADR-0076).

## World Theme

A World Owner authors a **World Theme** for their World: a Palette per ColorScheme, plus
per-token overrides, a radius set, and a font pairing. What binds it to this document is
that a World Theme and a reader's ColorScheme stay **orthogonal** — the Owner supplies
the Palette, the reader still chooses Solar or Astral within it, which is why an Owner
authors two anchor sets and not one. "One identity at two times of day" survives as a
system property rather than as Hexly's own habit. An operator may set an **Instance
Default Theme** under it, so the chain is instance default → World Theme → the reader's
ColorScheme. The decisions are ADR-0076, the implementable detail is
`world-theme-spec.md`, and the editor lives in
`apps/web/src/app/pages/world/pages/world-settings/`.

## App shell

The chrome slices adopt: a collapsible left **nav rail** carrying the wordmark, the
World switcher and the user menu (`apps/web/src/app/shell/`), a page header on the
`--rail-header` rule, and per-Surface chrome from the plugin that owns the Surface — for
the hex map, a floating Tool palette (Select, Terrain, Feature, Label, Erase) over a
canvas frame rendering the infinite hex plane, and an **inspector** on the selected Hex
(`libs/plugin-hexmap-web/src/components/`).
