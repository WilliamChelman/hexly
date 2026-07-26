# World Theme — implementation spec

The decisions and their justifications live in [ADR-0075](../adr/0075-three-tier-anchor-derived-design-tokens.md) (token architecture) and [ADR-0076](../adr/0076-world-theme-is-untrusted-input-stored-on-the-world.md) (the feature). The fitted numbers live in [`spike-token-derivation.md`](./spike-token-derivation.md) and [`spike-tone-rotation.md`](./spike-tone-rotation.md). This document is the implementable detail and does not re-argue any of it.

Vocabulary is fixed by `CONTEXT.md`: a **World Theme** is what an Owner authors; a **ColorScheme** is `Solar` or `Astral`; a **Palette** is one ColorScheme's anchors.

---

## 1. Tier 1 — the Palette

Eight anchors and three knobs per ColorScheme. Private: `--palette-*` is never referenced outside the derivation block, and the lint rule enforces that.

| Anchor                | Role                                    | Solar     | Astral    |
| --------------------- | --------------------------------------- | --------- | --------- |
| `--palette-page`      | The table / outer paper                 | `#f1e5c7` | `#0b0c1a` |
| `--palette-ink`       | Primary text ink                        | `#2e2412` | `#ece3cf` |
| `--palette-ink-quiet` | Secondary ink — **carries its own hue** | `#6f5a36` | `#9aa0c8` |
| `--palette-accent`    | The through-line accent                 | `#9a6a16` | `#d9b25a` |
| `--palette-danger`    | Danger                                  | `#a4402e` | `#e88a6f` |
| `--palette-success`   | Confirmation                            | `#4a6f2f` | `#86c46a` |
| `--palette-canvas`    | The map field                           | `#efe2bf` | `#12152e` |
| `--palette-soot`      | Shadow / scrim ink                      | `#3c2c16` | `#02020a` |

`--palette-ink-quiet` is a separate anchor and not derivable: `ink-muted` rotates hue between schemes, and derived off `--palette-ink` with any fixed offset it collapses to grey (ΔE00 15.8/15.3). `--palette-soot` is the one anchor that is not already a shipped token — Solar's scrim ink sits _lighter_ than `--palette-ink`, so neither existing anchor reaches it.

| Knob                   | Controls                                                              | Solar   | Astral |
| ---------------------- | --------------------------------------------------------------------- | ------- | ------ |
| `--palette-polarity`   | Scheme polarity (±1): every ramp direction and the paper chroma slope | `1`     | `-1`   |
| `--palette-line-alpha` | Opacity of the drawn-rule ramp                                        | `0.371` | `0.16` |
| `--palette-veil`       | Base opacity of shadows, scrims, and the vignette                     | `0.12`  | `0.5`  |

> The spike calls the polarity knob `--tone`. Renamed here to avoid colliding with the categorical `--color-tone-*`, which are unrelated.

```css
@property --palette-polarity {
  syntax: '<number>';
  inherits: true;
  initial-value: 1;
}
@property --palette-line-alpha {
  syntax: '<number>';
  inherits: true;
  initial-value: 0.371;
}
@property --palette-veil {
  syntax: '<number>';
  inherits: true;
  initial-value: 0.12;
}
```

**Per-ColorScheme cost: 8 anchors + 3 knobs + 1 literal = 12 values**, down from 35.

---

## 2. Tier 2 — the public roles

### 2.1 Rename map

Unchanged (already role-named): `bg`, `bg-deep`, `surface`, `surface-raised`, `surface-sunken`, `overlay`, `ink`, `ink-strong`, `ink-muted`, `ink-faint`, `line`, `line-strong`, `line-faint`, `canvas-bg`, `canvas-mat`, `canvas-glow`, `canvas-edge`, `ink-stroke`, `shadow-1/2/3/inset/focus`.

