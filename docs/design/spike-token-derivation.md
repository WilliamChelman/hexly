# Spike — deriving both ColorSchemes from anchors + shape knobs

> **Question.** Can Solar (light) and Astral (dark) be reproduced from ~10 anchor
> colours per scheme plus 2–3 numeric "shape" knobs per scheme, instead of the ~35
> hand-tuned literals each currently uses? Constraint: pure CSS, and **the expression
> for a given token must be byte-identical in both schemes** — only anchors and knobs
> may differ.

Status: **spike / not implemented.** Every number below was computed numerically from
the real token values in `libs/web-styles/src/index.css` (`@theme static`, Solar) and
`libs/web-styles/src/tokens.css` (`:root[data-theme='dark']`, Astral). sRGB↔OKLab/OKLCH,
CIELAB and ΔE2000 were implemented from the specs; no colour library was used.
ΔE00 ≈ 1 is a just-noticeable difference; 2–3 is noticeable side by side but acceptable
for a repaint.

Scope excludes tier-3 tokens moving to `plugin-hexmap-web` (`terrain-*`, `hex-line`,
`feature-ink`, `label-ink`, `name-ink`) and `sea`/`astra` (covered by
[`spike-tone-rotation.md`](./spike-tone-rotation.md)).

---

## Verdict

**Yes, but the honest shape is 8 anchors + 3 knobs + 1 named literal exception, not
10 + 2–3.** All 35 tokens fit at **ΔE00 ≤ 2.91 in both schemes (70/70 values ≤ 3,
mean 0.89)** using one shared expression per token, and the per-scheme cost drops from
35 colour values to 12. **But roughly half of that fit is unfalsifiable**: with only two
schemes to fit, any expression that uses a knob with both a scale and an offset can hit
two arbitrary targets exactly, so its ΔE00 of 0.00 proves nothing. Five tokens are in
that category and are literals in disguise; `canvas-glow` is a literal outright.

The genuinely load-bearing discovery is smaller and better than the headline: **Solar and
Astral are mirror images.** The ink ramp spans 0.372 OKLab-L in Solar and −0.375 in
Astral; the paper ramp's chroma-vs-lightness slope is −0.42 in Solar and +0.42 in Astral.
A single ±1 polarity knob (`--tone`) captures that, and 15 tokens fit on it with _one_
coefficient each — a real constraint that the hand-tuned values satisfied, not an
artefact of fitting. Two of the three knobs are pulling their weight; the third (`--veil`)
is mostly an alpha scale.

---

## 1. The proposed anchor set

Eight anchors. Seven of them _are_ an existing token (so those seven fit at ΔE00 = 0.00
by construction — discounted throughout this document); `--a-soot` is new.

| Anchor          | Role                                    | Solar     | Astral    | Feeds |
| --------------- | --------------------------------------- | --------- | --------- | ----- |
| `--a-page`      | The table / outer paper                 | `#f1e5c7` | `#0b0c1a` | 6     |
| `--a-ink`       | Primary text ink (warm in **both**)     | `#2e2412` | `#ece3cf` | 2     |
| `--a-ink-quiet` | Secondary ink (carries its **own** hue) | `#6f5a36` | `#9aa0c8` | 2     |
| `--a-gold`      | The through-line accent                 | `#9a6a16` | `#d9b25a` | 12    |
| `--a-ember`     | Danger                                  | `#a4402e` | `#e88a6f` | 2     |
| `--a-positive`  | Confirmation                            | `#4a6f2f` | `#86c46a` | 2     |
| `--a-canvas`    | The map field                           | `#efe2bf` | `#12152e` | 2     |
| `--a-soot`      | Shadow / scrim ink                      | `#3c2c16` | `#02020a` | 6     |

Three knobs, registered as `<number>` so `calc()` can type-check them:

| Knob           | Controls                                                                     | Solar   | Astral |
| -------------- | ---------------------------------------------------------------------------- | ------- | ------ |
| `--tone`       | Scheme polarity. Sign of every ramp direction and of the paper chroma slope. | `1`     | `-1`   |
| `--line-alpha` | Opacity of the drawn-rule ramp (`line`, `line-strong`, `line-faint`).        | `0.371` | `0.16` |
| `--veil`       | Base opacity of shadows / scrims / the vignette.                             | `0.12`  | `0.5`  |

