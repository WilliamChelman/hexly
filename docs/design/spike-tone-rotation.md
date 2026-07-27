# Spike — 12 derived tones by hue rotation

> **Question.** Replace `--color-sea` / `--color-astra` with `--color-tone-1 … --color-tone-12`,
> derived in pure CSS by rotating hue off `--color-accent`, with an arc around danger
> and success excluded. Is 12 achievable?

Status: **spike / not implemented.** All numbers below were computed from the real
token values in `libs/web-styles/src/index.css` (Solar) and
`libs/web-styles/src/tokens.css` (Astral), with sRGB↔OKLCH, CIEDE2000, WCAG 2.1
relative luminance, the CSS Color 4 gamut-mapping algorithm and the Viénot–Brettel–Mollon
dichromat model implemented from scratch (CIEDE2000 validated against Sharma's
test vectors; the dichromat model validated on the red/green and blue/yellow axes).

Those token values are the ones that shipped through #359–#376, and the accent among
them has since moved: Solar's is `#8c5e00`, not the `#9a6a16` §1 tabulates and §5 quotes
at 4.37:1. The eight tones the spike recommended are derived off it and moved with it —
what they measure **as shipped today** is `world-theme-spec.md` §2.3. This section is the
analysis that chose them and is left at the values it was computed from.

---

## Verdict

**12 is not achievable. As a pure hue rotation the honest number is 7. Spending a
second dimension — one lightness step — gets you to 8 with margin and 9 at the
edge. Recommendation: ship 8.**

The reason is not the exclusion arc's width. It is that **`--color-gold` sits
between danger and success on the hue circle**, so excluding both does not take two
bites out of a wheel — it collapses the usable space into a _single_ arc of ~161°
running cyan → blue → violet → magenta. Every tone must be a cool colour, and that
arc is the least hue-efficient part of OKLCH: 15° of rotation buys only ΔE00 5.0–5.4
there versus 7.9–8.3 in the excluded warm region. The exclusion therefore costs
roughly **half the palette**, not a slice of it.

| Bar                                      | 12 pure rotations | 8, recommended | shipped `sea`/`astra` |
| ---------------------------------------- | ----------------- | -------------- | --------------------- |
| min pairwise ΔE00 between tones          | **4.8**           | 10.8           | 23.7                  |
| min pairwise ΔE00 between `-soft` fills  | **0.9**           | 1.4            | 9.0                   |
| min ΔE00 as a deuteranope sees them      | **0.1**           | 0.6            | 14.5                  |
| tones failing 4.5:1 on `--color-surface` | 0                 | 0              | 0                     |

Three further findings that matter more than the headcount:

1. **The `-soft` fill cannot carry categories at any usable N.** At α = 0.14 over
   Solar's ivory `--color-surface`, twelve fills land within ΔE00 0.9 of each other —
   below a single JND. Even 7 tones only reach 1.4. You would need α ≈ 0.55 to reach
   ΔE00 5.5 at N = 7. **The chip's category signal has to be the text and border
   colour; the fill is decoration.** This is not a regression the spike introduces —
   it is what happens when you go from 2 categoricals 135° apart to N crammed into 161°.
2. **`oklch(from var(--color-accent) l c calc(h + R))` — the literal recipe in the
   brief — fails contrast in Solar at every hue.** Gold's own L (0.561) yields
   3.98–4.56:1 on `--color-surface`; 9 of 12 tones would be under 4.5:1. `--color-gold`
   itself already ships at 4.37:1. The recipe needs `calc(l * 0.9)` or lower.
3. **Any lightness variation inverts its own visual weight between schemes.** An
   `l * 0.80` tone is _darker_, so it reads heavier on Solar's ivory and lighter on
   Astral's indigo. The two-level ladder that rescues 8 tones has its emphasis order
   flip when the user toggles the theme.

---

## 1. Hue angles

