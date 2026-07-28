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
| `--palette-accent`    | The through-line accent                 | `#8c5e00` | `#d9b25a` |
| `--palette-danger`    | Danger                                  | `#a4402e` | `#e88a6f` |
| `--palette-success`   | Confirmation                            | `#4a6f2f` | `#86c46a` |
| `--palette-canvas`    | The map field                           | `#efe2bf` | `#12152e` |
| `--palette-soot`      | Shadow / scrim ink                      | `#3c2c16` | `#02020a` |

`--palette-ink-quiet` is a separate anchor and not derivable: `ink-muted` rotates hue between schemes, and derived off `--palette-ink` with any fixed offset it collapses to grey (ΔE00 15.8/15.3). `--palette-soot` is the one anchor that is not already a shipped token — Solar's scrim ink sits _lighter_ than `--palette-ink`, so neither existing anchor reaches it.

**Amended after the epic.** Solar's accent was `#9a6a16` (OKLCH L 0.5610) through #359–#376 and is now `#8c5e00` (L 0.5185) — only lightness moves, the hue and chroma are the heliograph gold's own. §5.3's report warned on Hexly's _own_ Palette, which is the one Palette a World Owner never chose and cannot be blamed for: 3.77:1 against the page and a mid-tone warning at 4.16:1. It clears both: the page pair reaches **4.51:1** and the automatic foreground on it **4.93:1**. The anchor moves ΔE00 4.77 and carries every role derived from it, the eight tones included (§2.3). Astral is untouched; it passes at 9.68:1.

The value is quantised on purpose. `#8d5e00` is what the unquantised OKLCH target rounds to and it measures **4.4923:1** — 0.008 under the floor, close enough to read as a pass on paper and warn in the app. A colour ships as an 8-bit hex, so the hex is what has to clear it.

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