Plus two shared constants baked into the expressions (identical in both schemes):
`0.42` (paper chroma-per-lightness slope) and `0.373` (ink-ramp span magnitude).

```css
@property --tone {
  syntax: '<number>';
  inherits: true;
  initial-value: 1;
}
@property --line-alpha {
  syntax: '<number>';
  inherits: true;
  initial-value: 0.371;
}
@property --veil {
  syntax: '<number>';
  inherits: true;
  initial-value: 0.12;
}
```

**Per-scheme cost: 8 anchors + 3 knobs + 1 literal = 12 values, down from 35** (2.9×).
Counted as raw numbers rather than values: ~62 per-scheme numbers vs ~238 today, plus
~65 shared constants written once — so total numbers roughly halve, and the _marginal_
cost of a third scheme drops from 35 colour values to 12.

`--a-soot` is the only anchor that is not already a token. It exists because Solar's
scrim/shadow ink (`#3c2c16`, a warm sepia) is not derivable from `--a-page` (light) or
`--a-ink` (which sits at L 0.267, _darker_ than the shadow). Astral's is near-black.
`#02020a` was chosen over pure `#000` as the compromise that keeps `overlay` and
`canvas-edge` under ΔE00 1.1 while costing the four shadow colours ~2.1–2.5 (against a
pure-black target, in the near-black region where ΔE00 exaggerates: the composites are
`#050510` vs `#030307` over `bg`).

---

## 2. Per-token table

One expression per token, identical in both schemes. Derived hexes below are the
_rendered_ values; for translucent tokens ΔE00 is measured on the composite over the
canonical backdrop (`surface` for line/soft/glow/focus/overlay, `canvas-bg` for the
canvas pair, `bg` for shadows), with alpha reported separately.