| Scheme | Role        | Token                    | Hex       | L      | C      | h           |
| ------ | ----------- | ------------------------ | --------- | ------ | ------ | ----------- |
| Solar  | accent      | `--color-gold`           | `#9a6a16` | 0.5610 | 0.1107 | **75.26°**  |
| Solar  | danger      | `--color-ember`          | `#a4402e` | 0.5052 | 0.1364 | **32.25°**  |
| Solar  | success     | `--color-positive`       | `#4a6f2f` | 0.4983 | 0.1018 | **133.78°** |
| Solar  | categorical | `--color-sea`            | `#2f6f7a` | 0.5049 | 0.0669 | 210.45°     |
| Solar  | categorical | `--color-astra`          | `#5a4aa6` | 0.4739 | 0.1423 | 287.69°     |
| Solar  | bg          | `--color-surface`        | `#fbf6e7` | 0.9730 | 0.0205 | 91.58°      |
| Solar  | bg          | `--color-surface-sunken` | `#ece0c0` | 0.9080 | 0.0442 | 89.90°      |
| Solar  | bg          | `--color-bg`             | `#f1e5c7` | 0.9237 | 0.0416 | 88.80°      |
| Astral | accent      | `--color-gold`           | `#d9b25a` | 0.7809 | 0.1158 | **85.60°**  |
| Astral | danger      | `--color-ember`          | `#e88a6f` | 0.7270 | 0.1218 | **36.84°**  |
| Astral | success     | `--color-positive`       | `#86c46a` | 0.7571 | 0.1373 | **136.62°** |
| Astral | categorical | `--color-sea`            | `#54c8bb` | 0.7631 | 0.1063 | 185.16°     |
| Astral | categorical | `--color-astra`          | `#a18cf0` | 0.7003 | 0.1441 | 291.90°     |
| Astral | bg          | `--color-surface`        | `#10132b` | 0.1985 | 0.0479 | 275.76°     |
| Astral | bg          | `--color-surface-sunken` | `#0c0e22` | 0.1743 | 0.0412 | 276.93°     |
| Astral | bg          | `--color-bg`             | `#0b0c1a` | 0.1615 | 0.0295 | 279.44°     |

**The angles do differ between schemes**, as suspected — the two palettes were
hand-tuned independently:

| Role    | Solar rotation off accent | Astral rotation off accent | Δ         |
| ------- | ------------------------- | -------------------------- | --------- |
| danger  | −43.00°                   | −48.76°                    | **5.8°**  |
| success | +58.53°                   | +51.02°                    | **7.5°**  |
| sea     | +135.19°                  | +99.56°                    | **35.6°** |
| astra   | −147.56°                  | −153.70°                   | 6.1°      |

**What this means for a shared rotation set.** A rotation `R` lands on a different
absolute hue in each scheme (10.3° apart, because the accents themselves differ by
10.3°), and the status colours are not pinned to the accent either. So an exclusion
arc defined in rotation space must be the **union** of the two schemes' arcs — it
costs an extra ~6–8° of width per status colour before you spend a single degree on
actual perceptual separation. `sea`'s 35.6° divergence is a bigger warning: Astral's
teal is a genuinely different hue from Solar's, so _no_ single rotation reproduces
today's pair. Any tone system replaces both tokens; it cannot preserve them.

The structural fact that drives the verdict: **danger (−43…−49°) and success
(+51…+59°) bracket the accent at 0°.** The accent is in the middle of the forbidden
zone, not outside it.

## 2. The excluded arc

Half-width is derived, not chosen by taste, from two measurements:

**(a) The confusability threshold, calibrated in-repo.** Rather than importing a
literature number, use the design's own revealed tolerance — the ΔE00 it already
ships between a categorical token and a status token:

| Pair                                        | Solar    | Astral                     |
| ------------------------------------------- | -------- | -------------------------- |
| `sea` ↔ `ember`                             | 41.4     | 48.8                       |
| `sea` ↔ `positive`                          | 27.7     | **21.5** ← shipped minimum |
| `astra` ↔ `ember`                           | 37.2     | 37.2                       |
| `astra` ↔ `positive`                        | 48.7     | 51.7                       |
| `gold` ↔ `ember`                            | 23.8     | 25.2                       |
| `sea` ↔ `astra` (categorical ↔ categorical) | **23.7** | 37.7                       |

The tightest "acceptable" categorical-vs-status pair Hexly ships is **ΔE00 21.5**.
Round down to **ΔE00 ≥ 20** as the exclusion threshold — the design is on record
tolerating that.

**(b) The rotation at which that threshold is crossed**, measured at the tone's own
L and C so hue is the only variable (ΔE00 to the status _hue_ at matched L, C):