| Today                                     | Becomes                          | Note                                                                                                     |
| ----------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--color-gold`                            | `--color-accent`                 | 178 call sites                                                                                           |
| `--color-gold-strong`                     | `--color-accent-strong`          |                                                                                                          |
| `--color-gold-soft`                       | `--color-accent-soft`            |                                                                                                          |
| `--color-gold-bright`                     | `--color-accent-sheen-bright`    | a gradient stop, not an ink                                                                              |
| `--color-gold-deep`                       | `--color-accent-sheen-deep`      | **8 misuses as heading ink in `plugin-draw-steel-web` retarget to `--color-accent-strong`**              |
| `--color-on-gilded`                       | `--color-on-accent-sheen`        |                                                                                                          |
| `--color-on-gold`                         | `--color-on-fill`                | its only consumer is danger-hover foreground; the honest role is "foreground on any saturated flat fill" |
| `--color-glow`                            | `--color-accent-glow`            |                                                                                                          |
| `--gradient-gold`                         | `--gradient-accent-sheen`        |                                                                                                          |
| `--gradient-gold-radial`                  | `--gradient-accent-sheen-radial` |                                                                                                          |
| `--color-ember` / `-soft`                 | `--color-danger` / `-soft`       |                                                                                                          |
| `--color-positive` / `-soft`              | `--color-success` / `-soft`      |                                                                                                          |
| `--color-sea`, `--color-astra` (+`-soft`) | `--color-tone-1…8` (+`-soft`)    | see §2.3                                                                                                 |

### 2.2 Derivation

Every role is one CSS expression, **byte-identical in both ColorSchemes** — only anchors and knobs differ. The authoritative per-token table (expression, derived value, target, ΔE00, both schemes) is §2 of `spike-token-derivation.md` and is not duplicated here.

Policy, from ADR-0075:

- A token whose expression needs a knob used **affinely** (scale _and_ offset) is not a derivation — it is two literals in disguise, exact by construction. Re-parent it to a single-coefficient form where possible; otherwise make it a named literal.
- Re-parenting targets: `overlay` → `--palette-page`; `on-accent-sheen` → `contrast-color()`; `shadow-2/3/inset` → one ink anchor, once geometry is unified (§2.4).
- **Named literals**: `canvas-glow` (two different design ideas — a warm highlight of the same paper in Solar, a different-hue light source in Astral; 5× lift mismatch), plus anything above that resists re-parenting.

### 2.3 The categorical tones

Eight tones, derived by hue rotation off `--color-accent`, in the ~161° arc left by excluding the danger and success hues.

```css
--color-tone-1: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 113));
--color-tone-2: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 136));
--color-tone-3: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 161));
--color-tone-4: oklch(from var(--color-accent) calc(l * 0.95) c calc(h + 193));
--color-tone-5: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 207));
--color-tone-6: oklch(from var(--color-accent) calc(l * 0.95) c calc(h + 230));
--color-tone-7: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 250));
--color-tone-8: oklch(from var(--color-accent) calc(l * 0.95) c calc(h + 270));
--color-tone-N-soft: oklch(from var(--color-tone-N) l c h / 0.14);
```

Min pairwise ΔE00 10.9 (Solar) / 10.8 (Astral); all ≥ 4.5:1 on `--color-surface`. The `l` multiplier is **not** optional — at the accent's own lightness, 9 of 12 candidate tones fall under 4.5:1 in Solar, and `--color-gold` itself ships at 4.37:1 today.

Consequences that are part of this spec, not optional polish:

- **`-soft` fills are not category-bearing** (min pairwise ΔE00 1.4). `chip.component.ts` must carry identity in **text and border**; the fill is a neutral tint.
- **`ChipTone` becomes `'accent' | 'tone-1' … 'tone-8'`** (11 call sites).
- **Chips render the Entity Type's `icon`** alongside the label. `TypeDefinition.icon` already exists. This is the non-colour channel that makes categories legible under deuteranopia, where no rotation set above ~4 tones separates.
- **Tone assignment is a deterministic hash of the type id**, with an explicit per-type override, so plugins cannot collide.

### 2.4 Two deliberate behavioural changes

- **Solar `line` and `line-strong` go opaque → translucent.** The ramp becomes one rule in both schemes (`--palette-accent` at `--palette-line-alpha × {1, 1.85, 0.44}`). Solar's rules become backdrop-sensitive: they match today's values over `surface` (ΔE00 0.81) and diverge over other backdrops (up to ΔE00 11.5 over `bg`). Accepted as the better rule.
- **Shadow geometry is unified across ColorSchemes.** Today's Astral/Solar offset ratios are 1.0, 1.5, and 1.375 — no single scale knob can be all three, and the divergence reads as drift. Only shadow _colour_ and _alpha_ re-theme.

---

## 3. Tier 3 — the plugin move

**Prerequisite, done in #359:** no plugin lib was named by an `@source` glob; Tailwind's automatic detection covered them by walking the whole workspace. `source(none)` plus globs for every browser library make the scan set declared, which is what the move needs.

Moving to `plugin-hexmap-web`: `hex-line`, `feature-ink`, `label-ink`, `name-ink`, and `terrain-{grass,forest,ocean,mountain,desert,sky}`. Deleted: `--color-terrain-marsh` and its `styleguide.page.ts:615` entry. Staying in core tier 2: `canvas-*` (a design-system concept with two plugin consumers) and `ink-stroke` (also used by `plugin-content-web`).

Terrain colours leave the public contract with the move. A per-World _terrain set_ is a change to `terrainIdSchema` and a separate feature.

`terrainPalette` in `hex-map.ts` renames to `terrainSet` to clear the third "palette" collision.

---

## 4. The manifest

One TS module, the single source for the contract. Generates: the `@property` block, the zod schema at the write choke point, the `no-unknown-design-token` allowlist, the `DesignToken` union type, and the theme editor's controls.

```ts
type Tier = 'palette' | 'role' | 'plugin';
type TokenType = 'color' | 'number' | 'length' | 'font-pairing';