| Token            | CSS expression                                                                              | Solar derived     | Solar target   | ΔE00     | Astral derived  | Astral target  | ΔE00     |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------- | -------------- | -------- | --------------- | -------------- | -------- |
| `bg`             | `var(--a-page)`                                                                             | `#f1e5c7`         | `#f1e5c7`      | 0.00     | `#0b0c1a`       | `#0b0c1a`      | 0.00     |
| `bg-deep`        | `oklch(from var(--a-page) calc(l - .027) calc(c + .0113*var(--tone)) h)`                    | `#ebdcb6`         | `#e7d8b2`      | 0.89     | `#07070f`       | `#070710`      | 0.58     |
| `surface`        | `oklch(from var(--a-page) calc(l + .046) calc(c - .0193*var(--tone)) calc(h - 2))`          | `#fcf4e5`         | `#fbf6e7`      | 0.99     | `#13152e`       | `#10132b`      | 0.86     |
| `surface-raised` | `oklch(from var(--a-page) calc(l + .067) calc(c - .0281*var(--tone)) calc(h - 4.5))`        | `#fffcf2`         | `#fffaf0`      | 0.74     | `#151937`       | `#181c3c`      | 1.13     |
| `surface-sunken` | `oklch(from var(--a-page) calc(l - .017*var(--tone)) calc(c + .0071) calc(h + 1))`          | `#eddfbc`         | `#ece0c0`      | 1.02     | `#0e0f21`       | `#0c0e22`      | 0.95     |
| `overlay`        | `oklch(from var(--a-soot) l c h / calc(var(--veil)*.526 + .357))`                           | `#3c2c16` α.420   | `#3a2c1c` α.42 | 1.00     | `#02020a` α.620 | `#04040e` α.62 | 1.09     |
| `ink`            | `var(--a-ink)`                                                                              | `#2e2412`         | `#2e2412`      | 0.00     | `#ece3cf`       | `#ece3cf`      | 0.00     |
| `ink-strong`     | `oklch(from var(--a-ink) calc(l - .0485*var(--tone)) calc(c - .007) calc(h + 4))`           | `#20190b`         | `#211a0b`      | 0.59     | `#f9f4e4`       | `#fbf6e7`      | 0.56     |
| `ink-muted`      | `var(--a-ink-quiet)`                                                                        | `#6f5a36`         | `#6f5a36`      | 0.00     | `#9aa0c8`       | `#9aa0c8`      | 0.00     |
| `ink-faint`      | `oklch(from var(--a-ink-quiet) calc(l + .166*var(--tone)) calc(c + .006) calc(h + 4.5))`    | `#a08b60`         | `#9c8a5e`      | 1.44     | `#6b6d96`       | `#666c95`      | 1.67     |
| `line`           | `oklch(from var(--a-gold) l c h / var(--line-alpha))`                                       | α.371 → `#c4a771` | `#d6c39a`      | 0.81     | α.160           | `#d9b25a` α.16 | 0.00     |
| `line-strong`    | `oklch(from var(--a-gold) l c h / calc(var(--line-alpha)*1.85))`                            | α.686 → `#af8843` | `#b89a62`      | 2.01     | α.296           | `#d9b25a` α.32 | 1.85     |
| `line-faint`     | `oklch(from var(--a-gold) l c h / calc(var(--line-alpha)*.44))`                             | α.163             | `#78561e` α.16 | 1.77     | α.070           | `#d9b25a` α.08 | 0.75     |
| `gold`           | `var(--a-gold)`                                                                             | `#9a6a16`         | `#9a6a16`      | 0.00     | `#d9b25a`       | `#d9b25a`      | 0.00     |
| `gold-strong`    | `oklch(from var(--a-gold) calc(l - .0858*var(--tone)) calc(c - .016) calc(h + 3))`          | `#79550b`         | `#7e560f`      | 1.50     | `#eed085`       | `#f0d68a`      | 1.69     |
| `gold-soft`      | `oklch(from var(--a-gold) l c h / .14)`                                                     | α.14              | α.14           | 0.00     | α.14            | α.14           | 0.00     |
| `gold-bright`    | `oklch(from var(--a-gold) max(l, .876) .10 90)`                                             | `#f0d488`         | `#efd078`      | 2.27     | `#f0d488`       | `#f0d897`      | 2.38     |
| `gold-deep`      | `oklch(from var(--a-gold) calc(l + .087*var(--tone)) calc(c + .011) calc(h - 2.5))`         | `#bb812b`         | `#b98323`      | 2.02     | `#c2942e`       | `#c59335`      | 1.88     |
| `on-gold`        | `color-mix(in srgb, contrast-color(var(--a-gold)) 90%, var(--a-gold))`                      | `#f5f0e8`         | `#fbf5e6`      | **2.91** | `#161209`       | `#15110a`      | 0.84     |
| `on-gilded`      | `color-mix(in srgb, black calc(81.5% - 9%*var(--tone)), var(--a-gold))`                     | `#2a1d06`         | `#2a1f08`      | 1.66     | `#151109`       | `#15110a`      | 0.61     |
| `glow`           | `oklch(from var(--a-gold) max(l,.713) calc(c + (.713 - min(l,.713))*.18) calc(h + 1) / .5)` | `#d39527` α.5     | `#d29628` α.5  | 0.31     | `#d8b35a` α.5   | `#d9b25a` α.5  | 0.42     |
| `ember`          | `var(--a-ember)`                                                                            | `#a4402e`         | `#a4402e`      | 0.00     | `#e88a6f`       | `#e88a6f`      | 0.00     |
| `ember-soft`     | `oklch(from var(--a-ember) l c h / .15)`                                                    | α.15              | α.14           | 0.55     | α.15            | α.16           | 0.66     |
| `positive`       | `var(--a-positive)`                                                                         | `#4a6f2f`         | `#4a6f2f`      | 0.00     | `#86c46a`       | `#86c46a`      | 0.00     |
| `positive-soft`  | `oklch(from var(--a-positive) l c h / .16)`                                                 | α.16              | α.16           | 0.00     | α.16            | α.16           | 0.00     |
| `canvas-bg`      | `var(--a-canvas)`                                                                           | `#efe2bf`         | `#efe2bf`      | 0.00     | `#12152e`       | `#12152e`      | 0.00     |
| `canvas-mat`     | `oklch(from var(--a-canvas) calc(l - .036) calc(c + .0151*var(--tone)) calc(h - .7))`       | `#e7d6a8`         | `#e5d4a9`      | 0.83     | `#0c0e1f`       | `#0a0c1d`      | 0.47     |
| `canvas-glow`    | — **literal, see §5**                                                                       | `#fff0ca` α.55    | `#fff0ca` α.55 | 0.00     | `#3a468c` α.26  | `#3a468c` α.26 | 0.00     |
| `canvas-edge`    | `oklch(from var(--a-soot) l c h / var(--veil))`                                             | `#3c2c16` α.120   | `#78561e` α.14 | 1.54     | `#02020a` α.500 | `#04040e` α.50 | 0.82     |
| `ink-stroke`     | `oklch(from var(--a-page) calc(l + .030*var(--tone)) calc(c - .0126) calc(h + 2.5))`        | `#f7f0da`         | `#fbf6e7`      | **2.69** | `#07070e`       | `#0a0b16`      | **2.75** |
| `shadow-1`       | `oklch(from var(--a-soot) l c h / var(--veil))`                                             | α.120             | α.12           | 0.00     | α.500           | α.50           | 2.06     |
| `shadow-2`       | `oklch(from var(--a-soot) l c h / calc(var(--veil) + .088))`                                | α.208             | α.20           | 0.37     | α.588           | α.60           | 2.30     |
| `shadow-3`       | `oklch(from var(--a-soot) l c h / calc(var(--veil) + .214))`                                | α.334             | α.32           | 0.43     | α.714           | α.72           | 2.46     |
| `shadow-inset`   | `oklch(from var(--a-soot) l c h / calc(var(--veil) - .029))`                                | α.091             | α.12           | 1.28     | α.471           | α.40           | 1.43     |
| `shadow-focus`   | `oklch(from var(--a-gold) l c h / .345)`                                                    | α.345             | `#9a6a16` α.32 | 1.00     | α.345           | `#e6b652` α.34 | 1.84     |