| offset  | Solar → danger | Solar → success | Astral → danger | Astral → success |
| ------- | -------------- | --------------- | --------------- | ---------------- |
| 10°     | 5.3            | 4.6             | 5.4             | 4.3              |
| 20°     | 10.3           | 8.9             | 10.5            | 8.4              |
| 30°     | 14.8           | 12.8            | 15.4            | 12.5             |
| **40°** | **18.8**       | **16.4**        | **19.7**        | **16.6**         |
| 50°     | 22.1           | 20.0            | 23.3            | 20.9             |
| 60°     | 24.8           | 24.2            | 26.3            | 25.5             |

Crossing points (worst direction per scheme; the curve is asymmetric because CIEDE2000
weights hue non-uniformly):

| threshold     | danger half-widths (−/+) | success half-widths (−/+) |
| ------------- | ------------------------ | ------------------------- |
| ΔE00 ≥ 15     | 30.5° / 29.3°            | 32.3° / 36.3°             |
| **ΔE00 ≥ 20** | **43.8° / 39.8°**        | **42.8° / 50.3°**         |
| ΔE00 ≥ 25     | 60.8° / 51.0°            | 53.5° / 61.8°             |

**Resulting arcs**, unioned across both schemes, in rotation space (with the accent
itself excluded on the same rule — a tone that reads as the primary accent is as
useless as one that reads as an error):

| Threshold     | Excluded (one continuous zone, through rotation 0) | Allowed    | Allowed arc         |
| ------------- | -------------------------------------------------- | ---------- | ------------------- |
| ΔE00 ≥ 15     | +282.2 … +455.9 (i.e. −77.8 … +95.9), 173.7°       | **186.3°** | +95.9 … +282.2      |
| **ΔE00 ≥ 20** | +270.4 … +469.6 (i.e. −89.6 … +109.6), 199.1°      | **160.9°** | **+109.6 … +270.4** |

Because the accent is bracketed, the two status exclusions merge with each other and
with the accent's own exclusion into one continuous forbidden zone spanning ~199°.
There is no second usable pocket.

## 3. Placement

The allowed arc is 160.9° wide (ΔE00 ≥ 20). Placing 12 tones uniformly gives a
**minimum angular gap of 14.6°** — less than half the 30° even-12 baseline. Placing
them to maximise the _minimum perceptual_ distance instead of the minimum angle buys
about +0.8 ΔE00 and does not change the conclusion.

| N      | uniform-angle gap | min ΔE00 (uniform) | min ΔE00 (ΔE-optimised) |
| ------ | ----------------- | ------------------ | ----------------------- |
| 6      | 32.2°             | 10.8               | 12.5                    |
| 7      | 26.8°             | 9.0                | 10.4                    |
| 8      | 23.0°             | 7.6                | 8.9                     |
| 9      | 20.1°             | 6.7                | 7.8                     |
| 10     | 17.9°             | 5.9                | 7.0                     |
| 11     | 16.1°             | 5.4                | 6.3                     |
| **12** | **14.6°**         | **4.9**            | **5.7**                 |

The recommended 8-tone set (below) uses rotations **+113, +136, +161, +193, +207,
+230, +250, +270**, min gap 14° — but adjacent pairs at 14° sit on _different_
lightness rows, so the small angle is not carrying the separation alone.

## 4. Gamut

This is the risk the brief flagged, and it is real but **not** the binding constraint.

Max achievable sRGB chroma by absolute hue, at each candidate tone lightness:

| h       | Solar L .449 | Solar L .505 | Solar L .533 | Astral L .625 | Astral L .703 | Astral L .742 |
| ------- | ------------ | ------------ | ------------ | ------------- | ------------- | ------------- |
| 180     | 0.082        | 0.092        | 0.097        | 0.113         | 0.128         | 0.135         |
| **195** | **0.077**    | **0.086**    | **0.091**    | 0.107         | 0.120         | 0.127         |
| 210     | 0.078        | 0.087        | 0.092        | 0.108         | 0.122         | 0.128         |
| 240     | 0.103        | 0.116        | 0.122        | 0.143         | 0.161         | 0.149         |
| 270     | 0.295        | 0.278        | 0.259        | 0.201         | 0.155         | 0.132         |
| 300     | 0.240        | 0.270        | 0.285        | 0.240         | 0.184         | 0.157         |
| 330     | 0.205        | 0.230        | 0.243        | 0.285         | 0.310         | 0.257         |
| 0       | 0.182        | 0.205        | 0.216        | 0.253         | 0.207         | 0.172         |

