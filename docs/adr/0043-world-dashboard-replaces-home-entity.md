# A World's landing is a derived Dashboard, not a Home Entity

A World's front door (`/w/:worldId`) is the **World Dashboard** — a read-only *derived* view (recent Entities, Hex Maps, at-a-glance counts) plus an Owner-curated set of **Pinned Entities**. The **Home Entity** — an auto-created `is_home` note that served as an editable landing page — is removed entirely, and with it the stored landing body.

The Home Entity existed for one reason: to reuse the Entity editor/save/version/asset pipeline for World-landing prose without building anything new. That shortcut leaked at every seam — the note showed up in the Entity Browser like any other, its title/visibility/lifecycle had to be locked and kept in sync (ADR-0029), and yet *nothing actually routed to it* (the World root rendered World Settings; cards opened the Entity Browser). Modelling the landing as a derived Dashboard removes the stored body, and the three symptoms get **deleted rather than fixed**: no browser entry (nothing to list), no locks/sync (nothing to edit), and a real destination on arrival. Authored landing prose, when someone wants it, is just a normal Note the Owner pins — an Entity that lives in the library, edits, moves, and deletes like any other.

## Considered Options

- **Give `worlds` its own `content` column** — rejected: forces the entire editor/save/version/asset pipeline to operate on a non-Entity, rebuilding for the World what the Entity gave for free, to serve prose we deliberately scoped down to "little or none."
- **Keep the Home Entity but hide it from the Browser and fix the title/visibility sync** — rejected: preserves a special-case Entity and every lock on it; treats symptoms while the root cause (landing prose modelled as an Entity) stays.
- **Per-user pins, or a `world_pins` join table** — deferred: the pin set is tiny, always loaded whole with the World, and never queried cross-World, so an ordered JSON `pinned_entity_ids` array on `worlds` covers the shared front-door case. Per-user pins are a personal-bookmarks feature, out of scope; a join table is a 20-line migration away if pins ever grow cross-cutting.

## Consequences

- Schema: `worlds` gains `pinned_entity_ids` (ordered JSON array). `entities` loses `is_home`; the `idx_world_home` partial unique index is dropped. Not yet in production, so the migration simply drops the column and index — existing home notes survive as ordinary Notes as a side effect, with no demotion or content-preservation logic.
- Routing: `/w/:worldId` → World Dashboard; World Settings moves to `/w/:worldId/settings`; the World card and the create-World flow both land on the Dashboard.
- Pins are Entity **references, not enforced FKs**: resolved per viewer through the same access filter as any Entity fetch, so a pin the caller can't reach — `private` without a grant, or since deleted — simply drops off their Dashboard. Consistent with Entity Link semantics (ids are not referentially enforced; inaccessible targets render non-navigable). Stale ids are filtered on read, not pruned on delete.
- Pinning is Owner-only (curating the shared front door is a World-presentation power). A pin is added from the Entity header or a picker on the Dashboard, and removed/reordered on the Dashboard.
- Supersedes ADR-0029 (Home Entity title sync) in full, and the Home Entity clauses of ADR-0024 and ADR-0037 (the "always `shared` so a World always has a landing page" guarantee — a shared World now always has a Dashboard). `mintWorldWithHome` no longer mints a home; `WorldDetail.homeEntityId` and the "World has no Home Entity" corruption guard are removed.
- Build touch-point (not a doc concern, flagged so it isn't missed): the FTS reindex trigger's guard list (ADR-0035) references `is_home`; dropping the column means updating that trigger in the same migration.
