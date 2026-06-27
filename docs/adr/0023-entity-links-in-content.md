# Entity Links in Content are a custom `entityLink` node; format bumps to `tiptap-v2` with dual-read

An Entity Link (CONTEXT.md) can now live **inline in prose Content**, not just on a Map element. We model it as a custom TipTap inline atom node, `entityLink`, with attrs `{ entityId, label, descriptor? }` — the id is the reference, `label` is a snapshot of the target's name at insert time, and `descriptor` is an optional free-text Link Descriptor characterising the relationship (e.g. "spouse"). Rendered via an Angular node view that resolves the target's **live** name from the owner's entity list and falls back to the stored `label` while the list loads or if the target is deleted (a dangling link); the descriptor, if set, renders as a muted parenthetical suffix — `[Jane Doe] (spouse)`. A plain click SPA-navigates to `/entities/:id`.

Adding a schema node changes the `tiptap-v1` extension contract (ADR-0019), so the `format` tag **bumps to `tiptap-v2`**. `contentSchema` accepts both `tiptap-v1` and `tiptap-v2`; reads load either losslessly (the node is additive, so a v1 doc simply has none and needs no transform); saves always write `tiptap-v2`. This is the first format bump and establishes the dual-read migration pattern.

## Insertion and characterisation — three inline triggers (`@tiptap/suggestion`)

- **`@`** — autocomplete over a client-side filter of `EntitiesClient.list()` (owner-scoped, no search endpoint); pick inserts the `entityLink` atom.
- **`/link`** — a slash-menu item that inserts `@` and lets the mention suggestion drive the same picker (one picker, not two).
- **`::`** — arms a descriptor autocomplete **only when the node immediately before the cursor is an `entityLink`** (elsewhere it is literal text); selecting/typing sets that link's `descriptor` attr. This is the single mechanism for both setting (cursor sits after the link right after insert) and editing (move after any link, type `::` again). Removing a link is plain atom deletion (backspace).

## Link Descriptor vocabulary — client-harvested, self-pruning index

`::` suggestions need the owner's prior descriptors, which only exist inside opaque content snapshots. To keep ADR-0019's "domain never parses the snapshot" boundary, the **client** harvests descriptors from its live editor doc and the **server** stores them in a per-entity index — it never parses content:

- Table `entity_descriptors (ownerId, entityId, descriptor)`.
- On a **successful** save, the server replaces that entity's rows with the client-supplied set (sent alongside the existing save payload, like tags ride the save).
- Suggestions = `SELECT DISTINCT descriptor WHERE ownerId = ?`.

This self-prunes: removing the last use of a descriptor and saving drops its rows so it is no longer suggested; deleting an entity prunes via cascade. The honest tradeoff: suggestions reflect **last-saved** state, not in-flight edits — correct semantics for a vocabulary that tracks persisted content.

## Considered Options

- **Reuse the StarterKit `link` mark** with an internal href. Zero schema change, but link text is frozen (stale on rename) and indistinguishable from external links. The reference model requires a live name, and the `link` mark has nowhere to carry `entityId`/`descriptor`.
- **`entityRef` as the name.** Rejected: "Reference" is in Entity Link's `_Avoid_` list, and this is the same id-by-reference-with-dangling concept as the Map-element Entity Link — one glossary term, two source surfaces. Code name aligned to `entityLink`.
- **Widen `tiptap-v1` in place** (no tag bump). Breaks ADR-0019's contract on rollback/staged-rollout. Rejected even at ~5 users.
- **Closed descriptor vocabulary** (like Entity Type). Rejected: can't enumerate every worldbuilding relationship; free text matches Tag's philosophy.
- **Server-side descriptor index that parses snapshots.** The obvious way to source cross-note suggestions, but it breaks ADR-0019's no-parse boundary. Rejected in favour of the client-harvested per-entity index above.
- **Append-only descriptor set.** Simpler, but never prunes — a removed descriptor lingers forever. Rejected for the per-entity index, which prunes correctly.

## Consequences

- The id→name resolver reads the owner's entity list; a link to an entity the user can't see (future cross-owner sharing) resolves to its stored `label` as a dangling link — consistent with "ids are not referentially enforced."
- Deleting an entity does not clean up links pointing at it; they render dangling. No backlink index or referential cascade (out of scope). A descriptor is a one-way annotation on its link instance — characterising A→B as "spouse" does not create B→A.
- The save payload and `entities` write path grow a `descriptors: string[]` field and the `entity_descriptors` index write; both ride the existing version-checked save transaction.
- Navigating a link discards unsaved edits in the current note — identical to the existing "back to library" link; a global unsaved-changes guard is separate, deferred work.