Over the full circle the spread is **2.1×–4.0×** depending on lightness (Solar at
L 0.449: min 0.076 at h 200, max 0.309 at h 265). Targets: the accent's own chroma —
0.1107 (Solar) / 0.1158 (Astral), which brackets the shipped `sea` (0.0669 / 0.1063)
and `astra` (0.1423 / 0.1441).

**Where it hurts.** The trough sits at h ≈ 195–215 — cyan/teal — which is _inside_
the allowed arc, near its start. Under the recommended set:

| Tone                 | Solar flattening | Astral flattening |
| -------------------- | ---------------- | ----------------- |
| tone-1 (h 188 / 199) | **30%**          | 8%                |
| tone-2 (h 211 / 222) | **30%**          | 1%                |
| tone-3 (h 236 / 247) | 12%              | 0%                |
| tone-4 … tone-8      | 0%               | 0%                |

So **the first two or three tones are visibly duller than the rest in Solar** — they
sit at C ≈ 0.078 against the others' 0.111, a 30% chroma deficit. The set does _not_
read as equally weighted at the teal end. Two of the shipped tokens already live here
(`--color-sea` at C 0.0669 is _below_ the gamut ceiling by choice), so it is consistent
with the identity — but it is a real inequality, and it worsens if you push chroma up:
`calc(c * 1.15)` drives Solar flattening to 32% while buying only +0.5 ΔE00 overall.

Astral is far less affected because its higher lightness keeps the teal region roomier;
the Astral trough is instead in blue/violet at high L (max C 0.132 at h 270, L 0.742).

## 5. Contrast

**Recipe A — the brief as literally written, `oklch(from var(--color-accent) l c calc(h+R))`:**

| Scheme | contrast on `--color-surface` across all 360 hues | tones under 4.5:1 |
| ------ | ------------------------------------------------- | ----------------- |
| Solar  | **3.98 – 4.56**                                   | 9 of 12           |
| Astral | 8.68 – 9.62                                       | 0 of 12           |

Solar fails almost everywhere, because the accent's own L is too light: `--color-gold`
ships at **4.37:1** on `--color-surface` and already misses AA. Inheriting `l`
inherits that failure. On the `-soft` composite it is worse: 3.34–3.82:1 for every hue.