Which channel drives the error, for the alpha tokens:

- **Colour-driven** (alpha within ±0.01 of target): `overlay`, `canvas-edge` Astral, `shadow-1/2/3` Astral (all of these are the `--a-soot` compromise), `glow`, `gold-soft`, `positive-soft`.
- **Alpha-driven**: `shadow-inset` (Solar 0.091 vs 0.12; Astral 0.471 vs 0.40 — the biggest single alpha miss, 0.07), `ember-soft` (0.15 vs 0.14 / 0.16 — one shared value where the schemes disagree by 0.02), `line-strong` Astral (0.296 vs 0.32), `canvas-edge` Solar (0.120 vs 0.14).
- **Both**: `line` / `line-strong` in Solar, where the derived value is translucent and the target is opaque — see §5.

---

## 3. Buckets

Across all 70 values (35 tokens × 2 schemes):

| ΔE00 | Count       |
| ---- | ----------- |
| ≤ 1  | 43 / 70     |
| ≤ 2  | 60 / 70     |
| ≤ 3  | **70 / 70** |
| > 3  | 0 / 70      |

Mean 0.89, max 2.91 (`on-gold` Solar).

**Discount the free ones.** 20 of those 70 are exact by construction: 14 where the token
_is_ the anchor (`bg`, `ink`, `ink-muted`, `gold`, `ember`, `positive`, `canvas-bg`),
2 for the `canvas-glow` literal, and 4 where the only change is an alpha that happened
to already agree in both schemes (`gold-soft`, `positive-soft`). Of the **50 genuinely
derived values**: 23 ≤ 1, 40 ≤ 2, 50 ≤ 3, 0 > 3.

---

## 4. How much of this is real — the falsifiability audit

This is the part that decides whether the architecture is worth staking anything on.

**With only two schemes, any expression carrying two free per-scheme numbers per channel
fits both targets exactly and proves nothing.** A model `L_t = α_scheme + c_t·β_scheme`
produces a 2×N matrix of rank ≤ 2, and every 2×N matrix has rank ≤ 2. So "it fits" is
information-free unless the expression is constrained. Classifying every token by how
constrained its expression actually is:

