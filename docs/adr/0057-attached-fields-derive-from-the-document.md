# Attached Fields derive from the document; drop the `entities.fields` column

ADR-0054 gave an Entity a `fields[]` attribute — the ids of Fields attached directly, beside its
`types[]` — and its **effective Field set** is that list unioned with its types' live defaults, deduped
by id. ADR-0056 then made a Field's `id` **be** the Entity Document key it lenses. Once id = key, the
`fields[]` array became a second, redundant record of information the document already carries: a Field
is attached exactly where its (namespaced) key sits in the document. We drop the column and derive
attachment from the document.

## Decision

**Attachment is derived, not stored.** An Entity's **attached (extra) Fields** are the registered Field
ids present as keys in its **Entity Document** (a `null` value counts as present), **minus** any its
current types already default. Its **effective Field set** stays what ADR-0054 defined — those extras
unioned with the types' live defaults, deduped by id — only the _extras_ input changes from a stored
array to a document-derived set.

**The "minus the types' defaults" clause is load-bearing.** It is not an optimization; it preserves two
behaviours:

- **Order.** `resolveEffectiveFields` returns attached-first, then type-order. Without the subtraction a
  _filled_ type-default would re-classify as "attached" and jump the queue, silently reordering Fields
  and their Views. With it, a filled type-default keeps its type-order slot; only genuine extras sort as
  attachments.
- **Type removal keeps filled defaults for free.** Remove a type and its defaults leave every
  `fieldRefs` set, so a _filled_ one (`world.element: fire`) falls through to the extras bucket and
  survives as a first-class typed Field, while a _blank_ default (no key) simply disappears. The
  intended semantic is exactly this asymmetry — **filled defaults survive a type removal, blank ones
  vanish** — and it needs no bookkeeping beyond the derivation rule itself.

**Attach / clear / discard map to document mutations.** Attach an empty Field → write `id: null`.
Clear a value → set `null` (still attached). Discard a Field → delete the key. "Attached-but-empty" and
"value cleared" are deliberately the same state.

**The value gate treats `null` as absent.** So a blank optional attached Field does not fail type
validation. Required-Field enforcement is unchanged — a required Field still present as `null` reads as
absent and fails `required`, which is correct.

## Considered Options

- **Keep `fields[]` as a stored array (ADR-0054's model)** — rejected: post-ADR-0056 it duplicates the
  document, and the two can drift (an attached id with no key, a key with no id). One source of truth is
  the document.
- **Keep `fields[]` as a derived denormalization cache** (source of truth = document, like
  `entity_edges`/`entity_field_facets`) — rejected: no query unrolls it (`json_each` runs only over
  `types`/`tags`), so a cache buys nothing the read path needs; it would be pure upkeep.
- **Attachment = "key present," full stop (no minus-defaults)** — rejected: flattens field/View order and
  cannot distinguish a filled type-default from a deliberate extra.

## Consequences

- **Schema.** `entities.fields` column removed. `EntitySummary.fields` retires (it was already the
  "not-yet-migrated web tolerates" optional shape). The write API drops its separate `fields` input —
  attaching a Field _is_ writing its document key.
- **Resolution.** `resolveEffectiveFields` / `WorldTypeFields.effectiveFields` derive the extras from the
  document + Field registry instead of taking `fieldIds`; call sites in `entity-writes.ts`,
  `entities.service.ts`, and `vault-export.service.ts` follow.
- **Import gets simpler (ADR-0056 round-trip).** A namespaced registered key auto-attaches, so the vault
  importer no longer reconstructs an attachment list; a bare, un-namespaced foreign key still matches no
  Field and stays untyped.
- **Field-definition deletion leaves no dangling refs.** A deleted Plugin/World Field leaves its document
  values inert (no Field lenses them) and re-lenses if the definition returns — the same forward-only
  tolerance ADR-0054 already had, minus the orphaned `fields[]` entries.
- **Browse trade-off.** A list summary no longer carries attached-field ids. No current browse surface
  uses them; a future "field chips per row without opening the Entity" feature would need to parse
  documents or reintroduce a derived projection at that point — deliberately not pre-built.
- **Supersedes ADR-0054's** _"An Entity carries `fields[]` (attached Field ids) alongside `types[]`"_
  decision and its `fields[]` schema attribute; refines ADR-0056 (id = key is what makes the derivation
  sound). No data migration — pre-production (same posture as ADR-0054 / ADR-0056).
