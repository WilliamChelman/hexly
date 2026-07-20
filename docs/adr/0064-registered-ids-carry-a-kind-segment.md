# Registered ids carry a kind segment: `namespace.kind.name`

Every registered id had the two-segment shape `namespace.id` — `core.note` (an **Entity Type**),
`core.content` (a **Field**), `core.rich-content` (a **Structured Data Type**), `draw-steel.monsters`
(an **Importer**) — with only **Views** (`core.view.map`) carrying a third, disambiguating segment.
Nothing in an id said what it named: `world.battlemap` (a Field) and `world.deity` (a Type) were
shape-identical, only the registry they sat in told them apart, and the _glossary_ word "Content" had
drifted from the _id_ `core.rich-content` it named. Pre-production status makes the reshape free; it
will never be cheaper.

## Decision

**Every registered id is `namespace.kind.name` — three kebab-case segments, the middle drawn from the
closed vocabulary `type` / `field` / `datatype` / `view` / `importer`.** `core.type.note`,
`core.type.hex-map`, `core.field.content`, `core.datatype.rich-content`, `core.view.rich-content`,
`draw-steel.importer.monsters`, `world.type.deity`, `world.field.element`. Extending the vocabulary is
an ADR-level decision. An id now self-classifies on sight, the keyspaces are disjoint by construction
(the View sub-namespace's old rationale, generalized), and since a Field id _is_ its Entity Document
key (ADR-0056), document keys self-classify too: `*.field.*` is a lensed slot, `hexly.*` is reserved
provenance, anything else is a foreign key no Field lenses.

**Enforced at every registration boundary, open everywhere else.** The domain schemas
(`fieldIdSchema`, `entityTypeSchema`, `structuredDataTypeIdSchema`, the View-placement id,
`importerIdSchema`) require the kind segment, so a malformed plugin registration fails at startup; the
`world.` mints insert the segment server-side (`world.field.<slug>`, `world.type.<slug>`), so a user
never types it. Entity Document keys themselves stay unvalidated (forward-only, ADR-0054), and
`isStructuredKind` tightens from "contains a dot" to "second segment is `datatype`" — a Field or Type
id passed where a data-type kind is expected now reads unstructured instead of slipping through.

**Built-in Data Types stay bare — deliberately outside the pattern.** `string`, `number`, `date` carry
no segment: bare-vs-kinded _is_ the built-in/structured marker (ADR-0050's dot test, sharpened), so
namespacing them would erase the distinction the code keys on. Plugin ids (`content`, `dnd`) also stay
bare — they name the owner _of_ a namespace, not a thing inside one — and the reserved `hexly.*`
document keys are provenance, not registrations, so no kind token would be honest.

## Considered Options

- **Keep two segments, rename words to match ids** — rejected: it fixes the Content/rich-content drift
  but leaves every keyspace collision-prone and every id opaque without its registry.
- **`data-type` / `entity-type` as segment tokens** — rejected for `datatype` and bare `type`: the
  Entity is the domain's unmarked case, and single-word tokens keep ids scannable.
- **Namespace the built-ins too (`core.datatype.string`)** — rejected: it destroys the bare-vs-kinded
  structured marker and buys nothing, since built-ins are a closed, code-known set.