| Tier   | Meaning                                                                                                                                                                                                 | Count | Tokens                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T0** | No knob at all. A fixed transform of an anchor. Fully falsifiable, and it held.                                                                                                                         | 14    | `bg`, `ink`, `ink-muted`, `gold`, `ember`, `positive`, `canvas-bg`, `gold-soft`, `ember-soft`, `positive-soft`, `gold-bright`, `on-gold`, `glow`, `shadow-focus`                                            |
| **T1** | A knob with a **single** multiplicative coefficient and no additive constant. Asserts the two schemes are mirror-symmetric on that channel — a real constraint the hand values had to satisfy, and did. | 15    | `bg-deep`, `surface`, `surface-raised`, `surface-sunken`, `canvas-mat`, `ink-strong`, `ink-faint`, `gold-strong`, `gold-deep`, `ink-stroke`, `line`, `line-strong`, `line-faint`, `canvas-edge`, `shadow-1` |
| **T2** | A knob used **affinely** (scale _and_ offset). Two shared constants map the knob's two values onto two arbitrary targets. Exact by construction; equivalent to storing both literals.                   | 5     | `overlay`, `on-gilded`, `shadow-2`, `shadow-3`, `shadow-inset`                                                                                                                                              |
| **X**  | Dedicated anchor with fan-out 1. A literal wearing a `var()`.                                                                                                                                           | 1     | `canvas-glow`                                                                                                                                                                                               |

The T1 result is the genuine finding, and it is worth stating on its own:

- Ink ramp span: Solar `+0.372` OKLab-L, Astral `−0.375`. Equal to 0.8%.
- Paper chroma slope dC/dL: Solar `−0.42`, Astral `+0.42`.
- `gold-deep` offset from `gold`: Solar `+0.0865`, Astral `−0.0865`.
- Ink-ramp coefficients normalised to `ink-faint = 1`: Solar `(−0.12, 0, 0.57, 1.0)`,
  Astral `(−0.15, 0, 0.54, 1.0)`.

Nobody designed those symmetries deliberately; they fell out of tuning each scheme until
it "felt equivalent". That is the strongest evidence in this spike that a derived system
would generalise.

**The temptation to refuse.** `--tone` set to ±1 with _two_ per-token coefficients is an
exact `if(light, A, B)`. It is trivially available and it destroys the whole premise. The
sharpest example: `ink-muted` needs hue 80° in Solar and 278° in Astral. Writing
`calc(h + 95 - 96*var(--tone))` derives it off `--a-ink` at ΔE00 0.48/0.52 — a beautiful
number that means nothing, because 95 and −96 _are_ the two literals. Refusing that is
exactly why `--a-ink-quiet` exists as an anchor. **The brief's hypothesis for `ink-muted`
is confirmed**: the hue inversion is only expressible because the anchor carries its own
hue. Derived from `--a-ink` with any single fixed hue offset, `ink-muted` collapses to
grey (`#5c5c5c` / `#a1a1a1`, ΔE00 15.8 / 15.3).

The five T2 tokens should be read as _four alpha literals and one mix-percentage literal_
that happen to be spelled as arithmetic. They are cheap (they are scalars, not colours)
but they are not derivations.

---

## 5. The exception list

### Hard exception — stays a literal

**`canvas-glow`.** Solar `rgba(255, 240, 202, 0.55)`, Astral `rgba(58, 70, 140, 0.26)`.
The lift from `canvas-bg` is `ΔL +0.043, ΔC ×1.08` in Solar and `ΔL +0.214, ΔC ×2.37` in
Astral — a 5× difference in lift and a 2.2× difference in saturation gain, with alpha
also moving 0.55 → 0.26. No single expression reaches both from `--a-canvas` without two
free per-token coefficients. The table above shows ΔE00 0.00 only because it is fed by a
dedicated anchor used by exactly one token; that is a literal, and it should be written
as one. **Override: keep both current values verbatim.**

The design reason is legible: Solar's field glow is a _warm highlight of the same paper_,
Astral's is a _different-hue light source_ (indigo starlight) sitting on indigo paper.
Those are two different visual ideas. If the two schemes were re-tuned so Astral's glow
were also a lift of its own field hue, this token would drop into T1.

### Behavioural exception — not a colour miss, a semantics change

