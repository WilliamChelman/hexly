# Plugins are enabled/disabled per Instance; "disabled" is "never bundled" on both sides

ADR-0036 gave the Instance a `hexly.yml` and said, in as many words, "feature flags coming next." This is
next — and it turns out the flag we want is not a generic bag of booleans but one concept: **is this Plugin
on?** ADR-0048/0050/0051 already built everything a disabled Plugin needs. A **Plugin** this build does not
bundle leaves its Types unregistered, and an unregistered Type degrades to the generic Field **View** with its
values intact — on the web (`TypeRegistry.viewsFor`) and on the API (the bundled data-type set the derive and
vault passes resolve against). "Disable a Plugin" is therefore not a new behaviour to design; it is a runtime
choice over rails that already exist. This ADR makes "not compiled in" a config knob instead of a build fact.

## Decision

**Every Plugin gets a config namespace `features.plugin.<id>`; `enabled` is its first knob.** Not a flat
`features: { someFlag: true }` bag — ADR-0036 already rejected "flexibility no one asked for," and a general
flag registry with one consumer rots. The `features.plugin.<id>` nesting reserves room to "twist other knobs"
per Plugin later without a central schema edit (see the schema-ownership point below), while keeping today's
only knob a single well-typed field.

- **A Plugin becomes a first-class, identified unit.** Each Plugin's framework-free half exports a canonical
  `PLUGIN_ID` — `content`, `hexmap`, `dnd` — and both twins filter against it: the web `providePlugin({ id })`
  and the API's `BUNDLED_PLUGIN_TYPES` / `BUNDLED_STRUCTURED_DATA_TYPES`. The id is **decoupled from the type
  namespace**, because the `core` namespace is shared by two Plugins (content ships `core.note`, hexmap ships
  `core.hexmap`), so "namespace = plugin" is false and could never be the key.

- **On by default (opt-out).** A bundled Plugin is enabled unless `enabled: false`. An absent or empty
  `hexly.yml` is today's behaviour unchanged, every bundled Plugin live. Disabling is the deliberate act — in
  keeping with ADR-0036's generous defaults.

- **No privileged Plugin; content is disableable like any other.** This removes the one hard-dependency
  ADR-0051 left standing: `TypeRegistry.resolve()`'s `?? this.get(CORE_NOTE)!`, which assumed the content
  Plugin is always registered. With content disableable that assumption is a lie, so the fallback is
  de-load-beared — chrome (icon, labels, headline) resolves to a **synthetic generic default** when no enabled
  Plugin claims a Type. An Instance may disable every Plugin and still boot into generic-chrome-everywhere; it
  simply cannot create typed Entities. Accepted.

- **The "New" button's default create Type is a config knob, not `core.note` hardcoded.** ADR-0051's
  `NewEntityButton` hardcoded `core.note` as the primary split-button's create target — the same
  always-registered assumption `resolve()` made, and equally a lie once content is disableable. A new
  `entities.defaultType` in `hexly.yml` (an **Entity Type** id, defaulting to `core.note`) names the Type
  the primary create button mints, and its label follows that Type's create chrome ("New Note", "New
  Monster"). Resolution is **soft and client-side**: the configured Type if the enabled registry claims
  it, else the first enabled Type, else no primary create button — so a default naming a disabled
  Plugin's Type, a typo, or an all-Plugins-off Instance degrades rather than failing boot, keeping the
  knob decoupled from which Plugins are enabled. It ships on the same `GET /api/config` payload. **It
  deliberately does not feed `resolve()`**: that fallback stays synthetic-generic (above), because an
  unregistered Type must read as absent, not masquerade as the default Type. The knob answers "what does
  this Instance create by default," not "what does every unknown thing pretend to be."

- **"Disabled" means "never bundled" on both server and client — uniform absence.** The web registry skips a
  disabled Plugin's Types/Views/data-types; the API filters its bundled sets by the same flags, so the derive,
  search, and **Vault Projection** passes treat a disabled Plugin's **Structured Fields** as opaque document
  values. There is one mental model everywhere and no divergence at the API seam. A disabled Plugin's existing
  Entities' derived state (facets, link edges, searchable text) drops out and its grids export as raw values —
  recoverable by re-enabling and running **Reindex**, since derived state is a cache the **Entity Document**
  rebuilds.

- **The enabled set reaches the browser by a fetch at boot.** A new unauthenticated `GET /api/config` returns
  the enabled Plugin ids (and future client-relevant config); an `APP_INITIALIZER` fetches it before the app
  stabilises, and the registries filter their contributions against it through a **signal**. There is no
  client config channel today, and this establishes the general one. It works identically in dev
  (`nx serve web`) and prod (single-origin serve, ADR-0008) — unlike injecting into the served `index.html`,
  which prod could do but dev bypasses, forcing the fetch path anyway.

