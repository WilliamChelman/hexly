# A Field's id and its document key unify into one namespaced key

ADR-0054 made a **Field**'s `id` (a `namespace.id` reuse handle) and its **Entity Document** `key` (an
unnamespaced document slot) two deliberately distinct things, and its Considered Options rejected
unifying them — _"Make the id and the key the same string — rejected: it breaks frontmatter recognition
(an imported `element: fire` would no longer match `world.element`) and litters exported YAML with
namespaced keys."_ Both objections turn on one assumption: that a Hexly document key should look like a
foreign vault's bare frontmatter key, so the two can be recognized as the same slot on import.

We are adopting an **RDF-inspired** model instead — a Field is a _predicate_ named by a single stable,
namespaced identifier; a document is a set of `predicate → value` pairs — taking inspiration from the RDF
landscape without going full IRI (no IRIs, no `@context`/alias layer anywhere). Under that model the split
is the accident: a predicate has one identity, and the human-facing, renameable name is a separate
_label_, not a second identifier. The two ADR-0054 objections become accepted, deliberate trade-offs
rather than blockers, and pre-production status (ADR-0054, ADR-0050) makes the reshape free.

## Decision

**A Field has one identifier — a `namespace.id` `id` that _is_ the Entity Document key it lenses.**
`readField`/`writeField` read `doc[field.id]`. The separate `key` property retires from the Field schema;
the `FieldSchema`/`Field` split collapses toward a single id-bearing `Field`. The `fieldIdSchema` regex is
unchanged — every typed Field key is `namespace.id`-shaped, so it must carry a namespace.

**The document-key _string_ keeps the name `key` at non-Field sites.** `FieldFilter.key`,
`FieldFacetValue.key`, the `entity_field_facets.key` column, `VIEW_FIELD_KEY`/`fieldKey`, and a
**Structured Data Type**'s harvested facet dimensions (ADR-0055) all name a flat document-key string that
is not necessarily a Field id. A Field's contribution to that space is `field.id`. (Harvested dimension
keys should be namespaced too by plugin-authoring convention, but that is a guideline, not enforced here.)

**Core and plugin Fields are namespaced uniformly.** No privileged bare "default namespace": the grid
Field keys at `core.grid`, prose at `core.content`, D&D ability scores at `dnd.strength`. `name` and
`tags` are top-level Entity columns, not document keys, and are untouched.

**Foreign import stays bare and untyped.** A non-Hexly note's bare `element: fire` is stored as a plain,
untyped `element` document value, lensed by no Field — data-lossless, typing-lossy, exactly Hexly's
existing forward-only tolerance for an absent Field, and consistent with ADR-0033 already being lossy IO.
A namespaced Field lenses only Hexly-authored data. A **Hexly**-exported vault round-trips losslessly
because its keys are already namespaced.

**Export writes namespaced keys verbatim.** Frontmatter carries `dnd.strength: 18`, `core.creationDate:
…`; a multi-body-Field marker names the namespaced key (`<!-- hexly:field world.secrets -->`). No
namespace-stripping on export and no re-inference on import — that would be the `@context` layer we reject,
and it would collide when two namespaces share a leaf (`dnd.strength` vs `world.strength`).

**Cross-field key override retires.** Because a namespaced key is unique within its namespace, two
different Fields can never claim one document key, so ADR-0054's _"dedup by key, most-specific wins"_
precedence has nothing to arbitrate. Effective-set resolution dedups by `id` (the same Field reaching an
Entity via a direct attach and a type default). This is RDF-coherent: one overrides a _value_ at a
predicate, never a predicate with a different predicate. Not-wanting a type's default Field remains the
per-instance removal ADR-0054 already deferred.

**A User-defined Field's key is auto-slugged from its label and then frozen.** On create, a World Owner
supplies a `label`; the `world.<segment>` id/key is slugged from it, editable before first save and
**immutable after**. Uniqueness is now a single dimension — the `world_fields` PK `(world_id, field_id)`
plus a pre-save check that rejects a colliding slug (409, the owner adjusts). PATCH drops `key` from its
body; **renaming is label-only** (RDF's `rdfs:label` moves, the predicate does not). The old
"re-key degrades forward-only" path disappears — there is no separate key to re-point.

## Considered Options

- **Keep ADR-0054's id ≠ key split** — the status quo. Rejected here because the RDF-inspired model wants
  one predicate identity, and the split's two payoffs (foreign-key recognition, clean exported YAML) are
  worth less than a single source of truth once we accept lossy foreign import (ADR-0033 already is).
- **Unify, but add a per-vault `@context`/alias mapping bare ↔ namespaced** — rejected: it reintroduces
  the very id/key indirection at the IO boundary, and collides on shared leaf names.
- **Keep both `id` and `key` on the Field, enforce `key === id`** — rejected: a redundant field and a
  keep-in-sync invariant, the exact smell this ADR removes; minimal downstream churn is not worth it.
- **Exempt `core.*` Fields with bare keys as an implicit default namespace** — rejected: a special case
  in the resolver and an "empty namespace means core" rule that muddies the model for a smaller blast
  radius that pre-production status makes moot.

## Consequences

- **Reverses ADR-0054's rejected "same string" option and supersedes its id ≠ key decision (lines
  28-32) and its key-collision precedence (lines 53-56).** CONTEXT.md's **Field** entry is rewritten from
  "id and key are deliberately two things" to "one namespaced key"; **Vault Projection**, **Structured
  Data Type**, **Content**, and **Entity** entries lose their bare-key examples; `field-id.ts`'s docstring
  drops its split justification.
- **Domain schema.** `FieldSchema` loses `key`; `Field` keeps `id` as the sole identifier;
  `readField`/`writeField`/`resolveEffectiveFields` key off `field.id`; `resolveEffectiveFields` dedups by
  id. `world-field.ts`'s update request drops `key`.
- **Plugins.** `hex-grid.ts`, `rich-content.ts`, and any remaining scalar plugin Fields set their key to
  their id (`core.grid`, `core.content`, `dnd.*`). View placement already reads `HEX_GRID_FIELD.key` /
  `CONTENT_FIELD.key` constants, so it follows automatically.
- **World Fields service/controller.** Auto-slug on create, uniqueness pre-check, immutable key, PATCH
  without `key`.
- **No data migration (pre-production).** `seed.ts` and e2e fixtures move to namespaced keys; Reindex
  rebuilds `entity_field_facets` under the new keys; dev databases are reset. Same posture as ADR-0054 /
  ADR-0050.
- **Accepted trade — `world.*` keys are per-world, not global.** `world.element` in two Worlds is the same
  string but different predicates (scoped by `world_id` storage), so cross-world vault transfer or a future
  global vocabulary cannot treat them as globally stable. `core.*` and `dnd.*` (instance-wide) are stable.
  Consistent with the "inspiration, not full RDF / no IRIs" stance.