**Recipe B — `calc(l * 0.9)`:** Solar L → 0.505 (exactly `sea`'s L), Astral L → 0.703
(exactly `astra`'s L). Both land on shipped values. This is the recipe that works.

Recommended 8-tone set, all four backgrounds:

| Tone   | Solar on surface | Solar on sunken | Solar on own soft | Astral on surface | Astral on sunken | Astral on own soft |
| ------ | ---------------- | --------------- | ----------------- | ----------------- | ---------------- | ------------------ |
| tone-1 | 6.39             | 5.25            | 5.16              | 5.45              | 5.69             | 4.61               |
| tone-2 | 6.46             | 5.32            | 5.22              | 5.29              | 5.53             | 4.48               |
| tone-3 | 6.69             | 5.50            | 5.38              | 5.15              | 5.38             | 4.33 ⚠             |
| tone-4 | 4.91             | 4.04 ⚠          | 4.10 ⚠            | 7.80              | 8.14             | 6.15               |
| tone-5 | 7.16             | 5.89            | 5.79              | 4.92              | 5.14             | 4.15 ⚠             |
| tone-6 | 5.06             | 4.17 ⚠          | 4.22 ⚠            | 7.61              | 7.94             | 6.05               |
| tone-7 | 7.34             | 6.04            | 5.91              | 4.82              | 5.03             | 4.11 ⚠             |
| tone-8 | 5.13             | 4.22 ⚠          | 4.26 ⚠            | 7.55              | 7.88             | 6.05               |

⚠ = under 4.5:1. **Nothing is under 3:1 anywhere.** Every tone clears 4.5:1 as text on
`--color-surface` in both schemes, which is the constraint the set was solved under.

**On the chip composition it is a different story — and so is the status quo.** The
shipped `sea` chip is `text-sea` on `bg-sea-soft` = **4.38:1**, already under AA;
`astra` is 5.33:1; `gold` is 3.68:1. So `--color-tone-*` on `-soft` at 4.10–5.91:1
is _comparable to what ships today_, not a new regression. But it is pre-existing
debt: chip text is 11px small-caps (`--text-2xs`, `chip.component.ts`), unambiguously
"normal text" for WCAG 1.4.3, so 4.5:1 is required and not met. Fixing it properly
means either a darker `-ink` derivative for text-in-chip (`calc(l * 0.72)`) or a
heavier fill — see §6, which wants a heavier fill anyway.

If you _require_ 4.5:1 on the soft composite, the whole system collapses: max-min
ΔE00 falls to 4.4 at N = 8 and 2.8 at N = 12. That constraint is unsatisfiable
alongside 12 categories.

## 6. Distinguishability

Minimum pairwise ΔE00, ΔE-optimised placement, exclusion at ΔE00 ≥ 20:

| N   | tones, Solar | tones, Astral | `-soft` fills, Solar | `-soft` fills, Astral |
| --- | ------------ | ------------- | -------------------- | --------------------- |
| 6   | 12.4         | 12.4          | 1.7                  | 2.7                   |
| 7   | 10.4         | 10.4          | 1.4                  | 2.2                   |
| 8   | 8.9          | 9.0           | 1.2                  | 1.9                   |
| 9   | 7.8          | 7.8           | 1.0                  | 1.7                   |
| 10  | 6.9          | 7.1           | 0.9                  | 1.5                   |
| 12  | **5.6**      | **5.7**       | **0.8**              | **1.2**               |

(The N = 12 row here is the ΔE-optimised iso-lightness placement; the evenly-spaced
12 quoted elsewhere is slightly worse at 4.8 / 5.2.)

For reference: shipped `sea` ↔ `astra` is **23.7** (Solar) / **37.7** (Astral); the
shipped `-soft` fills are **9.0** / **11.2** apart.

**The `-soft` fills are the harder case and they fail at every N.** ΔE00 ≈ 1 is below
a single JND for large adjacent patches, let alone small pills scanned across a panel.
Alpha sweep, at optimal placement:

| α                  | N = 7 (S / A) | N = 9     | N = 12    |
| ------------------ | ------------- | --------- | --------- |
| **0.14** (shipped) | 1.4 / 2.2     | 1.0 / 1.7 | 0.8 / 1.2 |
| 0.20               | 2.0 / 3.2     | 1.5 / 2.4 | 1.1 / 1.7 |
| 0.28               | 2.8 / 4.3     | 2.1 / 3.2 | 1.5 / 2.3 |
| 0.40               | 4.0 / 5.6     | 2.9 / 4.2 | 2.2 / 3.1 |
| 0.55               | 5.5 / 7.2     | 4.0 / 5.3 | 3.0 / 3.9 |

You cannot buy category identity out of a 14% tint. Raise α to ~0.4–0.55, or accept
that the fill is a neutral "this is a chip" cue and the _text and border_ carry the
category. The latter is cheaper and matches how `chip.component.ts` already builds the
border (`color-mix(… 36%, transparent)`). For the recommended 8-tone set the border at
36% separates at ΔE00 3.7 (Solar) / 5.3 (Astral) versus 1.4 / 2.2 for the 14% fill —
2.5× better, and still not enough on its own. Only the text colour, at full strength,
carries the category reliably.

**Colour-vision deficiency — the finding that should worry you most.** Because the
exclusion forces every tone onto the cyan → blue → violet → magenta arc, and teal/magenta
is the canonical deuteranope confusion pair, the set collapses:

Minimum pairwise ΔE00, worse of the two schemes, for the exact sets published here:

| Set                              | normal vision | protanope | deuteranope | tritanope |
| -------------------------------- | ------------- | --------- | ----------- | --------- |
| shipped `sea` ↔ `astra` (Solar)  | 23.7          | 19.3      | **14.5**    | 9.4       |
| shipped `sea` ↔ `astra` (Astral) | 37.7          | 30.6      | **19.9**    | 9.1       |
| 12 pure rotations                | 4.8           | 1.1       | **0.1**     | 0.0       |
| 7 pure rotations                 | 10.3          | 2.1       | **0.3**     | 0.2       |
| 8, recommended ladder            | 10.8          | 3.1       | **0.6**     | 0.3       |
| 12 even, exclusion dropped       | 10.1          | 2.3       | **0.2**     | 0.1       |

Iso-lightness max-min ΔE00 as a deuteranope, showing what the exclusion costs:

| N   | full circle | exclusion ΔE00 ≥ 20 |
| --- | ----------- | ------------------- |
| 4   | 14.9        | 5.6                 |
| 6   | 8.9         | 3.3                 |
| 7   | 7.2         | 2.8                 |
| 8   | 6.1         | 2.3                 |
| 12  | 3.9         | 1.4                 |

**No hue-rotation set of more than ~4 tones is distinguishable to a deuteranope, and
the exclusion makes it ~2.6× worse.** This is not a WCAG conformance failure — the chip
carries a text label, so colour is redundant coding and 1.4.1 is satisfied — but it
means the tone token is decoration, not identity, for ~8% of male users. If categories
must be identifiable by colour, hue rotation is the wrong mechanism regardless of N.
A four-level lightness ladder recovers deuteranope ΔE00 to 8.7 at N = 7, at the cost of
tones that no longer read as one weight.

## 7. Verdict, and the cost of the exclusion

**Acceptance bars** (each defensible from repo data or the composition itself):

1. min pairwise ΔE00 ≥ 10 — less than half the design's shipped categorical minimum of 23.7, and ~4× the 2.3 large-patch JND, to allow for 11px glyphs compared from memory.
2. every tone ≥ 4.5:1 as text on `--color-surface` in both schemes.
3. every tone ≥ 4.10:1 on its own `-soft` fill (`--color-gold` ships at 3.68, `--color-sea` at 4.38).
4. ΔE00 ≥ 20 from danger, success and the accent at matched L, C.

**Where the constraints stop binding:**

| N     | pure rotation (`calc(l*0.9)`) | two-level ladder (`calc(l*0.95)` / `calc(l*0.80)`) |
| ----- | ----------------------------- | -------------------------------------------------- |
| 6     | 12.4 ✓                        | 13.8 ✓                                             |
| **7** | **10.4 ✓**                    | 12.4 ✓                                             |
| **8** | 8.9 ✗                         | **11.0 ✓**                                         |
| 9     | 7.8 ✗                         | 10.2 ✓                                             |
| 10    | 6.9 ✗                         | 9.8 ✗                                              |
| 11    | 6.2 ✗                         | 9.0 ✗                                              |
| 12    | 5.6 ✗                         | 8.6 ✗                                              |

- **Pure hue rotation: 7.** Bar 1 breaks between 7 and 8.
- **With one lightness step: 9**, comfortably 8. Bar 1 breaks between 9 and 10.
- **12 never passes** under bars 1–4. Dropping bar 3 lets 12+ladder reach 9.86 — still short, and with one tone at exactly 4.50:1.

**What the exclusion costs.** Max-min ΔE00 achievable, iso-lightness:

| N   | full circle | exclusion ΔE00 ≥ 15 | exclusion ΔE00 ≥ 20 |
| --- | ----------- | ------------------- | ------------------- |
| 7   | 21.3        | 12.0                | 10.3                |
| 8   | 19.0        | 10.4                | 8.8                 |
| 12  | 12.6        | 6.6                 | 5.6                 |
| 14  | 10.8        | 5.5                 | 4.7                 |

At a ΔE00 ≥ 10 floor: **~15 tones on the full circle, 8 with a 15-unit exclusion,
7 with a 20-unit exclusion.** The exclusion halves the palette. Tightening it from 15
to 20 costs only one tone — so the _width_ choice barely matters; having an exclusion
at all is what costs.

And the exclusion is not optional. Twelve tones spaced evenly at 30° on the full
circle (recipe B) look fine on every other metric — min ΔE00 10.1 / 10.9, zero contrast
failures — but:

|                                                         | Solar   | Astral  |
| ------------------------------------------------------- | ------- | ------- |
| min ΔE00 to nearest shipped status token                | **1.6** | 6.8     |
| min ΔE00 to danger/success/accent _hue_ at matched L, C | **0.0** | **0.0** |

Tone-1 at rotation 0 **is** the accent (`#895a00` / `#c09940`), and Solar's `+60`
(`#47722d`, h 135) sits ΔE00 1.6 from `--color-positive` `#4a6f2f` — indistinguishable.
The exclusion is doing exactly the job it was specified for; it is simply expensive.

---

## Recommended set — 8 tones

```css
/* Categorical tones, derived from the accent (spike-tone-rotation.md).
   Two lightness rows: the hue arc left by the danger/success/accent exclusion
   is only 161° wide, too narrow to separate 8 hues on lightness alone. */
--color-tone-1: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 113));
--color-tone-2: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 136));
--color-tone-3: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 161));
--color-tone-4: oklch(from var(--color-accent) calc(l * 0.95) c calc(h + 193));
--color-tone-5: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 207));
--color-tone-6: oklch(from var(--color-accent) calc(l * 0.95) c calc(h + 230));
--color-tone-7: oklch(from var(--color-accent) calc(l * 0.8) c calc(h + 250));
--color-tone-8: oklch(from var(--color-accent) calc(l * 0.95) c calc(h + 270));

/* -soft fills. These are NOT category-bearing (min ΔE00 1.4) — treat as a
   neutral chip tint and let the text + border carry identity. */
--color-tone-1-soft: oklch(from var(--color-tone-1) l c h / 0.14);
/* … */
```

Resulting values (min pairwise ΔE00 10.9 Solar / 10.8 Astral; min angular gap 14°):

| Token            | rotation | L        | Solar h | Solar     | Solar `-soft` | Astral h | Astral    | Astral `-soft` |
| ---------------- | -------- | -------- | ------- | --------- | ------------- | -------- | --------- | -------------- |
| `--color-tone-1` | +113     | `l*0.80` | 188°    | `#00655f` | `#d8e2d4`     | 199°     | `#009ca1` | `#0e263c`      |
| `--color-tone-2` | +136     | `l*0.80` | 211°    | `#006274` | `#d8e1d7`     | 222°     | `#0096b9` | `#0e253f`      |
| `--color-tone-3` | +161     | `l*0.80` | 236°    | `#005c8a` | `#d8e0da`     | 247°     | `#468dc9` | `#182441`      |
| `--color-tone-4` | +193     | `l*0.95` | 268°    | `#5169ad` | `#e3e2df`     | 279°     | `#9ba3f4` | `#232747`      |
| `--color-tone-5` | +207     | `l*0.80` | 282°    | `#4d4b90` | `#e3dedb`     | 293°     | `#8a79c7` | `#212141`      |
| `--color-tone-6` | +230     | `l*0.95` | 305°    | `#7c5aa0` | `#e9e0dd`     | 316°     | `#c894dd` | `#2a2544`      |
| `--color-tone-7` | +250     | `l*0.80` | 325°    | `#733c76` | `#e8dcd7`     | 336°     | `#b36ba3` | `#271f3c`      |
| `--color-tone-8` | +270     | `l*0.95` | 345°    | `#99507b` | `#eddfd8`     | 356°     | `#e58cae` | `#2e243d`      |

Solar runs teal → steel → indigo → violet → plum → mulberry. Astral runs the same
progression brighter: aurora-teal → cyan → cornflower → periwinkle → orchid → rose.
Both stay recognisably within the Celestial Codex identity — Solar's tone-1/2 are
close to today's `--color-sea`, and tone-5 is close to `--color-astra`.

### If pure hue rotation matters more than the eighth tone

7 tones, one expression, one lightness, equal weight — min pairwise ΔE00 10.3,
min angular gap 21°, all ≥ 4.99:1 on `--color-surface` in Solar and ≥ 6.53:1 in Astral:

```css
--color-tone-N: oklch(from var(--color-accent) calc(l * 0.9) c calc(h + R));
```

| rotation | Solar     | Astral    |
| -------- | --------- | --------- |
| +110     | `#00786d` | `#1bb5b6` |
| +131     | `#007582` | `#2bb1ce` |
| +154     | `#006f97` | `#53a8e0` |
| +182     | `#3965a3` | `#809ce8` |
| +209     | `#5e5aa1` | `#a490e0` |
| +239     | `#7c4f90` | `#c386c7` |
| +270     | `#904873` | `#d880a2` |

## Caveats on the CSS

- Relative colour syntax (`oklch(from …)`) needs Chrome 119+, Safari 16.4+, Firefox 128+.
- All hexes above are the result of the **CSS Color 4 gamut-mapping algorithm**
  (chroma reduction with MINDE local clipping, JND 0.02), which is what browsers apply
  to an out-of-gamut `oklch()` in an sRGB context — not naive per-channel clipping.
  Solar tone-1/tone-2 are gamut-mapped; the rest are in gamut as specified.
- `--color-accent` does not exist yet; the spike assumes `--color-gold` is renamed to it.
- The 8-tone set's lightness rows invert their visual weight between schemes (§ Verdict,
  finding 3). If a consistent emphasis ordering across themes is required, take the
  7-tone iso-lightness set instead.