- **Boot-time only, for now.** Config is read once at boot (ADR-0036); toggling a Plugin is editing `hexly.yml`
  and restarting. No mutable-config store, no Superadmin toggle UI, no live push. The signal-based filtering is
  chosen so a future live path costs only pushing a new set into that signal (over the ADR-0044 nudge bus) — it
  does not foreclose live toggling, it just does not build it.

- **Per-plugin config schema is Plugin-contributed.** Each Plugin's framework-free half exports a `configSchema`
  extending a base `{ enabled: boolean }`; the API composes `features.plugin` by merging the bundled Plugins'
  schemas, mirroring how `BUNDLED_PLUGIN_TYPES` already composes from the bundled set. Adding a real per-Plugin
  knob later touches only that Plugin, never `config.ts`. Unknown Plugin ids and unknown sub-keys are
  **stripped, not rejected** — consistent with the rest of `hexly.yml` (ADR-0036, `config.ts`), one rule across
  the file. This is the one place we accept ADR-0036's own warned-against failure (a typo'd `plugin.hexmpa`
  silently no-ops) in exchange for a single consistent config discipline.

## Considered Options

- **A general feature-flag framework** (`features: { plugin.dnd: false, experimental.x: true }`) — rejected:
  there is no second, non-plugin consumer today, and a framework with one consumer rots. "Plugins are the
  framework": `features.plugin.<id>` is the whole surface, and it is a per-Plugin config namespace, not a loose
  boolean bag.
- **Toggle by Entity Type id** (`type.dnd.monster: false`) rather than by Plugin — rejected: it reuses an
  existing keyspace but a multi-Type Plugin needs several entries, and the Plugin's data-types and Views leak in
  unless separately gated. The Plugin is the compiled-in artifact with one entry point (`providePluginX`); it is
  the natural unit.
- **Content is required; disabling it fails boot** — the first cut, reversed. Keeping content privileged means a
  special case (`required` marker, a fail-boot rule) and a load-bearing `core.note`. Making it disableable like
  everything else removes the special case entirely, at the cost of de-load-bearing `resolve()`. The consistency
  won. This confronts ADR-0051's note that content was pluginized _"for the seam, not for the optionality"_ and
  was _"core in practice"_: it still is, in practice, but the optionality it built is now a supported operator
  choice rather than a theoretical property.
- **Client-only hide** (server keeps every bundled Plugin fully active) — rejected: the "disabled = absent"
  model would break at the API boundary, and the server would derive, validate, and project for a Type no one
  can create.
- **Inject the enabled set into the served `index.html`** — rejected as the sole mechanism: prod could, but dev
  bypasses the API, so the fetch path is needed regardless; two mechanisms for one job.
- **Fail boot on an unknown Plugin id / sub-key** (ADR-0036's fail-fast ethos) — rejected in favour of matching
  the file's existing strip-unknown-keys convention. A close call: fail-fast better honours operator intent, but
  a single consistent rule across `hexly.yml` won.
- **Route `entities.defaultType` through `resolve()`'s fallback too** (one knob, one rule: an unregistered Type
  resolves to the configured default's chrome) — rejected: it would dress a disabled `dnd.monster` in the default
  Type's icon and labels, hiding the disabled-Plugin state behind a masquerade. Synthetic generic chrome signals
  absence honestly; the knob governs creation, not chrome resolution.
- **Fail boot when `entities.defaultType` names a disabled/unknown Type** (ADR-0036 fail-fast) — rejected: it
  couples the default-type knob to plugin enablement, so disabling content would force a second edit or brick
  boot. Soft client-side fallback keeps the two knobs independent, matching the strip-don't-crash leniency chosen
  for `features.plugin` above.

## Consequences

- **`config.ts` becomes Plugin-aware.** `loadConfig` composes the `features.plugin` schema from the bundled
  Plugins' `configSchema`s; it needs the bundled id set to build the schema (not to reject typos, which strip).
- **The web bundle is unchanged.** Disabling is a runtime registration gate, not a build exclusion — a disabled
  Plugin's code still ships. Its heavy Views are already lazy `loadComponent`, so the eager cost saved is only
  Type/label/data-type registration. "Disable" is "don't activate," not "don't download."
- **`TypeRegistry.resolve()` loses its `core.note` fallback** and gains a synthetic generic default; together with
  `NewEntityButton`'s hardcoded create target (now `entities.defaultType`), these were the two `core.note`
  hard-dependencies ADR-0051 left in place, and both are removed here.
- **`config.ts` gains `entities.defaultType`** — a string defaulting to `core.note`, threaded onto `HexlyConfig`
  and returned by `GET /api/config`. `NewEntityButton` reads it in place of its hardcoded `CORE_NOTE`, resolving
  softly against the enabled registry (configured → first enabled → none).
- **A new client config channel exists** (`GET /api/config` + an `APP_INITIALIZER`), reusable for future
  instance-level, pre-login config beyond Plugin enablement.
- **CONTEXT.md:** **Plugin** is new — the bundled, id-identified unit an operator may disable in **Instance
  Configuration**.
