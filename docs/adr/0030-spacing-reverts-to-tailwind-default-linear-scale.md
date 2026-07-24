# Spacing reverts to Tailwind's default linear scale

Spacing drops the bespoke non-linear `--spacing-1..9` keys and the `no-off-scale-spacing` lint fence introduced by ADR-0020, and uses **Tailwind's default linear scale** (`calc(var(--spacing) * N)`, base `0.25rem`) with every step open. The curation was friction without a payoff: the fence blocked ordinary steps (`p-10`, `p-2.5`) and forced bracket opt-outs for anything off the nine curated values, while the "rhythm" it protected was never load-bearing. This supersedes **only** the spacing portion of ADR-0020; colours/type/radii staying in `@theme`, `no-unknown-design-token`, and the composite-shell utility allowance are unaffected.

## Considered Options

**Keep the curated scale (ADR-0020 status quo).** Rejected — that's the friction we're removing. The fence's value was "preserve a deliberate whitespace rhythm," but in practice it mostly produced lint errors on reasonable utilities and `[…]` escapes, with no design review actually leaning on the nine-step constraint.

**Drop the lint fence but keep the bespoke `--spacing-1..9` values.** Rejected. It opens the vocabulary but leaves a scale that is non-linear for 1–9 and linear above — `p-9` (96px) sits next to `p-10` (40px). One consistent scale beats a curated head grafted onto a linear tail.

## Consequences

- **Existing 5–9 usages were renumbered to preserve pixels**, not left to shrink. The old values were a clean subset of Tailwind's scale, so the migration is a pure rename: `p-5→p-6` (24px), `p-6→p-8` (32px), `p-7→p-12` (48px), `p-8→p-16` (64px), `p-9→p-24` (96px); steps 1–4 keep their names. The app renders pixel-identical; only the vocabulary opened.
- **No named `--spacing-N` properties exist anymore.** Tailwind's default scale emits only the base `--spacing`; scoped CSS-in-TS that previously read `var(--spacing-N)` now uses `calc(var(--spacing) * N)`. `--spacing` is allowlisted in `no-unknown-design-token` — with the named keys gone it is the only spacing var, so there's no `--spacing-N` it could be a silent typo for.
- **`no-off-scale-spacing` is deleted** (rule, its CSS `spacingSteps` reader, and the eslint registration). `no-unknown-design-token` and `no-builtin-shadow` are untouched. Stale mentions of the fence in ADR-0020/0021 are left as historical record; this ADR is the live word.
