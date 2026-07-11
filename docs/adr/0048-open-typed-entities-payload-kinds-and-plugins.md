# Entity types are an open, plugin- and world-extensible set over a closed set of payload kinds

ADR-0018 made **Entity Type** a *closed, code-known enum* (`note | hexmap`) and explicitly deferred "user- and plugin-defined types" as a long-term goal. This ADR **reverses that deferral**: worldbuilding wants first-class *kinds* of thing — monsters, spells, deities, factions — each with their own fields, views, and filters, mostly delivered by bundled plugins. So the single `type` concept splits into two layers, and the user-facing layer opens up.

## Decision

Split the one conflated `type` into two layers:

- **Payload Kind** — the body shape + editing surface. Stays a **closed, code-known** set: `rich-content` (the base every Entity has: Content + Metadata — the former `note` payload, renamed) and `hex-grid` (an *addon*). Payloads are **additive**, not rival: `hex-grid` is a superset addon over the `rich-content` base, exactly as today's `hexmap` document is `note` + grid. The document is re-discriminated by payload composition, not by user-facing type.

- **Entity Type** — the user-facing identity, now an **open, `namespace.id`-keyed set** (`core.note`, `core.hexmap`, `dnd.monster`, `world.deity`). A type bundles: an *optional* payload addon, a **Field** schema, a view, and its facetable fields. An Entity carries `types` — an **ordered set**, `types[0]` **primary** (drives icon, default view, headline) — stored as an entity-level attribute alongside `tags`, denormalized for faceting. One **View** (a registered, togglable renderer) per surface the Entity's payloads afford, plus any View a type contributes — today's Note/Map toggle, generalized. See the *Views* amendment below.

Types come from two flavours of definition, both first-class:

- **Plugin type** — registered in code by a bundled plugin at startup (`defineType(...)`), instance-wide, ships a bespoke Angular view + interactions. **Core is dogfooded**: `core.note`/`core.hexmap` register through the *same* mechanism from their own internal libs, so only the payload kinds stay hard-coded and the plugin API cannot rot un-exercised.
- **User-defined type** — authored as **data** by a **World Owner**, **World-scoped**, fields-only, rendered by the **generic field view** (the same view unknown/degraded types fall back to). The *only* thing code ever buys is a bespoke view/interactions; fields, facets, link-fields, primary, and multi-type all work code-lessly.

**Fields are a typing lens over Metadata**, not a new store: a type gives meaning + data-type + facet-ability to specific Metadata keys; values stay in the one Metadata record, so Obsidian import/export (ADR-0033) is unchanged and a missing plugin leaves the values intact as plain Metadata. Field values may be scalars, enums, dates, lists — **or typed Entity-Link fields** (a schema-declared, target-type-constrainable relation), which become **World Graph** edges and facets and degrade like every other Entity Link (ADR-0023/0046).

