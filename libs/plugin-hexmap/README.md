# plugin-hexmap

The bundled Hex Map plugin (CONTEXT.md → Hex Map, ADR-0050, #198): the `core.hexmap` Entity Type, the
`core.hex-grid` **Structured Field** data-type that _is_ its grid, and the canvas that edits it. The
first plugin with a **server half** — which is what makes the plugin seam load-bearing rather than
decorative, and what let `libs/domain` stop knowing what a hex is.

Two entry points, because a plugin's halves have different consumers:

- `@hexly/plugin-hexmap` — framework-free: the hex geometry (coordinates, layout, edges, culling,
  marquee, move-planner), the grid document (`hexMapSchema`), the `core.hex-grid` data-type (its
  schema, its empty plane, its edge harvester), and the `core.hexmap` `defineType()`. The API names it
  in `bundled-plugins.ts` beside D&D, and from that alone gets grid validation and grid
  edge-harvesting — `apps/api` carries no map-specific code of its own. Must never see Angular.
- `@hexly/plugin-hexmap/web` — the Angular half: the canvas, the tool palette, the Inspector and
  Regions dock, the `HexMapStore` the map View edits the grid through, and the lazy `map` translation
  scope (ADR-0049). It depends on `@hexly/web-entity` (the `ENTITY_SESSION` contract) and
  `@hexly/web-ui`, never on `apps/web`.

`@hexly/plugin-hexmap/testing` exports the session fake and the translation catalogs — test-only, and
never reachable from the app bundle.

The ids keep the `core.` namespace (`core.hexmap`, `core.hex-grid`, `core.view.map`) though the code
compiles from a plugin lib: a namespace names who owns the vocabulary, not which lib ships it, and
`core.` still means "in the box" (ADR-0050).

## The map's art is the map's

A Feature's marker (the settlement, the ruin) is an SVG path in `featureLibrary`, beside the ids it is
stored under — the single source of truth for both the canvas `Path2D` and the palette button, which
draws it with web-ui's `IconPath`. web-ui's own icon vocabulary carries **no** plugin art, so the
dependency runs one way: the plugin reaches for web-ui, never the reverse.
