# Inline Tailwind utilities for static styling; scoped CSS reserved for state

Component styling splits along a single seam: **static, single-value styling is
expressed as inline Tailwind utilities** (in the template's `class`, or in
`host: { class }` for the host element), while **stateful, variant, and
composed styling stays in the component's scoped `styles:` block**. This
**amends how ADR-0007 is applied** — it does not reopen its core. Primitives
still *own* their visual definition and there is still no global component-class
layer; what changes is that the on-brand utilities ADR-0020 generated from the
token `@theme` become the default expression for the styling that translates
1:1, instead of every declaration living in `styles:`.

ADR-0007 was written before ADR-0020. At that time a utility like `bg-surface`
either didn't exist or wasn't wired to the tokens, so "the component owns its
styles" necessarily meant "all of it lives in `styles:`". ADR-0020 made the
tokens *be* the Tailwind theme: `bg-surface`, `text-ink-muted`, `gap-5`,
`rounded-lg`, `font-display`, `text-md`, `shadow-1` now resolve to the exact
same `var(--…)` the scoped CSS used, re-theme under `[data-theme]` for free, and
are lint-guarded (`hexly-design/no-off-scale-spacing`,
`no-unknown-design-token`). That removes the original reason to route static
layout/spacing/colour/type through `styles:`.

## Considered Options

**Keep everything in `styles:` (status quo from ADR-0007).** Rejected: it
duplicates the token vocabulary in long CSS-in-TS strings for styling that a
single utility says more legibly (`gap-2` vs a four-line `:host` rule), and it
leaves the generated utilities ADR-0020 shipped almost entirely unused.

**Move everything to utilities, including variants and state.** Rejected. The
primitives' stateful core — `Button`'s `--_fg`/`--_bg`/`--_bd` composition
reassigned across `:host(.is-primary)` / `:host(:hover)` / `:host(:disabled)`,
focus rings, pseudo-elements, transitions on the custom `--dur-*` scale,
`color-mix()`, gradients, `@media` — either has no clean utility or would
fragment one logical rule across two surfaces (utilities + leftover CSS) and
invite specificity surprises. This is exactly the scoped, owned styling
ADR-0007 exists to protect.

**The hybrid seam (chosen).** Convert a rule to utilities only when *every*
property in it maps 1:1 and the rule carries no state; otherwise leave the whole
rule scoped.

## Decision

- **Static template elements → inline utilities.** A template element whose
  styling is static and fully translatable carries its utilities directly in
  `class="…"`; the now-dead scoped class rule is deleted. Class hooks that a
  test or sibling/descendant CSS rule selects are kept.
- **Static host → `host: { class }`.** When a component's `:host` is static,
  fully translatable, and has **no** `:host(...)` variants and no `--_…`
  composition, its styling moves to `host: { class: '…' }` and the `:host`
  block is removed. This is the composite-shell allowance ADR-0020 already
  carved out, now stated as the general rule. The moment a component has any
  `:host(...)` variant or token-composition on the host, the **entire** host
  styling stays in `styles:`.
- **Simple pseudo-state → a Tailwind variant.** A rule whose only "state" is a
  pseudo-class (`:hover`, `:focus`, `:focus-visible`, `:active`, `:disabled`,
  `:enabled`) and whose properties all map 1:1 becomes a variant utility on the
  element (`hover:bg-gold-soft`, `disabled:opacity-50`). State is *not* a reason
  to stay scoped on its own — the question is always whether the properties
  translate.
- **These keep the whole element scoped** (the genuinely-can't cases):
  - **`--_…` composition** — a `:host(.is-*)` variant reassigns a component-local
    var that the base rule reads (e.g. `Button`'s `--_fg`/`--_bg`/`--_bd`). No
    set of utilities expresses "one variant changes a value many properties
    consume."
  - **Class-toggle state** (`.is-active`, `.option.active`, `.toast.is-error`) —
    an element styled by its *own* toggled state. This is usually still
    expressible *without* scoped CSS, and the preferred order is:
    1. **An attribute the element already exposes for a11y** + a Tailwind
       attribute variant. The selected region row carries
       `[attr.aria-current]`, so its state is just
       `aria-[current=true]:bg-gold-soft …` — the variant's attribute selector
       out-specifies the base utility, so there's no conflict and the a11y
       attribute and the visual stay in sync by construction.
    2. **Angular conditional class bindings** (`[class.bg-gold-soft]="active()"`)
       — the codebase's idiom (it uses no `ngClass`). Toggle base and active
       utilities as *mutually exclusive* pairs (`[class.bg-transparent]="!active()"`)
       so two conflicting utilities are never simultaneously applied.
    It stays scoped only when neither reads cleanly — e.g. a variant matrix
    large enough that mutually-exclusive pairs are noisier than a named rule, or
    a state entangled with one of the other blockers below.
  - **Transitions/animations** — motion is kept as raw `--dur-*`/`--ease-*` vars
    (ADR-0020), with no utility scale, so any rule with a `transition` stays
    scoped. When the *base* rule stays scoped for this reason, its sibling
    pseudo-states stay with it rather than scattering one element across both
    surfaces.
  - **Reaching into another primitive's host** — a consumer cannot reliably
    restyle a primitive from outside: a component's emulated styles are
    *unlayered* and so beat any `@layer utilities` rule regardless of source
    order, and matching its `:host` specificity is an order-dependent coin-flip.
    Don't paper over this with a scoped override (e.g. an option recolouring
    `appButton`) — **augment the primitive's typed API** instead. The language
    switcher's selected segment became `appButton`'s `[active]` input, owned by
    the primitive, not a `.option.active` override.
  - Plus the per-property non-translatables: pseudo-elements
    (`::before`/`::after`/`::placeholder`), `color-mix()`, `calc()`, gradients,
    `@media`, combinators, attribute-selector rules, and properties with no
    utility (`touch-action`, `background-clip`, `font: inherit`).
- **A rule is never split across the two surfaces.** When a rule mixes
  convertible and non-convertible properties, the whole rule stays scoped.
- **One rule, one home.** The deciding test is per-rule, not per-component: a
  component routinely ends up with a `host: { class }` *and* a residual
  `styles:` block, and that is the intended shape, not a smell.

## Consequences

- Most atoms and view shells shed their `styles:` block entirely (the icon
  glyphs, `status-bar`, `editor-rail`, `region-fields`, `cartouche`, …); the
  stateful primitives (`Button`, `Chip`, `Panel`, `Input`, `Dot`, …) keep
  theirs largely intact. Reading a component, the utilities tell you its layout
  at a glance and the `styles:` block is now *only* its interesting,
  state-dependent styling.
- ADR-0007 still holds: no global component-class layer, primitives own their
  look, glyphs are components. "Owns its styles" now includes "owns its
  `host: { class }`", which is still the component's own declaration.
- The split is mechanical and lint-guarded, so it's safe to apply
  incrementally and to enforce on new components: reach for a utility first;
  drop to `styles:` when the styling is stateful or has no 1:1 utility.
- Theming is unaffected — utilities resolve to the same `var(--color-*)` that
  `[data-theme='dark']` reassigns (ADR-0020), so converted styling re-themes
  identically with no `dark:` variants.
