# Fields become first-class, reusable definitions; Types reference them, Entities attach them

ADR-0048 made **Fields** something a Type _owns_: a `FieldSchema` inlined in a Type Definition's
`fields[]`, reachable only through a type. ADR-0050 folded Payload Kinds into the same place —
everything a Type adds is a Field, declared inline. That model makes a field's meaning captive to a
type: to give one deity an "element" affinity (fire/ice) you must either add `element` to the
_deity type_ (so **every** deity carries it) or pull in the monster type wholesale just to borrow its
field. Neither is what a worldbuilder means by "this one deity has an element, that one doesn't."

So Fields stop being a thing a Type contains, and become a first-class thing a Type — and an
individual Entity — _references_. A Type becomes a **semantic bag of default Fields**, not their owner.

## Decision

**Two reusable layers.** Fields become first-class, but the _kind_ layer keeps its established name —
**Data Type**, not a "Field Type" rename (`FieldDataType`/`StructuredDataType` already say it). Only the
mis-named noun "Structured Field" retires, in favour of **Structured Data Type** — the structured-ness was
always the kind's:

- A **Data Type** is the _kind_ — value shape, editor, validation, edge-harvesting, vault projection.
  An open set: the **built-ins** (`string`, `number`, `boolean`, `date`, `enum`, `list`, `entityLink`)
  and the **structured** ones a plugin contributes (`core.hex-grid`, `core.rich-content`), marked by a
  `namespace.id` id. This is ADR-0048/0050's `FieldDataType` + `StructuredDataType`, already unified — kept,
  not renamed. A Data Type is the _type of a Field_, as an Entity Type is the type of an Entity.
- A **Field** is a named, typed, reusable slot: `{ id, key, label, labelKey?, dataType, required,
facetable, vault? }` — ADR-0048's `FieldSchema`, promoted to first-class.

**A Field's `id` and its document `key` are two things (id ≠ key).** The **id** is a `namespace.id`
reuse handle and single source of truth (rename the label once, every follower updates). The **key** is
the unnamespaced Entity Document key it lenses — kept unnamespaced precisely so it still recognizes the
frontmatter an imported note already carries (ADR-0033/0050). It is the same id/key split a Type already
lives with: `dnd.monster` types a bare `armor_class`.

**A Field's parameters live on the Field, not the Data Type.** An `enum`'s options, a `list`'s item
type, a link's target types stay on the Field, so the Data Type is a bare kind. A shared _option
vocabulary_ across several Fields (a named `enum` Data Type) is a coherent future addition — additive,
because a Field always resolves to some Data Type — and is **not** built now.

**Every Field is a registered definition; nothing is inline.** A Type Definition lists **default Field
ids** (`fieldRefs`), not inline `FieldSchema`s; an Entity carries **attached Field ids**. One field
concept, one resolution path (id → Field), one editor surface. The registry is an _available set_ — reuse
is opt-in, so a registered `dnd.armor_class` forces itself on no one. Two flavours mirror the Type
duality: a **Plugin field** (code, `defineField`, instance-wide) and a **User-defined field** (data,
World-scoped, reserved `world.` namespace, authored in a **World Fields** editor beside the World Types
editor — a new `world_fields` collection beside `world_types`).

**An Entity carries `fields[]` (attached Field ids) alongside `types[]`.** Its **effective Field set** is
its types' default Fields (resolved **live**, primary type first) unioned with its attached Fields. Live,
not snapshotted: editing a type propagates to its existing Entities. The stated use case is served purely
by the _additive_ instance layer — attach `world.element` to one deity, leave the deity type untouched —
so per-instance **removal** of a type default is deferred (an unwanted optional field is just left blank).

**Resolution: dedup by document `key`, most-specific wins.** One value per key ⇒ one Field per key in
the effective set. Precedence: the Entity's own attachment > the primary type > later types. The loser
drops from the effective set; its value stays untouched in the document (the lens simply doesn't apply —
forward-only tolerance, no data loss). This generalizes ADR-0048's `resolveFields` primary-wins rule.

**Faceting keys off the Field, not the type.** ADR-0035/0048's "a type's field facets unfold only when
that type is the active filter" is replaced: a facetable Field surfaces as a facet when the current
browse carries values for it, whatever types those Entities hold. Reindex's `FieldFacetValue` is already
keyed by document key, so only the rail's surfacing rule changes. A structured Data Type is still never
facetable.

**Views resolve over the effective Field set.** ADR-0050's afforded-view list (`{ viewId, fieldKey? }[]`,
`VIEW_FIELD_KEY` injector, multiple grids per Entity) is unchanged except that it resolves over
_effective_ Fields, not the type's. A structured Field attached directly to an Entity (a deity's
`battleMap`) **auto-affords** its View, appended after the type-placed Views in `fields[]` order — the
same fallback ADR-0050 (#201) already defines for a user-defined type that named no order. Per-entity
View _reordering_ is deferred.

## Considered Options

- **Snapshot a type's default Fields onto the Entity at attach time** — rejected: editing a type would
  not reach existing Entities, and Entity Type would degenerate into a tag-plus-template, undercutting the
  "semantic bag" that still carries facets, Views, and a live default schema.
- **Hybrid: keep inline type-private Fields alongside registered shared ones** — rejected: two field
  concepts and two resolution paths, and "first-class" becomes a half-truth. Under the uniform model the
  registry is merely an available set, so registration costs a plugin nothing it loses.
- **Make the id and the key the same string** — rejected: it breaks frontmatter recognition (an imported
  `element: fire` would no longer match `world.element`) and litters exported YAML with namespaced keys.
- **A named parameterized Data Type carrying the enum options** (so `element`, `resistance`, `weakness`
  share one option vocabulary) — not rejected, **deferred**: additive later, unneeded for the use case now.
- **Forbid key collisions outright** (reject attaching a Field whose key a type already types) — rejected
  in favour of a deterministic precedence, which also yields per-instance override for free.
- **Keep type-gated faceting** — rejected: "unfold under the active type" has no meaning once a Field
  rides on an Entity whose type never named it.

## Consequences

- **Reverses the field-ownership model of ADR-0048/0050.** `FieldSchema` gains an `id` and becomes the
  **Field**; `FieldDataType`/`StructuredDataType` keep their names — the kind layer stays the **Data Type**,
  no "Field Type" rename; a Type Definition's `fields` becomes `fieldRefs` (ids); `defineType` no longer
  inlines schemas. New `defineField`, a `world_fields` collection, and an Entity `fields[]` attribute
  beside `types[]`.
- **`resolveFields` generalizes** from "the union over a Type's fields" to "the effective set over an
  Entity's types _and_ its attached fields," deduped by key with the precedence above. Validation,
  edge-harvesting, search-text, and vault projection all run over the effective set unchanged in spirit.
- **The Entity Browser rail's facet surfacing** moves from type-gated to per-Field-by-presence.
- **The "Structured Field" noun retires** from CONTEXT.md; its behaviours move onto **Structured Data
  Type**. The structured-ness was always the type's, not the field's.
- **No data migration.** Hexly is pre-production and no inline user-defined types reached a live database,
  so the reshape is code + schema only (same posture as ADR-0050).