**Amended in implementation (#366).** The re-parenting landed, and two of the three targets moved somewhere other than where this section pointed. Both are measured rather than preferred:

- **`overlay` stays on `--palette-soot`.** The affine knob was its _alpha_, and moving the colour does not remove that. A scrim is dark in **both** ColorSchemes, so it is the one paper role the polarity knob cannot carry: parented to `--palette-page` it costs ΔE00 2.28/4.57 against the values it ships as today, where the soot anchor costs 1.83/2.34. What escapes the affine form is the alpha, `calc(pow(var(--palette-veil), 0.44))`.
- **The veil ladder is a power of the knob, not a multiple of it.** `shadow-1/2/3` take exponents 1, 0.75 and 0.5, which the two ColorSchemes agree on to within 3% — a mirror symmetry of the same species as the polarity finding, and the reason the ladder needs no offset. A multiple cannot do it: it would have to be 1.67 in Solar and 1.2 in Astral, and Astral's `shadow-3` would land at α 0.98. `shadow-inset` is not on the ladder and takes `shadow-1`'s own alpha. This adds `pow()` to the three colour primitives named above; it is Baseline widely available (Chrome 111, Safari 15.4, Firefox 118). What the fit does not say is that the ladder it fits is nearly flat in Astral — see §2.4, where that is what `--shadow-lift` answers.
- **`on-accent-sheen` resists.** Its two shipped values are ~ΔE00 10 apart and no shared expression reaches within 3 of both — the best balance is 5.71/5.00. It is derived anyway rather than made a named literal, because the sheen it sits on follows the accent and a frozen ink would not.

**Amended after the epic.** `accent-sheen-bright` was shipped with a literal chroma _and_ a literal hue, which the derivation spike had already called what it was — a theme-invariant constant, §5 there — and which the editor nonetheless listed as "Derived". Three passes of the epic put a **gold** sheen on the primary button of a World anchored to violet. The hue now rotates off the accent's own, `calc(h + 9.5)`; lightness and chroma stay clamped, so the stop still resists a dark accent, which is what the clamp is for. No one rotation reproduces both stops — Solar's accent hue is 75.0° and Astral's 85.6°, while both shipped stops sit at hue 90 — so +9.5° is a balance, not a fit: it repaints Solar `#f0d488 → #f4d288` (ΔE00 1.92) and Astral `#f0d488 → #ebd688` (2.17), both inside the ΔE00 2.91 the tier-2 fit accepted. The two stops are no longer the same colour in both ColorSchemes, which was the tell that the token was not deriving.

**Amended after review.** The six paper offsets (`bg-deep`, `surface`, `surface-raised`, `surface-sunken`, `canvas-mat`, `ink-stroke`) fold at the boundary rather than running off it: `calc(1 - abs(1 - abs(l ± k)))`. A page anchor near white or black used to collapse them onto `--color-bg` — at `#ffffff`, `bg`, `surface` and `surface-raised` all resolved to `oklch(1 …)`. A fixed `clamp()` cannot do this job: Solar's page already sits 0.0763 below white while the ramp's top step is +0.067, so any ceiling that separates at `#ffffff` also repaints Hexly's own surfaces. The fold keeps the ramp's exact spacing, mirrors it only where there is no room, and is inert wherever it fits — the committed table is byte-identical. At the extreme the mirror can invert the ramp's order (a white page puts `bg-deep` lighter than `surface`); every role stays distinct, and no arrangement both keeps the offsets' sign and separates them there. This adds `abs()` to the primitives named above; it is Baseline newly available (Chrome 133, Safari 15.4, Firefox 118) and was verified resolving inside relative-colour channels in all three engines.

**`--color-on-accent-sheen`'s mix goes 86% → 90%, and that is this change's own doing.** The ink is one token serving both ends of the gradient, and the deep stop moves down with the anchor while the bright stop is clamped and does not — so the pair that binds is the ink against the **deep** stop, which no check in §5.3 reads. It shipped at 4.98:1, fell to **4.26** under the darker anchor, and reaches **4.63** at 90%; Astral goes 5.99 → **6.58**, and against the bright stop both rise to ~12.5. The flip stays on the bright stop deliberately: `max(l, 0.876)` is the only clamp in the material, so it is the only place `contrast-color()` answers the same way for every accent. Parented to the deep stop the ink would flip white for a dark enough accent and then be unreadable at the bright end. The ink is `#18150e` — darker than the `#221e13` that ships, ΔE00 4.06 / 4.22, and still a warm brown rather than the black ADR-0006 forbids.

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

Min pairwise ΔE00 10.9 (Solar) / 10.8 (Astral); all ≥ 4.5:1 on `--color-surface`. The `l` multiplier is **not** optional — at the accent's own lightness, 9 of 12 candidate tones fall under 4.5:1 in Solar, and `--color-gold` shipped at 4.37:1 when this was written (see the amendment below).

Consequences that are part of this spec, not optional polish:

- **`-soft` fills are not category-bearing** (min pairwise ΔE00 1.4). `chip.component.ts` must carry identity in **text and border**; the fill is a neutral tint.
- **`ChipTone` becomes `'accent' | 'tone-1' … 'tone-8'`** (11 call sites).
- **Chips render the Entity Type's `icon`** alongside the label. `TypeDefinition.icon` already exists. This is the non-colour channel that makes categories legible under deuteranopia, where no rotation set above ~4 tones separates.
- **Tone assignment is a deterministic hash of the type id**, with an explicit per-type override, so plugins cannot collide.

**Amended in implementation (#368).** The set shipped exactly as written, and the engine's resolved values were measured rather than assumed: min pairwise ΔE00 **10.6 Solar / 11.0 Astral** on the text colour (predicted 10.9 / 10.8), **3.7 / 5.3** on the border at 36% (predicted 3.7 / 5.3), **1.3 / 2.1** on the `-soft` fills composited over `surface` (predicted 1.2 / 1.9); every tone clears 4.5:1 as text on `--color-surface` in both schemes (4.83–7.29 / 4.70–7.67). Under a deuteranope simulation the eight collapse to **0.2–1.3**, which is the finding the icon channel exists for and not a defect in the placement. Two details this section left open:

- **`typeTone(def)`** (`libs/web-entity/src/models/type-tone.ts`) is the assignment. Its digest is FNV-1a plus murmur3's finaliser: eight tones means a `% 8` bucket that reads only the low three bits, and unmixed those bits follow the id's last characters — which is exactly where two plugins' type ids agree (`dnd.type.monster` / `draw-steel.type.monster`). A type pins its tone with `tone: 'tone-6'` on its `TypeDefinition`, and a type naming no `graphColorToken` paints its graph node that same tone, so a chip and a node cannot disagree.
- **A collision is never forced, so it is never shipped.** Eight tones against six registered types means two chips rendering alike is a defect a reader sees, not an unavoidable one. `dnd.type.monster` pins off the tone `core.type.asset` derives and `draw-steel.type.monster` off `core.type.board`'s; the other four take their derived tone. `apps/web/src/app/entity-types/type-tones.spec.ts` asserts the whole registered set is mutually distinct — that spec, not the pins, is what makes the next colliding id loud rather than silent, and it names both offenders when it fails.
- **`accent` is declarable but never derived.** A type that hashed onto the through-line accent would read as the primary one.

**Amended after the epic.** §1's darker Solar anchor moves all eight Solar tones, and the trade runs the way the two lightness rows predict: contrast up, separation down. Solar's min pairwise ΔE00 on the text colour holds at **10.6 → 10.0** (the tightest pair moves from tone-2 ↔ tone-3 to tone-5 ↔ tone-6), still over the spike's own acceptance bar of 10; the border at 36% goes 3.7 → 3.6 and the `-soft` fills 1.3 → 1.2, both already below a JND and neither carrying identity. Bought with it: every Solar tone rises to **5.8–8.4** on `--color-surface` (was 4.8–7.3), and chip text on its own `-soft` fill clears AA at **4.7–6.6** where it sat at 4.02 — the pre-existing 11px debt §5 of the tone spike flagged and could not pay. Status separation holds at ΔE00 21.0, so no tone trips the collision check. Astral is unmoved on every one of these. The assignment is a hash of the type id, so which type wears which tone is untouched.

**Amended after review — the arc is gone.** The eight tones now span **252°** of the wheel (offsets +81 to +333, 36° apart) rather than the 157° arc this section fits them into, so the set carries greens, yellows, oranges and browns instead of reading as one blue-purple family. Three things made that possible, in order:

- **The status chips were failing AA and nothing measured it.** `chipWarnings` read the eight tones alone, so `bg-danger-soft` with `text-danger` — the same component, rendered in the Draw Steel stat block — was never checked. Three of eight Solar pairs sat under the floor, worst **3.80:1**. The check now reads `[...TONES, ...STATUS_ROLES]`, and the warning's field is `ink` rather than `tone` because a status chip is not a category.
- **The status anchors moved to answer it.** Solar's `danger` `#a4402e → #a21b01` and `success` `#4a6f2f → #325e01`, both darker and ~1.3× more chromatic; Astral's `#e88a6f → #fe7a54` and `#86c46a → #71ca42`, ~1.4×. Worst status chip **3.80 → 4.55**. Each moves ΔE00 ~6–7.
- **The collision bar came down, 20 → 10.** A shy status colour occupies a wide perceptual neighbourhood; intensifying the two anchors is what let the bar fall without tones actually reading as errors. Measured on the **gamut-mapped** colours the engine paints, the eight now clear it by 2.1.

Min pairwise ΔE00 goes **8.2 → 12.8** (+57%), worst chip AA is unchanged at **4.81**. Both figures are measured after gamut mapping — the earlier ones in this document were not, and five of Hexly's sixteen tone/scheme pairs were already being clipped.

The eight rows derive from **`--palette-accent`**, not from `--color-accent` as written above. `--color-accent` is itself a public tier-2 role, so an Owner overriding it reached sixteen further tokens through the tones — a cascade where §5.1 promises a leaf opt-out. Every sibling role already read the anchor; these were the exception. The rows also gain `clamp(0.25, …, 0.85)` on the lightness, so an anchor at either extreme cannot collapse the set onto the ground it sits on. Neither change moves a shipped value: all 113 rows of the committed table are byte-identical, because both bounds are inert on Solar and Astral by construction.

### 2.4 Two deliberate behavioural changes

- **Solar `line` and `line-strong` go opaque → translucent.** The ramp becomes one rule in both schemes (`--palette-accent` at `--palette-line-alpha × {1, 1.85, 0.44}`). Solar's rules become backdrop-sensitive: they match today's values over `surface` (ΔE00 0.81) and diverge over other backdrops (up to ΔE00 11.5 over `bg`). Accepted as the better rule.
- **Shadow geometry is unified across ColorSchemes.** Today's Astral/Solar offset ratios are 1.0, 1.5, and 1.375 — no single scale knob can be all three, and the divergence reads as drift. Only shadow _colour_ and _alpha_ re-theme.

**Amended in implementation.** Unifying the geometry outright was the wrong half of the finding. The three ratios were 1.0/1.5/1.375 because level 1 has no travel to scale — at `0 1px 2px` there is nothing for a multiplier to move — so the two that _are_ scalable agree to within 9%, and a single knob does fit them. Dropping the geometry left Astral's elevation on the alpha ladder alone, and at its veil that ladder is nearly flat: `pow(v, k) → 1` as `v → 1`, so 0.5 becomes α 0.500 / 0.595 / 0.707 across three levels — ×1.19 a step, against Solar's ×1.70. A near-black shadow on near-black paper reads as offset and blur long before it reads as darkness, so the flat ladder had nothing left to carry. `--shadow-lift` restores it as one role: `calc(1.2 - 0.2 * var(--palette-polarity))`, so 1 by day and 1.4 by night, scaling the offset, blur and spread of levels 2 and 3. Level 1 and the inset well stay off it, which is what made the third ratio 1.0 in the first place. Astral's `shadow-3` lands at `0 22.4px 50.4px -11.2px`, within a pixel of the `0 22px 48px -10px` it shipped as. Riding the polarity knob rather than a fourth tier-1 one: polarity already _is_ the mirror axis, no new anchor means no Palette field, no schema version and no migration, and a World Owner who moves it moves the elevation with it — which is the same statement in both.

---

## 3. Tier 3 — the plugin move

**Prerequisite, done in #359:** no plugin lib was named by an `@source` glob; Tailwind's automatic detection covered them by walking the whole workspace. `source(none)` plus globs for every browser library make the scan set declared, which is what the move needs.

Moving to `plugin-hexmap-web`: `hex-line`, `feature-ink`, `label-ink`, `name-ink`, and `terrain-{grass,forest,ocean,mountain,desert,sky}`. Deleted: `--color-terrain-marsh` and its `styleguide.page.ts:615` entry. Staying in core tier 2: `canvas-*` (a design-system concept with two plugin consumers) and `ink-stroke` (also used by `plugin-content-web`).

Terrain colours leave the public contract with the move. A per-World _terrain set_ is a change to `terrainIdSchema` and a separate feature.

`terrainPalette` in `hex-map.ts` renames to `terrainSet` to clear the third "palette" collision.

**Amended in implementation (#369).** The ten declarations live in `libs/plugin-hexmap-web/src/hexmap-tokens.css`, named by `apps/web/src/styles.css` after `web-styles`; the `@property` registrations stay generated from the manifest, a registration being document-wide. They derive from the **tier-2 roles**, not from the anchors — the plugin reaches the tier directly above it, so an Owner's override of the field or the ink carries into the map — with one tier-1 reach, `--palette-line-alpha` in `hex-line`, because no role spells that knob and a relative colour function destructures a single colour. Five of the six terrains are a pigment half-washed into `--color-canvas-bg`, one ratio for all five: fitted per terrain the ratio lands between 42% and 53%, and the same-cost form riding the polarity knob instead of the field misses by ΔE00 7.0, so these values track the _field_. **`--color-terrain-mountain` is a named literal per ColorScheme**, on `--color-canvas-glow`'s precedent — warm tan by day and violet by night is a change of hue the field's own shift does not account for, so no one pigment sits at both ends of the wash, and a formula that hit both anyway would promise a World Owner a generalisation it does not have. The repaint costs ΔE00 ≤ 3.1 on eight of the ten and 4.4 on forest; mountain is unchanged. Re-fitting the ratio over the five that now use it moves the max-min optimum to 46%, which lowers the worst value to 3.34 but puts seven of the ten over the 2.91 the tier-2 fit accepted, against three at 50% — so the ratio stays put, and the per-terrain optima average 48.6% either way. `manifest.spec.ts` reads `libs/plugin-*-web/src/<owner>-tokens.css`, so a second plugin inherits the join by naming its file that way. The styleguide keeps its terrain swatches under the §4 exemption, now held to `terrainSet` by a spec — nothing held the two together when the marsh swatch outlived its terrain.

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

`DesignToken` is the union of every declared `name`. Typing `TypeDefinition.graphColorToken: DesignToken` is what closes the **71 bare-string token references** (`graphColorToken: '--color-astra'`, `terrainSet`'s `fill:`, spec fixtures) that `no-unknown-design-token` structurally cannot see, because it matches only `var(--…)`. `graph-colors.ts`'s hardcoded hex fallbacks had the same failure mode and are gone — it reads the resolved tokens instead.

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

The instance layer is a `theme` block in `hexly.yml` (#372), shaped as §5.1's schema with every field optional and `version` still required — an operator branding only their accent writes `solar.accent` and `astral.accent`. It is parsed at boot by the same `instanceThemeSchema`/`canonicalTokenValue` path an Owner's Theme is written through, refused **whole** on any bad or unknown key _within the block_ — a misspelled `theme:` itself is stripped like any top-level key (ADR-0052), which `profile:` needs and this cannot have both ways — and served on the unauthenticated `GET /api/config`. The browser lays it as the applier's first layer; because the config channel is a fetch, `INSTANCE_THEME_READY` holds the applier's app initializer until it settles — Angular starts initializers in order but awaits them together, so provider ordering alone would not have done it. What it does **not** get is a pre-paint replay: `index.html` writes only a World's cached Theme, so outside a World an operator's branding lands only once `/api/config` resolves. The unscoped `localStorage` key ADR-0076 reserves for it is the fix, unspent.

- Applied at `:root` via `documentElement.style.setProperty`, never a `<style>` block and never a subtree — CDK overlays portal to `<body>`.
- The applier writes the **active ColorScheme's** anchors and overrides, and re-writes on toggle. `ColorSchemeService` owns the toggle.
- Applied synchronously in the world-scope resolver. Last-applied theme cached in `localStorage` keyed by world id, so a hard reload into a World is flash-free. A flash on _first_ entry to a World is inherent — the pre-paint script in `index.html` cannot know the world before routing resolves.
- Token declarations key off `[data-color-scheme]` **on any element**, not `:root[…]`, so the editor's probe (§5.3) works.
- Served on the **unauthenticated** World read path; Public Link visitors need it.
- A theme edit bumps `seq`, so live-follow (ADR-0044/0045) re-applies without a refresh.

### 5.3 Contrast reporting

No maths is reimplemented in TS. The reporter renders an offscreen probe carrying `[data-color-scheme]` and the candidate anchors inline (**superseded — the probe is the document root; see the amendment below**), then reads resolved values with `getComputedStyle` — which returns _used_ values for `@property`-registered `<color>` properties, so relative colour syntax and `contrast-color()` come back absolute. The report therefore matches what renders, by construction, and covers the ColorScheme the author is not currently looking at.

- **On-colours flip automatically** via `contrast-color()`. Silent, no UI.
- **Warn, never block**: `ink`/`ink-muted`/`accent` against `surface` and `bg`, with the computed ratio shown.
- **Mid-tone accent warning.** `contrast-color()` returns only black or white and is blind to mid-tones (MDN's own example, `#2277d3`, yields unreadable black). The probe makes it detectable: if both black and white fail, say so — "this accent is mid-tone; no automatic text colour is readable — pick lighter or darker."
- **Tone collision check.** The exclusion arc was computed against Hexly's accent hue. An Owner's accent rotates all eight tones, so the report flags any tone within the confusability threshold of `--color-danger` or `--color-success`.

**Amended in implementation (#373).** Four corrections, each one the section could not have known without an engine:

- **The probe is the document root, not an offscreen element.** ADR-0076's widened `[data-color-scheme]` selector reaches only what `tokens.css` declares — tier 1, plus the raw roles `@theme` cannot hold — and not the _derived_ roles, which `@theme static` declares once at `:root`; a registered custom property computes _where it is declared_, so an offscreen probe re-declares `--palette-*` and inherits the root's already-derived `--color-*` (found in #370, pinned in `world-theme.spec.ts`). The reporter sets the root's `data-color-scheme` and the candidate declarations, forces one `getComputedStyle` read, and restores, all inside one task: no paint happens inside a task, so it is flash-free, and it costs no CSS. The alternative was re-declaring ~35 expression holders per `[data-color-scheme]`. `design-tokens.spec.ts` holds the measurement to the committed table's _other_ column.
- **The report is measured over the whole resolved chain**, not the anchors — a tier-2 override is exactly what an Owner reaches for when a derived role is wrong, and it must be in what is judged. The root's existing inline properties are cleared for the measurement, or the inactive scheme would be read wearing the active one's overrides.
- **"If both black and white fail" cannot fire.** Pure black or white on the worst possible ground still reaches 4.58:1. What renders is `--color-on-fill` — the better of the two pulled 10% back toward the ground (§2.2) — and that bottoms out at 3.86:1, so the check reads the resolved on-colour against the accent. Hexly's own Solar accent trips it at 4.16:1, and its 3.77:1 against the page: both true, and consistent with ADR-0075's note that the accent ships at 4.37:1.
- **The body pairs are five, not six.** Both inks against both grounds, and the accent against `bg` alone — ADR-0076's Decision bullet and #373 both name the accent only where a link sits on the page. `accent`×`surface` would be a policy change rather than a tightening.

**Amended after the epic.** The report finding Hexly's own Palette wanting is the report working, and both halves of what it found are answered in §1 — the anchor moved, and the 40 `text-accent` call sites were sorted into ink — 27 to `text-accent-strong`, which already cleared AA — and decoration, the 13 icons, checkmarks, wordmarks, fills and borders that keep `text-accent` — the sharpest of them the accent chip's own 11px label, which reads 4.35:1 on its 12% fill at `text-accent` and 6.24 at `-strong`. Both warnings clear: the accent reaches **4.51:1** against the page from 3.77, and `--color-on-fill` on it **4.93:1** from 4.16. **The report is silent on an untouched World in both ColorSchemes**, which is the first time it has been.

The tone check uses the spike's own ΔE00 20 (§2 of `spike-tone-rotation.md`) between the rendered tone and the rendered status colour. Hexly's eight clear it by 0.58 at the tightest, which is thin by construction — the exclusion arc was placed at that threshold. CIEDE2000 is the one piece of colour maths written in TS; CSS cannot express it, and it is unit-covered.

### 5.4 Fonts

A curated pairing set: `{ id, display, body, cartouche, mono }`, chosen from bundled `@fontsource` families. Today's set is one entry (`codex`). Additional pairings are a design task, not specified here. Uploaded fonts are out of scope; the token shape (`--font-display`, `--font-body`) is unchanged either way, so opening it later is additive.

### 5.5 Copying from another World

**Built in #376.** ADR-0076's reuse story — "a duplicate, not a link" — as three decisions the ADR did not have to make.

- **Which Worlds are on offer is an authorisation answer, not a filter.** `GET /worlds/:id/theme-sources` is Owner-gated on `:id` like every other theming route, and its rows come from `worldOwnerFilter` — the caller's _personal_ ownership, no Superadmin bypass — with `:id` itself excluded. A World the caller merely reads is **withheld**, so a client that skips the picker and reads the endpoint raw learns nothing more than the picker showed. The alternative, putting `theme` on `WorldSummary` and letting the picker keep the rows whose `rights` carry `manage`, ships every reachable World's Theme to a client that must then be trusted to drop most of them.
- **A World carrying no Theme is not offered.** It has nothing to copy, so the row would be a no-op with a name on it; the empty offer reads as its own state ("none of your other worlds carries a theme yet") rather than as an empty dropdown. This also means "nothing to copy from" is one shape whether the Owner has no other Worlds or no other _themed_ ones.
- **A copy stages as the draft; it does not apply.** `draft.set(draftFrom(source))`, which is the whole behaviour: it previews through the applier like any moved anchor, `dirty()` offers the save, cancel puts the saved Theme back, and the save is the same `PATCH /worlds/:id` — so the copy has no write path of its own. The values land as this World's own and are editable from there; the `version` is re-stamped on the way out (`draftToTheme`), so a copy carries the contract this build knows rather than the one the source was authored against.

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