Validation is a **forward-only enforcing gate**: it validates *active typed edits* (the type's form; adding a type prompts for required fields) but **tolerates data at rest** — import, already-stored documents, and Entities whose schema is now absent or has changed are never retroactively invalidated. This keeps clean data at the active-edit boundary without letting import tolerance or plugin schema evolution strand a World's Entities.

Per-type field facets surface **contextually** in the Entity Browser (ADR-0035): the rail shows the universal facets always, and a type's field facets unfold only when that type is the active filter.

## Considered Options

- **Keep the closed enum (ADR-0018's stance)** — rejected now: it forces first-class categories ("deity", "monster") down to inert Tags, which every comparable worldbuilding tool lets users define, and blocks plugin-delivered views entirely.
- **One flat `type` field mapped to payloads, single-valued** — the starting proposal; grown into a multi-valued ordered set once we saw payloads are additive (so `[monster, hexmap]` is coherent, not a clash) and worldbuilders want cross-cutting kinds.
- **Fields as a separate structured store beside Metadata** — rejected: duplicates storage and forks the Obsidian import path; the lens-over-Metadata model reuses both and degrades cleanly.
- **Enforce validation everywhere (strict)** — rejected: fights import tolerance and strands existing Entities whenever a plugin schema evolves. Forward-only keeps the benefit without the failure modes.
- **Plugin-only types (no user-defined)** — rejected once "deity" showed the gap between an inert Tag and a code plugin is exactly where the everyday worldbuilder lives, and the generic view we already need makes code-less types nearly free.
- **Runtime third-party plugins** — out of scope; "bundled" means compiled-in, like the existing `CONTENT_EXTENSIONS` and command-palette providers (ADR-0019/0032).

## Consequences

- **Reverses ADR-0018's closed-enum decision** and its "not built now"; supersedes the `type` column shape from ADR-0002/0018 (single `type` → multi-valued `types` attribute + payload-kind body discriminator) — a data migration (ADR-0027).
- The **Tag ↔ Type** boundary is redrawn: both are now multi-valued labels, so the line becomes *"is it a registered category (schema/view/facets — plugin or World-defined)?"* → Type; else free flavour → Tag.
- **Reindex** (ADR-0035) gains field-facet and field-link-edge recomputation; both remain pure derived state.
- The generic field view does double duty: the renderer for user-defined types *and* the graceful fallback for an Entity whose plugin type is absent — nothing is lost, consistent with dangling-link degradation.

## Amendment (2026-07): Views are first-class registered renderers

The original decision spoke of "one view per surface" without pinning down what a *view* is or how it is identified. Grilling the frontend cut — still branching on `isHexmap` / `type === 'hexmap'` in the entity page and header — forced the concept out.

- A **View** is a distinct togglable renderer + editor an Entity affords: the generalization of the Note/Map toggle. The canonical term is **View**, reusing web-map's existing `EntityView`; the overloaded word "surface" is demoted to informal prose and the duplicate `ViewSurface` string set is deleted, so it never collides with the many loose "…surface" usages (landing surface, repair surface, editing surface).
- Views are an **open, `namespace.id`-keyed set** in their own **`ViewRegistry`** (id → label + component), mirroring how the core dogfoods `TypeRegistry`. This yields **three distinct keyspaces**, and a View id carries a `core.view.*` sub-namespace so it is never mistaken for a Type id or a Payload Kind name:

  | Keyspace | Membership | Examples |
  |---|---|---|
  | **Payload Kind** | closed, code const | `rich-content`, `hex-grid` |
  | **Entity Type** | open, `TypeRegistry` | `core.note`, `core.hexmap`, `dnd.monster` |
  | **View** | open, `ViewRegistry` | `core.view.content`, `core.view.map`, `dnd.view.stat-block` |

- A View is contributed either by a **Payload Kind** (`rich-content` → `core.view.content`, `hex-grid` → `core.view.map`) or by a **Type** (a plugin's `dnd.view.stat-block`; the generic Field view `core.view.fields` that renders user-defined and absent-plugin types). A Type Definition declares the **ordered** `views` its Entities afford; the header toggles the **union** afforded by an Entity's `types`, defaulting to the primary type's first View, and shows no toggle when only one View is afforded.
- Rendering is **component-outlet over the `ViewRegistry`**, not type-sniffing: `entity.page` becomes a thin host that outlets `resolve(activeView).component`. `MapView` (shipped from **web-map**, gating its tools on `HexMapStore.editable`) and `ContentView` (app-level: block editor + docks) are self-contained registered components; the active-View state moves out of `HexMapStore` into a page-scoped `EntityViewStore` that reads the open Entity off the session. This completes the cut this ADR began, removing the residual `isHexmap` branches.
- The coupling is inverted the same way at the save seam: `EntitySession` no longer imports `@hexly/web-map`, depending instead on a narrow **`GridStore` port** (load / working-document / editable) that `HexMapStore` implements and the composition root binds — so the map lib plugs into the session, not the reverse. The former map/note bottom **status bar was dropped** (its content was static), so a hexmap no longer reserves a status row.

Sequenced as a frontend subtask **between the core `types[]` flip (#186) and the typed-Fields work (#187)**, because #187's generic Field view is itself a registered View and needs the registry + outlet to slot in without a branch.