**`line` and `line-strong` in Solar.** The line ramp fits cleanly as "gold at
`--line-alpha × {1, 1.85, 0.44}`" — the required alphas are Solar `(0.371, 0.686, 0.163)`
and Astral `(0.16, 0.296, 0.070)`, i.e. the same three ratios. But Solar's current values
are **opaque** hexes and Astral's are **translucent**. One of the two has to change:

| Form                                                                 | Solar behaviour                                                                                                                                                                   | Astral behaviour                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translucent both (`oklch(… / α)`)                                    | `line` now varies by backdrop: `#c4a771` over `surface` (ΔE00 0.81 from today's `#d6c39a`) but `#c09f63` over `bg` (**ΔE00 10.9**) and `#be9d60` over `surface-sunken` (**11.5**) | unchanged                                                                                                                                          |
| Opaque both (`color-mix(in srgb, var(--a-gold) …%, var(--surface))`) | `line` `#d7c198` (ΔE00 1.26), `line-strong` `#b79354` (2.78) — faithful                                                                                                           | `line` stops varying by backdrop: locked to `#322e35`, vs today's `#2c2724` over `bg` (**ΔE00 6.3**) and `#373441` over `surface-raised` (**3.8**) |

Both forms match at the canonical backdrop and diverge elsewhere. This is a design
decision, not a fitting problem: **pick translucent** (it is the better rule and the one
Astral already uses), and accept that Solar's rules become context-sensitive. Record it
as an intentional change rather than pretending the fit is lossless.

`line-faint` has a third quirk: Solar's base colour is `#78561e`, not `--color-gold`
`#9a6a16`. The gold-based form lands at ΔE00 1.77 over `surface`, so it absorbs fine.

### Geometry exception — the shadow box-shadow strings

Only the colour components were fitted above. **The geometry is also scheme-dependent,
and inconsistently so:**

|                | Solar              | Astral              | Astral/Solar        |
| -------------- | ------------------ | ------------------- | ------------------- |
| `shadow-1`     | `0 1px 2px`        | `0 1px 2px`         | 1.00                |
| `shadow-2`     | `0 4px 12px -2px`  | `0 6px 18px -4px`   | 1.5 / 1.5 / 2.0     |
| `shadow-3`     | `0 16px 36px -8px` | `0 22px 48px -10px` | 1.375 / 1.33 / 1.25 |
| `shadow-inset` | `inset 0 1px 2px`  | `inset 0 1px 2px`   | 1.00                |
| `shadow-focus` | `0 0 0 3px`        | `0 0 0 3px`         | 1.00                |

A single `--shadow-scale` knob would have to be 1.0, 1.5 _and_ 1.375 simultaneously.
Recommend **unifying the geometry** (one set of offsets/blur/spread for both schemes,
with only the colour and alpha re-themed) — the divergence looks like drift, not intent.
If it is intent, it costs two more per-scheme literals for `shadow-2` and `shadow-3`.

### Borderline — fits, with a caveat worth recording

- **`on-gold` (2.91 / 0.84).** The `contrast-color()` flip is the right idea and works —
  Solar's dark gold returns `white`, Astral's light gold returns `black` — but the sRGB
  mix is asymmetric: Solar's target sits 0.03 OKLab-L from white while Astral's sits 0.18
  from black. A single mix percentage cannot serve both; 90% splits the difference and
  loses most of Solar's warmth (`#f5f0e8` vs `#fbf5e6`). Worth noting that Solar's
  `on-gold` is within ΔE00 0.51 of `surface`, so the design intent may simply be "paper".
- **`ink-stroke` (2.69 / 2.75).** The worst _symmetric_ miss. Solar's halo is currently
  exactly `surface`; Astral's is `#0a0b16`, darker than `bg`. Derived from `--a-page` with
  a tone-signed step it splits the difference in both. Alternative "`ink-stroke = surface`"
  is exact in Solar but ΔE00 **8.81** in Astral, so the tone-signed form is the better of
  the two. If the halo matters (it is legibility-critical over terrain), literal-override it.
- **`gold-bright` (2.27 / 2.38).** The derived value is _identical_ in both schemes
  (`#f0d488`); `max(l, 0.876)` clamps in both, so the anchor contributes nothing. This is
  not a derivation, it is a **theme-invariant constant** — and that is arguably correct
  (`--color-on-gilded`'s own comment already says "both themes"). The two current values
  are only ΔE00 4.64 apart, i.e. they are the same colour tuned twice.
- **`surface-sunken` (1.02 / 0.95).** The fit is numerically clean and it does capture the
  documented `bg`↔`surface-sunken` swap: `l − 0.017·tone` off `--a-page` is darker than
  the page in Solar and lighter in Astral, exactly as the current values are. **But the
  parent is wrong on purpose.** Semantically the well belongs to `surface`, and against
  `surface` the offsets are −0.065 (Solar) and −0.025 (Astral) — a 2.6× mismatch that no
  single coefficient survives. The formula is fitted to the numbers, not derived from the
  design rule. Flagging it so nobody later "fixes" the parent and wonders why it breaks.

### What the paper-ramp "spread" hypothesis actually shows

The brief hypothesised a per-scheme spread knob because the paper ramp spans a 1.38×
luminance ratio in Solar and 5.9× in Astral. **In OKLab-L those spans are nearly equal**
(0.101 vs 0.108) — the luminance-ratio framing is an artefact of the cube-root, and a
spread knob is not needed for that reason.

Testing it anyway: with a spread knob at ratio 1.33, `bg-deep` and `bg` fit to within
0.001 L in both schemes, and `surface-sunken` and `surface-raised` miss by 0.024 and 0.033
respectively. The real shape difference is not span, it is **where the ramp puts its
energy**: Solar hangs 87% of its range _below_ `surface`, Astral puts 40% _above_ it
(`surface-raised` is +0.013 L above surface in Solar and +0.043 in Astral). One knob
cannot express that; two can, but two is unfalsifiable. The tone-signed forms above
absorb it at ΔE00 ≤ 1.13 instead, which is cheaper and more honest.

---

## 6. Gamut report

Every derived value is in sRGB except one:

| Token            | Scheme | Extended-sRGB                 | Overshoot  |
| ---------------- | ------ | ----------------------------- | ---------- |
| `surface-raised` | Solar  | `rgb(1.0051, 0.9863, 0.9491)` | red +0.51% |

The excursion is half a percent of one channel at L 0.991, C 0.014 — every engine clips or
maps that to the same `#fffcf2`, and the CSS Color 4 chroma-reduction path never engages
at that magnitude. This is not the class of divergence that has bitten engines in the past
(that requires wide-gamut chroma well outside the hull). Nothing else is within 0.8% of a
boundary; the closest are the four Astral `--a-soot` shadows sitting at `rgb(0.008, 0.008,
0.039)`, comfortably inside.

Worth noting for the future: the ramp expressions extrapolate (`calc(l + …)`), so a future
anchor with more chroma than today's would push `surface-raised` and `gold-bright` out
further. Two of the eight anchors (`--a-gold`, `--a-ember`) sit at C 0.11–0.14 and the
`gold-strong`/`gold-deep` expressions _raise_ chroma; verify after any anchor retune.

---

## 7. Knob-count finding

**Three knobs. Two of them earn it; the third is an alpha scale, not a shape knob.**

| Knob           | Verdict                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--tone` (±1)  | **Essential, and the only real discovery.** 15 tokens ride it with a single coefficient. It carries the ink-ramp direction, the paper chroma slope, the `bg`↔`surface-sunken` swap, and `gold-deep`'s inversion. Without it the ink ramp cannot be written at all.                   |
| `--line-alpha` | **Earns it.** 3 tokens, one coefficient each, ratios `{1, 1.85, 0.44}` matching to within 8% between schemes. Genuine T1.                                                                                                                                                            |
| `--veil`       | **Half-earns it.** `shadow-1` and `canvas-edge` ride it at coefficient 1 (T1). `shadow-2`, `shadow-3`, `shadow-inset` and `overlay` use it affinely (T2) — those four additive constants are the four alpha literals in disguise. Cheaper than colour literals, but not derivations. |

**No fourth knob was needed, and adding one would not help** — every remaining misfit is a
ramp _shape_ difference (paper energy distribution, `canvas-glow`'s lift, `on-gold`'s
asymmetry) where a knob would need per-token coefficients on both a constant and the knob,
which is the disguised-`if()` failure mode.

**Two knobs are not enough**: dropping `--line-alpha` and forcing the line ramp onto
`--veil` fails, because the required line/shadow ratios are 3.1× (Solar) and 0.32×
(Astral) — they move in _opposite directions_ between schemes.

### Anchor count is the number that moved, not the knob count

The ask was ~10 anchors; 8 suffice, but three of them have a fan-out of only 2 tokens and
are therefore weak compression (2 values → 1):

| Optional simplification                                                 | Cost                                                                                                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drop `--a-canvas`, derive `canvas-bg` from `--a-page` (tone-signed)     | ΔE00 2.19 / 1.90 on `canvas-bg`, and it propagates to `canvas-mat`. **Not recommended** — this is a full-viewport field where 2.2 is very visible. |
| Drop `--a-ember`, rotate off `--a-gold` (`l−0.055`, `c×1.14`, `h−45.4`) | ΔE00 2.43 / 2.55. **Viable but not recommended** — locking the danger hue to gold's is a semantic trap the moment either is retuned.               |
| Drop `--a-positive`, rotate off `--a-gold` (`h+55.2`)                   | ΔE00 3.21 / 3.85. **Refuse** — the only >3 result in the spike.                                                                                    |
| Drop `--a-ink-quiet`                                                    | **Impossible.** ΔE00 15.8 / 15.3; the hue inversion is unreachable.                                                                                |

So the honest floor is **8 anchors** (7 if you accept a 2.5 ΔE00 shift on `ember`), 3
knobs, 1 literal, plus the two behavioural decisions in §5 — and the real value of the
exercise is not the compression ratio but the mirror-symmetry it exposed between the two
schemes, which is a property worth asserting in the tokens rather than re-deriving by hand
every time a colour moves.

---

## Caveats on the CSS

- `contrast-color()` is used by `on-gold` only, and it is the newest primitive here
  (Chrome 140 / Safari 26; not yet Baseline widely-available). If it has to go, `on-gold`
  becomes the ninth anchor, or takes its two literals back.
- Relative colour syntax with a `var()` inside a channel `calc()` requires the knob to be
  `@property`-registered as `<number>`, otherwise the substituted token is untyped and the
  `calc()` is invalid at computed-value time. All three knobs above are registered.
- Relative colours resolve at computed-value time, so `--color-surface` derived from
  `--a-page` re-resolves correctly when `[data-theme]` swaps the anchor. Tokens that chain
  (`on-gilded` reads `--a-gold`, not `--color-gold-bright`) were written to depend only on
  anchors to keep the chain one level deep.
- **The Canvas renderers are the real implementation risk (ADR-0003).** Tailwind's
  `@theme static` emits these declarations verbatim, so `--color-*` become expressions
  rather than hexes. `--color-*` are _unregistered_ custom properties, so
  `style.getPropertyValue('--color-glow')` returns the token stream with `var()`s
  substituted but the colour function **unevaluated** — literally
  `oklch(from #9a6a16 max(l, .713) calc(c + (.713 - min(l, .713)) * .18) calc(h + 1) / .5)`.
  Three call sites hand those strings straight to a 2D context:
  `libs/plugin-hexmap-web/src/services/map-renderer.ts:211` (`--color-gold-soft`,
  `--color-ink-stroke`, `--color-glow`, `--color-gold-strong`, `--color-ember`),
  `libs/plugin-board-web/src/components/board-canvas.component.ts:342` (`--color-line`),
  and `libs/web-entity/src/graph/graph-palette.ts:12`. Canvas `fillStyle` _will_ parse
  relative colour syntax in Chrome 119+/Safari 16.4+, so this probably works — but it is
  untested and silently falls back to the hard-coded fallback hex if parsing fails.
  The clean fix is to `@property`-register the `--color-*` tokens as `<color>`, which
  makes `getPropertyValue` return a resolved `oklch(…)`; that should be part of the
  implementation, not discovered afterwards.
- Utilities with an opacity modifier (`bg-surface/50`) wrap the token in `color-mix()`,
  which composes fine over a relative colour.