interface TokenDecl {
  readonly name: string; // '--color-accent'
  readonly tier: Tier;
  readonly type: TokenType;
  readonly public: boolean; // in the World Theme contract
  readonly owner?: string; // plugin id, for tier 3
  readonly initial: string; // @property initial-value
}
```

`DesignToken` is the union of every declared `name`. Typing `TypeDefinition.graphColorToken: DesignToken` is what closes the **71 bare-string token references** (`graphColorToken: '--color-astra'`, `terrainSet`'s `fill:`, spec fixtures) that `no-unknown-design-token` structurally cannot see, because it matches only `var(--…)`. `graph-palette.ts`'s hardcoded hex fallbacks have the same failure mode and should be dropped or generated.

Lint changes: the rule reads the manifest instead of grepping CSS, and gains tier awareness — a component referencing `--palette-*`, or another plugin's tier-3 token, is an error.

The **styleguide is the one exemption from the tier gates**, named in the rule itself: rendering every token in the system, anchors and plugin vocabulary included, is what that page is _for_. It still answers to the manifest, so a token it renders has to exist. The exemption is what lets the terrain swatches sit in `apps/web` while their CSS is still in core; §3's move takes them out of the app for the reason §3 gives, not to satisfy the linter.

Reading the manifest makes it a lint input for every project, and the plugin libs do not otherwise depend on `web-styles` — so it joins `eslint-rules/*.mjs` in Nx's `sharedGlobals`. Renaming a token has to turn a cached lint red; a fence a contributor clears by not touching the file is not one.

---

## 5. The World Theme

### 5.1 Storage

A `theme` column on the World record, patched wholesale through `PATCH /worlds/:id` alongside `name` and `pinnedEntityIds`. `null` clears it.

```ts
const paletteSchema = z.object({
  page: colorToken,
  ink: colorToken,
  inkQuiet: colorToken,
  accent: colorToken,
  danger: colorToken,
  success: colorToken,
  canvas: colorToken,
  soot: colorToken,
  polarity: z.number(),
  lineAlpha: z.number(),
  veil: z.number(),
});

const worldThemeSchema = z.object({
  version: z.literal(1),
  solar: paletteSchema,
  astral: paletteSchema,
  radii: radiiSchema.optional(),
  fontPairing: z.enum(FONT_PAIRING_IDS).optional(),
  overrides: z
    .object({
      // tier-2 opt-outs, per ColorScheme
      solar: z.record(designToken, tokenValue).optional(),
      astral: z.record(designToken, tokenValue).optional(),
    })
    .optional(),
});
```

`colorToken` **parses and re-serialises** to a canonical `oklch(…)`. This is the security boundary: `url()` is not a colour and never round-trips, which is what stops an Owner exfiltrating anonymous Public Link visitors' IPs through `background: var(--gradient-accent-sheen)`.

`version` exists because every public token is a compatibility commitment; renaming or removing one is a migration against stored themes.

### 5.2 Resolution and application

Chain: **instance default (ADR-0036 config YAML, ships empty) → World Theme → reader's ColorScheme.**

- Applied at `:root` via `documentElement.style.setProperty`, never a `<style>` block and never a subtree — CDK overlays portal to `<body>`.
- The applier writes the **active ColorScheme's** anchors and overrides, and re-writes on toggle. `ColorSchemeService` owns the toggle.
- Applied synchronously in the world-scope resolver. Last-applied theme cached in `localStorage` keyed by world id, so a hard reload into a World is flash-free. A flash on _first_ entry to a World is inherent — the pre-paint script in `index.html` cannot know the world before routing resolves.
- Token declarations key off `[data-color-scheme]` **on any element**, not `:root[…]`, so the editor's probe (§5.3) works.
- Served on the **unauthenticated** World read path; Public Link visitors need it.
- A theme edit bumps `seq`, so live-follow (ADR-0044/0045) re-applies without a refresh.

### 5.3 Contrast reporting

No maths is reimplemented in TS. The reporter renders an offscreen probe carrying `[data-color-scheme]` and the candidate anchors inline, then reads resolved values with `getComputedStyle` — which returns _used_ values for `@property`-registered `<color>` properties, so relative colour syntax and `contrast-color()` come back absolute. The report therefore matches what renders, by construction, and covers the ColorScheme the author is not currently looking at.

- **On-colours flip automatically** via `contrast-color()`. Silent, no UI.
- **Warn, never block**: `ink`/`ink-muted`/`accent` against `surface` and `bg`, with the computed ratio shown.
- **Mid-tone accent warning.** `contrast-color()` returns only black or white and is blind to mid-tones (MDN's own example, `#2277d3`, yields unreadable black). The probe makes it detectable: if both black and white fail, say so — "this accent is mid-tone; no automatic text colour is readable — pick lighter or darker."
- **Tone collision check.** The exclusion arc was computed against Hexly's accent hue. An Owner's accent rotates all eight tones, so the report flags any tone within the confusability threshold of `--color-danger` or `--color-success`.

### 5.4 Fonts

A curated pairing set: `{ id, display, body, cartouche, mono }`, chosen from bundled `@fontsource` families. Today's set is one entry (`codex`). Additional pairings are a design task, not specified here. Uploaded fonts are out of scope; the token shape (`--font-display`, `--font-body`) is unchanged either way, so opening it later is additive.

---

## 6. Out of the contract

Type scale, layout rails (`--rail-*`, `--container-reading`), and motion (`--dur-*`, `--ease-*`) are **not public**. They remain tokens; they are not themeable. Motion is a reader accessibility concern (`prefers-reduced-motion`), not an Owner's to set.

---

## 7. Verification

**Token snapshot test.** Read `getComputedStyle(document.documentElement)` for every registered token in both ColorSchemes and assert against a committed table. This is the only net for the "Solar and Astral go through the derivation path" condition — `apps/web-e2e` has 57 specs and zero visual or snapshot assertions today. It also exercises the exact resolved-value path the contrast reporter depends on, so the test and the mechanism are the same thing.

It ships as `apps/web-e2e/src/design-tokens.spec.ts`, and the table it asserts is `apps/web-e2e/src/design-tokens.table.json` — every _declared_ token (not only the registered ones), keyed by name, each carrying its `solar` and `astral` resolved value. The derivation work's diff to that file is the list of colours it moved. Regenerate it with `UPDATE_TOKEN_TABLE=1`, and read the diff rather than waving it through: a token that starts reading back as its raw declaration would land in the table as one, and the spec's own resolution check is what stops that being committed quietly.

**Nine public tokens sit outside that check, and the derivation work has to read their rows by eye.** `--shadow-1/2/3/inset/focus` and the four `--font-*` cannot be `@property`-registered — Properties & Values has no shadow or font-stack syntax component — so they read back as the token stream the stylesheet wrote, and the spec records them without asserting a shape. It asserts the one thing it can, that nothing reads back still carrying a `var()`. §2.2's re-parenting of `shadow-2/3/inset` onto an ink anchor therefore lands in the table as whatever expression survives substitution, which is legitimate for a `box-shadow` (the engine evaluates it at use) and would not be for anything a Canvas renderer reads. None of the nine is.

Acceptance for the derivation work: a third theme authored as 12 values per ColorScheme looks right across the app.

---

## 8. Known open items

- **The eight tones' two lightness rows invert visual weight between ColorSchemes** — an `l*0.8` tone reads heavier on Solar's ivory and lighter on Astral's indigo, so a category's emphasis ordering flips on toggle. The seven-tone iso-lightness set (`calc(l * 0.9)`, §"If pure hue rotation matters" in the tone spike) removes this at the cost of one tone. One-line swap.
- **`contrast-color()` is the newest primitive used** (Baseline newly available, April 2026) and has exactly one consumer, `--color-on-fill`. If it has to go, that token takes its two literals back or becomes a ninth anchor.
- **`ink-stroke` is the worst symmetric fit** (ΔE00 2.69/2.75) and is legibility-critical over arbitrary terrain. Literal-override it if the repaint reads badly.
- **`surface-sunken` is parented to `--palette-page`, not `surface`** — fitted to the numbers rather than derived from the design rule, because against `surface` the two schemes' offsets differ by 2.6×. Flagged so nobody "fixes" the parent later and wonders why it breaks.
