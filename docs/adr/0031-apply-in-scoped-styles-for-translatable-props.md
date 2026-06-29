# Primitive scoped styles use `@apply` for translatable properties

Component `styles:` blocks express their translatable static properties with `@apply` (Tailwind utilities) instead of raw CSS, reaching the theme via a `@reference` to the global sheet. Only the *irreducible custom core* stays raw. This **revises ADR-0020's rejection of `@apply`** ("not worth the tax") and **extends ADR-0021's hybrid seam** from inline-template utilities to the scoped `styles:` surface itself.

Two things changed since ADR-0020 said no:
1. **Tailwind v4 functional shorthand** — `text-(--_fg)` / `bg-(--_bg)` / `border-(--_bd)` expand to `color: var(--_fg)` etc., so a primitive's private-var *consumption* converts. The base rule no longer has to split across two surfaces.
2. **ADR-0030 removed the bespoke spacing keys**, making `calc(var(--spacing) * N)` (or `@apply gap-2`) the scoped spacing form anyway — so adopting `@apply` is a small step, not a new vocabulary.

The "tax" ADR-0020 feared was re-examined and mostly didn't survive: under Angular emulated view-encapsulation every component's styles are **already** compiled and inlined per-component, so `@apply gap-2` and `gap: …` produce identical output — there is **no atomic-dedup loss** in the scoped-vs-scoped comparison (the dedup argument only applies to `@apply`-in-styles vs `class="…"`-in-template). The `@reference` line is one line per file and build cost is negligible at this scale.

## The seam

- **`@apply` (utilities)** — every property that maps 1:1, **including private-var consumption** via functional shorthand: layout, sizing, spacing, type, radii, the project's `shadow-1/2/3/inset` utilities, `text-(--_fg)`, `bg-(--_bg)`, `border border-(--_bd)`.
- **Raw CSS** — the irreducible custom core, which has no utility form and stays in plain declarations:
  - private-var **assignment** (`--_fg: var(--color-on-gilded)`) — no utility assigns to a `--_…`;
  - `color-mix()`, gradients (`var(--gradient-gold-radial)`);
  - bespoke multi-property `transition`s on the `--dur-…`/`--ease-…` motion tokens;
  - composite or literal-geometry `box-shadow`s (`0 0 0 3px …`).
- **Don't convert at all** when `@apply` is a *net loss*: a single-declaration rule (the `@reference` line costs more than it saves — `dialog`), a rule that's all arbitrary `em`/glyph values (`eyebrow`), or one that would hit `@apply`'s source-order gotcha (`border: 0` + `border-top` resolve by utility source order, not `@apply` argument order — `rule`).

The win scales inversely with how much a component leans on the raw core: flat primitives (`chip`, `panel`, `dot`) collapse to a line or two; composition-heavy ones (`button`, `icon-button`) convert their base + state rules but keep raw variant cores — `@apply` never makes a rule *worse*, it just helps less.

## `@reference` convention

Each component references the global sheet via a **Node subpath import** — `@reference '#app-styles.css'` — mapped in the root `package.json`:

```json
"imports": { "#app-styles.css": "./apps/web/src/styles.css" }
```

Tailwind v4 resolves `@reference` through `enhanced-resolve`, which honors the `imports` field, so the specifier is **depth-invariant**: the same `#app-styles.css` works from any folder, no `../../` to count or break on a move. (TS path aliases don't help here — Tailwind's CSS resolver doesn't read `tsconfig`; the package `imports` field is the portable mechanism it does honor.)

## Tooling

The `hexly-design` lint rules (`no-unknown-design-token`, `no-builtin-shadow`) now **strip CSS block comments before scanning**, so a prose word like "shadow" or a `var(--…)` shown in an example comment no longer false-positives. Authors must still avoid a literal `*/` inside a block comment (it closes the comment early — write `--dur-… / --ease-…`, not `--dur-*/--ease-*`); that's a CSS limitation, not lintable.

## Consequences

- Primitives in `app/ui/` carry an `@apply` seam; the raw remainder is the custom core ADR-0007 exists to protect. Inline-template utilities (ADR-0021) remain the rule for static template elements and composite view shells.
- Out of scope: page/feature components keep their scoped `calc(var(--spacing) * N)` refs for now; they may adopt the same seam later, but they aren't primitives.
- `dialog`, `eyebrow`, `rule` deliberately stay raw — recorded above so a future reader doesn't "finish the job" and regress them.
