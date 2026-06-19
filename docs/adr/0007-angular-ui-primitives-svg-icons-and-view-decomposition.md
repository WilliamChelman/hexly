# UI primitives as Angular directives/components, SVG icons as components, and decomposed view shells

Reusable UI is expressed as **Angular primitives** — directives for native-element widgets, components for presentational ones — not as global CSS component classes applied by hand. SVG glyphs live in **their own components**, never inlined into feature templates. Large view shells are **decomposed** into one component per region rather than one file rendering the whole screen.

This **amends how ADR-0006 is applied**, not its core. ADR-0006's token layer stands unchanged: colours, type, spacing, radii, and terrain fills remain CSS custom properties on `:root`/`[data-theme]`, because the Canvas renderer (ADR-0003) paints with `var(--terrain-forest)` and a directive/component cannot reach that surface. What changes is the *second half* of ADR-0006 — the shared **global component classes** (`.btn`, `.chip`, `.tool`, `.panel`, `.coord`, …). Those manufactured a flat global namespace and were applied as string soup (`class="btn btn--primary btn--sm"`); in a component framework that work belongs to typed primitives.

## Considered Options

**Keep global component classes + BEM in component styles.** The status quo from ADR-0006. Rejected for three reasons that surfaced in review:

1. **The classes want to be primitives.** `.btn`/`.chip`/`.coord` are reusable UI, and the framework's unit of reuse is a directive or component, not a memorised class string. A typed `appButton` with `variant`/`size`/`danger` inputs is discoverable, refactor-safe, and can't be mis-spelled.
2. **BEM in `styles` is redundant.** Angular view-encapsulation already scopes a component's CSS (`[_ngcontent-…]`). The `block__element--modifier` ceremony only earns its keep in a *global* sheet; inside an encapsulated component `.shell__header` buys nothing over `.header`. Where BEM-density felt necessary to navigate a template, that was a **size smell**, not a need for namespacing.
3. **Inlined SVG sprites bloat templates.** A 180-line `<defs>` sprite and `<use href="#g-…">` references made `editor-shell` hard to read and impossible to reuse a glyph elsewhere without copying the sprite.

**Wrapper components for everything (`<app-button>`).** Rejected for native-element widgets. Wrapping a `<button>`/`<input>` in a host element loses the real element's type, form participation, focus, and a11y, forcing re-implementation. The Material/CDK split is better.

## Decision

- **Native-element widgets → attribute directives.** `appButton` selects `button[appButton], a[appButton]` and keeps the real element. Because **a directive cannot own styles**, its visual definition stays in the token-driven global layer (`components.css` `.btn*`); the directive's job is to map typed inputs (`variant`, `size`, `icon`, `danger`) onto those classes. This is consistent with ADR-0006's "look is global, behaviour/structure is local."
- **Presentational widgets → components** that own their styles and drop the global class.
- **SVG glyphs → one component each** (`app-icon-*`), plus an `app-icon` dispatcher that selects by `name`. Nothing inlines an icon's markup into a feature template. **Exception:** glyphs drawn *inside* an SVG illustration (the map's feature markers) can't be HTML components — SVG-in-SVG crosses the namespace — so they live as a `<defs>` local to that illustration's own component (`MapCanvas`). The illustration is itself "the SVG in its own component."
- **View shells → one component per region.** `editor-shell` becomes a layout orchestrator over `app-editor-header`, `app-tool-palette`, `app-map-canvas`, `app-inspector`, `app-status-bar`. Each owns its own markup, data, and short structural class names — so the `shell__`/`tools__`/`inspector__` BEM prefixes disappear by construction.
- **Selector prefix is `app`** (per the workspace eslint `@angular-eslint/*-selector` rules), hence `appButton` and `app-icon-*` rather than a `hexly`-prefixed name. Renaming the workspace prefix is a separate decision.

Primitives currently live under `apps/web/src/app/ui/`. They may graduate to a `libs/ui` Nx library once a second app consumes them; that move is deferred until there's a real second consumer.

## Consequences

- A directive can't own styles, so `appButton` and the global `.btn*` classes **coexist by design**: the directive maps inputs onto those classes rather than redefining them. Any element is styled by one system or the other, never both at once, so they don't conflict — code not (yet) expressed as a primitive keeps applying the global class directly.
- Reviewers should read a region's component, not a 700-line shell. Armed-tool state is owned by `ToolPalette` for now (the canvas is a frozen placeholder per ADR-0003); when painting is wired (ADR-0005) it graduates to an editor-state service shared by palette and canvas.
- A glyph used both as an HTML icon and as an in-map marker (e.g. *settlement*) is defined twice — once as an `app-icon-*` component, once in the `MapCanvas` `<defs>`. Accepted: the map SVG is a placeholder, and the duplication is local and small.
