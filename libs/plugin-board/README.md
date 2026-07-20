# plugin-board

The bundled Board plugin (CONTEXT.md → Board, ADR-0062, #263): the `core.type.board` Entity Type, the
`core.datatype.board-surface` **Structured Data Type** that _is_ its surface, and (in the `-web` half) the canvas
that composes it. The free-positioned 2D sibling of the **Hex Map**, built the same way.

Two entry points, because a plugin's halves have different consumers:

- `@hexly/plugin-board` — framework-free: the surface document (`boardSurfaceSchema` and its three
  Board Element kinds — Image, Embed, Text Block), the pure element/z-order helpers (add, remove,
  bring-forward/backward, to-front/back), the `core.datatype.board-surface` data-type (its schema, its empty
  plane, its edge/text harvesters), and the `core.type.board` `defineType()`. The API names it in `bundled-plugins.ts` and from that alone gets surface
  validation, edge-harvesting, and vault projection — `apps/api` carries no board-specific code. Must
  never see Angular.
- `@hexly/plugin-board/web` — the Angular half (a later seam): the canvas, the tool palette, the
  Inspector, and the View-registry-driven Embed transclusion.

`@hexly/plugin-board/server` is the API-side entry point (`serverPluginBoard()`), a thin mirror of
`serverPluginHexmap`: it registers the type, the surface Field, and the data-type, and declares the
`maxEmbedDepth` config knob (`features.plugin.board.maxEmbedDepth`, default 3) that bounds Embed
transclusion depth (ADR-0062).

With no `-web` plugin registered, an existing Board opens on the **generic Field View** with its surface
and lore intact as EntityDocument values — the ordinary absent-plugin degradation — and round-trips
through the Vault (surface → frontmatter, lore → body).

The ids keep the `core.` namespace (`core.type.board`, `core.datatype.board-surface`, `core.field.surface`) though the code
compiles from a plugin lib: a namespace names who owns the vocabulary, not which lib ships it, and
`core.` means "in the box" (ADR-0050).
