# Payload Kinds collapse into Structured Fields, and the Hex Map ships as a plugin

ADR-0048 opened the **Entity Type** set and kept **Payload Kind** closed: `rich-content` and `hex-grid`,
"code-known", owned by `libs/domain`. It left the core's dogfooding half-done — `core.note` and
`core.hexmap` went through `defineType()`, but the web assembled their chrome and Views by hand, the
grid schema sat inside `entityBodySchema`, and `libs/domain` knew what a hex was.

Finishing the job on the web half (a `providePluginHexmap()`, as #192 did for D&D) forced the question
the ADR had deferred: **what is a Payload Kind, that a Field is not?** Both are a thing a Type declares.
Both are a schema fragment a plugin contributes, a value the API validates, and a source of link edges.
They differ only in _where the value is stored_ — the body root versus the Metadata map — and that
difference buys nothing.

So they collapse.

## Decision

**The Entity body is `{ content, metadata }`. One shape, for every Entity, forever.** `rich-content` was
never an addon; it is the base, and no Type declares it. With the base out of the way, `hex-grid` was
the only Payload Kind left — so **Payload Kind is deleted** as a concept: from the code, from
`PAYLOAD_KINDS`, from CONTEXT.md, and from ADR-0048's three-keyspace table, which loses a row.

Everything a Type adds is a **Field**.

- **A Field's data-type may be contributed by a plugin** — a **Structured Field** (CONTEXT.md): a value
  with its own schema, its own edge harvester, and its own **View**, rather than a form control. The
  built-in data-types (`string`, `number`, `boolean`, `date`, `enum`, `list`, `entityLink`) keep their
  exact-literal validation; a structured data-type's `kind` is a **`namespace.id`-shaped id**
  (`core.hex-grid`). A data-type is structured _iff_ its kind is namespaced — no boolean flag declares it.

- **Shape is validated in the domain; membership is resolved in the host.** This is the trick
  `entityTypeSchema` already uses: `defineType()` runs at module load, so a schema that enumerated the
  known structured kinds could not validate the very plugin registering one. So the domain validates
  that a kind is _well-formed_ (`strig` is rejected: no dot), and an unknown-but-well-formed kind
  (`core.hex-gird`) fails at **resolution**, against the registry the host composes.

- **The registry is threaded explicitly, never global.** A structured data-type's framework-free half is
  `{ id, valueSchema, empty(), harvestEdges? }`; `validateFields(fields, metadata, dataTypes)` and
  `harvestEdges(body, fields, dataTypes)` take the resolved set as a parameter, exactly as
  `harvestEdges` already takes `fields`. The API composes it in `bundled-plugins.ts` (which already
  composes `[...CORE_TYPES, ...BUNDLED_PLUGIN_TYPES]`); the web composes it in `providePlugin()`. The
  domain holds no mutable state, so import order cannot change behaviour and a test passes its own set.

- **A structured value lives in Metadata like any other Field value**, at the key the Field declares —
  the grid at `grid`, exactly as `dnd.monster` types `armor_class`. Field keys are unnamespaced by
  design (a Field "types and surfaces a key it never owns"), which is what lets a type recognize the
  frontmatter an imported note already carries.

**Views become instances, bound to a Field.** A structured data-type contributes a View, but a View must
render a _specific_ Field: an Entity carrying `[core.hexmap, world.deity]` where the deity declares a
`battlemap` Field has **two** grids and affords **two** map Views. So:

- The afforded-View list is `{ viewId, fieldKey? }[]`, not `ViewId[]`. A data-type View's toggle is
  labelled from the **Field's** label ("Grid", "Battlemap"); the URL carries `?view=core.view.map:battlemap`;
  `EntityPage`'s outlet passes `fieldKey` down to the View's component, and `HexMapStore` — provided by
  `MapView` — reads and mutates that key's slice of `EntitySession.body`. A Type-contributed View
  (stat-block, content, generic fields) carries no `fieldKey` and is unchanged.

  **Amended in #200:** the outlet passes the key through a **DI token** (`VIEW_FIELD_KEY`) in a
  per-View-instance `Injector`, not as the component `@Input` this ADR first sketched. An input cannot
  work: a Structured Field's View provides its store in `providers`, which Angular constructs _before_
  it sets any input, so the store would be built before it knew which Field it edits. Passing the key
  through the injector also buys the teardown the two-grid case needs — `NgComponentOutlet` rebuilds a
  component when its injector changes, so switching from the world map to the battlemap yields a fresh
  store and a fresh undo stack, where an input would have re-pointed a live store (and its undo stack)
  at another Field mid-edit.

- **A Field may carry a `labelKey`** (#200). Once a Structured Field's `label` names a **View** in the
  header, it is chrome — and a plugin ships translated copy where a World Owner ships one authored
  name (ADR-0014). So `FieldSchema` gains an optional transloco key, exactly as a Type already splits
  its `labels` (keys, code-registered) from a user-defined type's `labelText` (authored, never
  translated). `core.hexmap`'s grid Field declares one, so its toggle still reads "Map" / "Carte"; a
  `world.deity`'s battlemap Field has none, and reads "Battlemap" verbatim.
- A `TypeDefinition.views` entry becomes **`ViewId | { field: key }`**, so a Type _places_ a Field's View
  in its own order: `core.hexmap` declares `[{ field: 'grid' }, CORE_VIEW_CONTENT]` and so still opens on
  the map. Ordering structured-field Views implicitly (always first, or always last) is wrong in both
  directions — it would open a deity on its battlemap.
- **A user-defined type gets the same list**, restricted to what it can resolve (`core.view.fields`,
  `core.view.content`, and its own structured Fields). Absent, it defaults to
  `[fields, content, ...its structured Fields]`. Each structured Field carries a **Show as a view** toggle
  in the World Types editor (default on), so a deity may offer its battlemap, or not. Plugin types and
  user-defined types run one view-resolution path.

  **Amended in #201**, on two points the ADR left open:

  - The list is **persisted** (a `views` JSON column on `world_types`, and a `ViewPlacement[]` on the
    user-defined-type payloads), because a user-defined type is data — so its view order round-trips
    through the API like its Fields. The domain owns the placement _shape_ and validates it (every
    `{ field }` names one of the type's own Fields); it never resolves a View, which stays the web's.
    The editor recomposes the whole list from the live Fields and toggles on every save, so the two
    always travel together and a placement can never outlive the Field it names. `null` is not `[]`:
    it means "the author named no order", and the web defaults it.
  - A plugin's structured data-type carries a **`dataTypeLabelKey`** on its View definition — the copy
    that names the _kind_ where a World Owner picks it ("Hex grid"), distinct from the toggle label,
    which a structured View takes from the Field that placed it ("Battlemap"). One names the kind you
    pick, the other the grid you painted. It hangs off the View, not the framework-free data-type,
    because the API has no copy — the same split the View itself is — and it makes "offerable in the
    editor" fall out of "renderable": a kind with no View is a Field a World Owner could never edit,
    so the picker offers exactly the kinds this build can draw.

**The Hex Map ships as `libs/plugin-hexmap`** — the rename of `web-map`, and the first plugin with a
server half:

- `@hexly/plugin-hexmap` — framework-free. The whole of `libs/domain/src/lib/hex/` (coordinates, layout,
  culling, marquee, move-planner, hex-map — _nothing outside the map lib ever imported it_), plus
  `hexMapSchema`, the `core.hex-grid` structured data-type, and the `core.hexmap` `defineType()`. The API
  imports it and gets grid validation and grid edge-harvesting with no map-specific code.
- `@hexly/plugin-hexmap/web` — one symbol, `providePluginHexmap()`: the type's chrome, the `core.hex-grid`
  View declared with `loadComponent` (the canvas stays in its own chunk), and the `map` translation scope.
- `@hexly/plugin-hexmap/testing` — the session fake and the catalogs, as before.

**The acceptance test is that `libs/domain` contains zero occurrences of "hex".** So is that the app names
no type: the "New Map" buttons on the World Dashboard and Entity Browser become **one split button** —
primary action New Note, arrowhead listing every registered creatable Type — and `vault-export` stamps
`hexly.type` from `entity.types` generically instead of special-casing `core.hexmap`.

**The ids keep the `core.` namespace** (`core.hexmap`, `core.view.map`, `core.hex-grid`). A namespace names
who owns the vocabulary, not which lib the code compiles from; `core.` still means "ships in the box".

## Considered Options

- **Keep Payload Kind, ride it on the Type Definition** (`defineType({ payload: { kind, schema, empty,
harvestEdges } })`) — the natural reading of ADR-0048, and rejected once it was clear that this
  `payload` and the adjacent `fields` were the same object with two names. It also forces
  `entityBodySchema` to be **dynamically composed per host**, dragging the update-request DTO and the
  read-path parse into registry plumbing. The merge leaves the body schema a constant.
- **A separate `PayloadRegistry`**, on the theory that Payload Kind and Entity Type are different
  keyspaces (ADR-0048 is emphatic that they are) — rejected: nothing would ever look a payload up except
  through a Type, so it is a lookup table with no callers.
- **A module-global `registerDataType()` in the domain** — rejected: the domain would grow mutable state,
  tests would need registration and reset, and a change in import order would silently change behaviour.
  Every registry in Hexly is DI-scoped and seeded from an explicit composition root.
- **At most one structured Field per data-type per Entity**, so a View id stays the whole identity and the
  outlet needs no field key — rejected: an arbitrary rule whose only purpose is to protect the plumbing,
  and it bites exactly on the case the merge exists to unlock (the deity with a map).
- **"Add `core.hexmap` as a second type" as the affordance for a user-defined type wanting a map** —
  rejected: it drags in a whole type's chrome and default view for one Field, and it collapses the day a
  plugin ships a type with two structured Fields.
- **Keeping the grid out of the vault export** (a reserved `hexly.grid` key) — rejected. Structured values
  export like any other Field value; nested YAML frontmatter is a fine home for one. A large map makes a
  large frontmatter block, and the escape hatch, when it is wanted, is a per-data-type export strategy
  (inline / sidecar / omit) — a later decision that needs no design space reserved now.
- **Renaming the ids to `hexmap.*`** to signal plugin-hood — rejected: it would say that going through the
  plugin seam makes you a third party, which is the opposite of what dogfooding means.

## Consequences

- **Reverses ADR-0048's closed Payload Kind set** and the `PayloadKind` type, `PAYLOAD_KINDS`, `hasHexGrid`,
  `gridOf`, `withPayloadsFor`, and the `hexMapSchema.shape` branch of `entityBodySchema`. The
  three-keyspace table becomes two (Entity Type, View) plus the Field data-type set.
- **Amends ADR-0033**: the Hex Map's grid now round-trips through an Obsidian vault. The lossiness that ADR
  accepted — export dropped the grid and stamped `hexly.type` "so the loss is visible" — closes as a
  _side-effect_ of the merge, and closes **generically**, for any plugin's structured value. The generic
  `hexly.type` stamp also fixes a live bug: a `dnd.monster`'s type does not survive an export/import
  round-trip today.
- **A malformed grid is now tolerated at rest, not a corrupt-document 500.** Field validation is
  forward-only (ADR-0048), and the merge applies that rule uniformly: garbage at `grid` opens as an empty
  plane, and the first edit overwrites it. This is _safer_ than what it replaces — the Metadata map
  preserves unknown keys by construction, so the "malformed grid silently falls through to a note and the
  next save eats it" failure that the `.strict()` body union was built to prevent **cannot occur** in the
  new store.
- **The absent-plugin path becomes real, and testable.** A build that drops `providePluginHexmap()` opens
  existing Hex Maps as rich content plus an unrenderable structured Field — precisely the degradation
  ADR-0048 designed for and never had a way to exercise.
- **No data migration.** Existing Hex Map documents carry the grid at the body root and will not parse
  against the new body. Hexly is pre-production; the staging Hex Maps are wiped rather than migrated.
- The `Field` vocabulary widens from "a typed slot for a small user-edited value" to include a structured
  document with a bespoke editor. CONTEXT.md gains **Structured Field** and loses **Payload Kind**.
- The generic Entity-Link picker, which lived in the map lib for historical reasons and hard-coded
  `CORE_HEXMAP` for its untitled-label fallback, moves to `libs/web-entity`, where every plugin can reach it.
