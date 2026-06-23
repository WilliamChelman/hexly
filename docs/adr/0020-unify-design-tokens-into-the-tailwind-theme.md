# Design tokens unify into the Tailwind `@theme`, with spacing as explicit keys and a lint-enforced scale

The design-token layer and Tailwind's theme become **one source of truth**: every utility-shaped token — colours, radii, fonts, the **type scale**, shadows, and **spacing** — is declared inside `@theme` so that the same value both (a) re-themes under `[data-theme]` and (b) generates an on-brand utility. This **amends ADR-0006's mechanism** (how the tokens are declared), not its identity constraints, and it does **not** revisit ADR-0007: primitives keep owning their scoped styles; this ADR governs where the *shared tokens* live, plus a narrow allowance for layout-only utilities in composite view shells.

The trigger was a half-built bridge. `styles.css` bridged colours/radii/fonts into `@theme inline` but left a parallel `--space-*` / `--surface` plain-property layer alongside the generated `--color-*`, bridged **no type scale at all** (`--text-md` had no utility), and shipped a comment — *"the spacing scale already matches"* — that is true only for steps 1–4 and silently false from 5 up (`--space-5` is 1.5rem; Tailwind's computed `5` is 1.25rem). The result was two vocabularies for the same values, a silent-failure surface (`var(--typo)` resolves to nothing), and `bg-surface`-style utilities that existed but were never used.

## The spacing finding that unlocked this

We had assumed a bespoke **non-linear** spacing scale (0.25 → 0.5 → 0.75 → 1 → 1.5 → 2 → 3 → 4 → 6 rem) was inexpressible through Tailwind v4, whose numeric utilities are computed `calc(var(--spacing) * N)`. That assumption was **wrong**. v4 resolves an explicit `--spacing-<N>` theme key *before* falling back to the multiplier — verified against the installed 4.3.1:

```css
/* @theme { --spacing-5: 1.5rem } */
.p-4 { padding: calc(var(--spacing) * 4); }   /* no key → multiplier   */
.p-5 { padding: var(--spacing-5); }            /* explicit key WINS     */
.p-6 { padding: calc(var(--spacing) * 6); }    /* no key → multiplier   */
```

So Hexly can declare `@theme { --spacing-1: .25rem; … --spacing-9: 6rem }` and get `p-5`/`gap-5`/`m-5` that emit the **exact bespoke values, under the same 1–9 names, with zero renumbering**. The values were always a curated *subset* of Tailwind's own scale; only the index numbering differed. Full alignment is therefore nearly free, which is why we do it.

## Considered Options

**Keep the partial bridge (status quo).** Rejected. It is the source of the red flags above: two vocabularies, an unbridged type scale, a misleading comment, and no automated guard against token typos. Its only real claim — that spacing *couldn't* be aligned — is now disproven.

**Reach for `@apply` to cut per-component CSS verbosity.** Rejected as a general tool. Under Angular view-encapsulation each component's `styles` is compiled in isolation, so `@apply` (and bare utilities) require a `@reference` to the global sheet **in every primitive** — re-introducing exactly the coupling ADR-0007 deleted, and inlining declarations per-component with no cross-component dedup. `@apply`'s one genuine benefit — build-time typo-checking — covers only the utility-name, not token existence (see the linter below) and not the var-indirection/`color-mix`/transition declarations that dominate a primitive like `Button`. Not worth the tax.

**Adopt Tailwind's linear scale wholesale (drop the bespoke numbering).** Rejected as unnecessary. The explicit-key mechanism preserves both the values *and* the names, so there is no reason to flatten the app's whitespace rhythm to a 0.25rem grid to "fit" Tailwind.

## Decision

- **All utility-shaped tokens live in `@theme`.** Colours, radii, font families, the **type scale** (newly bridged — `--text-*` generates `text-xs`/`text-sm`/`text-md`/…), shadows, and **spacing via explicit `--spacing-1..9` keys**. The parallel plain-property layer (`--space-*`, the standalone `--surface` aliases) collapses into the generated `--color-*` / `--spacing-*`.
- **Theming keeps the `[data-theme]` override from ADR-0006**, but on the *generated* property. Colours move to `@theme` **non-`inline`** so the override point exists: the light value lives in `@theme`, and `:root[data-theme='dark']` reassigns the generated `--color-*`. Spacing/radii/fonts are theme-invariant and stay static. The Canvas renderer (ADR-0003) reads the generated name (`var(--color-terrain-forest)`) — a mechanical rename, not a structural change.
- **A lint rule enforces the curated scale.** Because the multiplier fallback leaves off-scale steps (`p-7`, `p-10`, …) technically reachable, a stylelint/ESLint-template rule restricts spacing/colour usage to the defined token set. This guard — not `@apply` — is what catches typos *and* preserves the curation the bespoke scale exists to provide; it covers 100% of token references, including the var-indirection and `color-mix` cases utilities can't express.
- **Layout-only utilities are allowed in composite view shells.** In region/shell components (e.g. `editor-header`), pure-layout containers (`flex items-center gap-3 ml-auto`) may be expressed as inline utilities. This is the one case where utilities have no downside: no var-indirection, no state machine, and nothing a primitive would protect. Stateful or indirection-driven styling stays in the component's scoped `styles`.
- **Out of scope, by construction.** ADR-0007 stands: **primitives own their scoped styles** and are not rewritten as utility soup. Two token buckets remain outside `@theme`: **private per-component indirection vars** (`--_fg`/`--_bg`, which variants reassign) and **motion** (`--dur-*`/`--ease-*`, which Tailwind takes as raw values rather than a named scale). "One language" is explicitly *not* a goal — typed primitive inputs (`appButton variant="primary"`) are the deliberate dialect for reusable widgets.

## Consequences

- One vocabulary for shared design values: a slice asks for `bg-surface` / `gap-5` / `text-md`, and the same token re-themes and lint-checks. The `var(--space-4)`-style direct reference remains valid inside scoped styles and is still how primitives consume tokens.
- The `@theme inline` → non-`inline` shift for colours is a real wiring change (the override moves from a source var to the generated property) and must be done carefully so the before-first-paint theme script and `[data-theme='dark']` cascade still win. It is not a find-replace.
- The Canvas `<defs>` and renderer must adopt the generated `--color-terrain-*` names; a transitional alias can bridge the rename if a big-bang change is undesirable.
- The lint rule is load-bearing, not optional polish: without it, aligning to Tailwind silently *widens* the spacing vocabulary (every multiplier step becomes available), eroding the curation. Land the rule with the migration, not after.
- `apps/web/src/styles/tokens.css` shrinks toward the `@theme` block; the misleading spacing comment in `styles.css` is removed.
