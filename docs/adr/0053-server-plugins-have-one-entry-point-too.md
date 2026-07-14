# A bundled Plugin has one entry point into the API too, mirroring the web's `providePluginX`

ADR-0048 gave every bundled **Plugin** a single entry point into the web app: a plugin exports one
`providePluginX()`, built from `providePlugin({...})`, and `app.config.ts` names it. Types, Views,
Structured Field data-types, and translations all arrive behind that one call, so the composition root
never reaches into a plugin for its individual exports.

The API had no such symmetry. `apps/api/.../bundled-plugins.ts` imported five named exports across three
plugins (and the `/vault` subpath) and hand-assembled three parallel structures — `BUNDLED_PLUGIN_TYPES`,
`BUNDLED_STRUCTURED_DATA_TYPES`, `DEFAULT_ENTITY_TYPE`. A plugin's server contribution was stated nowhere
in the plugin: it was scattered across the composition root's import list, and adding a plugin meant
knowing which of its exports each of the three structures wanted. The web already answered "what does
this plugin give the app?" in one place; the API made you reconstruct it.

## Decision

**A bundled Plugin exports one framework-free server entry point, `serverPluginX()`, the mirror of its
`providePluginX()`.** The composition root folds the list instead of reaching into each plugin.

- **A `ServerPlugin` descriptor + `serverPlugin()` builder live in `@hexly/domain`** — the server
  counterpart to `web-entity`'s `WebPlugin` / `providePlugin`. It carries a plugin's framework-free
  contribution: its `types`, the vault-enabled `dataTypes` those types resolve against (ADR-0051), and —
  for the one plugin that owns it — the `defaultType`. Domain is the right home: it is the shared,
  framework-free lib both twins already depend on, and it already hosts `defineType` and
  `structuredDataTypeSet`.

- **Each plugin gets a `/server` subpath**, symmetric with `/web` — `@hexly/plugin-{content,hexmap,dnd}/server`,
  each exporting one `serverPluginX()`. The subpath is the honest mirror of `/web`: one import surface per
  host per plugin. It also scopes weight the way the former `/vault` subpath did — the content plugin's
  `/server` pulls the vault-enabled `core.rich-content` variant, so the ~160 kB Markdown converter toolchain
  loads through `/server` (which only the API bundles) and never through the framework-free base barrel or
  `/web`. This subsumes `/vault`: it was a one-consumer door to the same variant, and `/server` — its only
  consumer once this lands — now carries it (plus the type and default), so `/vault` is removed.

- **The composition root becomes a list + a fold.** `bundled-plugins.ts` names
  `[serverPluginContent(), serverPluginHexmap(), serverPluginDnd()]` once; `BUNDLED_PLUGIN_TYPES` is their
  `types` flattened, `BUNDLED_STRUCTURED_DATA_TYPES` is `structuredDataTypeSet` over their `dataTypes`, and
  `DEFAULT_ENTITY_TYPE` is the one plugin's declared `defaultType` (asserted unique at module load, in
  keeping with `defineType`'s throw-at-load discipline). Adding a plugin is naming its `serverPluginX()`,
  nothing more.

## Considered Options

- **Keep the hand-assembled composition root** — rejected: it works, but it is the exact asymmetry with
  the web that this removes, and every added plugin re-teaches the root which export feeds which structure.
- **Put `serverPluginX()` in each plugin's base barrel (content via `/vault`)** — rejected: lighter (no new
  subpath), but asymmetric with `/web`, and content's entry point would sit oddly under `/vault` next to
  the data-type it wraps rather than at a peer `/server` seam. The subpath's small cost buys one uniform
  convention.
- **A plain typed `const SERVER_PLUGIN_X` instead of a `serverPluginX()` function** — rejected for the
  mirror: the web exports `providePluginX()` as a function, and a matching call site (`serverPluginDnd()`)
  reads as its twin. The builder also defaults the optional arrays and freezes, as `providePlugin` and
  `defineType` do.

## Consequences

- **`bundled-plugins.ts` no longer imports plugin internals** — it names three `serverPluginX()` entry
  points and folds them; the five scattered imports (and the direct `/vault` reach) are gone.
- **`ServerPlugin` is the natural home for ADR-0052's per-Plugin identity and config.** That draft filters
  `BUNDLED_PLUGIN_TYPES` / `BUNDLED_STRUCTURED_DATA_TYPES` by an enabled-plugin set and gives the web
  `providePlugin({ id })`; a `PLUGIN_ID` and `configSchema` now have a single symmetric seam to land on
  (`serverPlugin({ id, configSchema, ... })`), instead of the composition root re-deriving per-plugin
  identity from loose exports.
- **A new `/server` subpath per plugin** joins the existing `/web`, `/testing`, `/i18n` seams — three
  `tsconfig.base.json` paths and three one-function `index.ts` files. No new dependency edges: the entry
  points import only their own lib's framework-free half and `@hexly/domain`. The content plugin's now-dead
  `/vault` subpath is removed in the same change, `/server` having subsumed it.
- **CONTEXT.md:** no vocabulary change — **Plugin** already names its "one entry point (`providePluginX`)";
  this simply gives it one on the API side too.
