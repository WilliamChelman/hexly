# Caller Rights shipped with the resource, computed on read

The ACL predicates (ADR-0037) are the single source of truth for what a caller may do. This ADR decides how that truth reaches the client: every fetched Entity and World carries a **`rights`** array — the closed set of verbs the caller may exercise on _that_ resource — computed on read from the same predicates, so the webapp gates its UI on exactly what the server enforces. It **replaces** the ad-hoc `canWrite`/`canManage` booleans, which were lossy, and it deliberately **does not** introduce a materialized rights table.

## The problem with the booleans

`EntityDetail` shipped two booleans, and aliased them wrong: wire `canWrite` was the server's `canEditSubstance` predicate, and the server's _third_ write-side predicate (`canWriteEntity` — delete and visibility change, which an entity-level Editor grant does **not** confer) was never shipped at all. So the visibility toggle and the browser's per-card delete gated on `canEditSubstance`: an entity Editor saw controls that the server then 403'd. Collapsing three distinct predicates into two booleans is the root cause; a verb-per-predicate array removes the conflation by construction.

## The decision

- **Per-resource verb enums** (code-known, closed — like `EntityType`), in `libs/domain`:
  - `EntityVerb`: `read` (`canReadEntity`), `edit` (`canEditSubstanceEntity`), `delete` (`canWriteEntity`), `set-visibility` (`canWriteEntity`), `manage` (`ownsEntity`).
  - `WorldVerb`: `read` (`reachableWorld`), `manage` (`isOwner`).
  - The verb→predicate map is many-to-one (`delete` and `set-visibility` share `canWriteEntity`) — two UI affordances, one rule today; if the rules diverge, only the map changes. Adding a finer verb later (`rename`, `move`, …) is one more string, no contract break — that forward leeway is the whole point of the array shape.
- **Computed on read from the existing predicates, not stored.** Entities: `access()` already selects the four predicate columns in one query; a pure `entityRightsOf()` serializes them to the array — this function _is_ the one documented place the verb↔predicate correspondence lives. Worlds: plain JS from `reachableWorld`/`isOwner`. Superadmin needs no special case — the predicates already short-circuit to match-all, yielding the full verb set.
- **`rights` replaces `canWrite`/`canManage`.** Present and non-empty on `EntityDetail`, `WorldDetail`, `WorldSummary` (kills `world-index`'s `owners.includes(me)`). Anonymous public-link reads ship `rights: ['read']` — the field is always present, so the client never branches on its absence.
- **`EntitySummary.rights` is opt-in** via a list query flag: the Entity Browser requests it (to gate per-card delete/rename); suggestion menus, the Command Palette, and the export path leave it off so `list()` stays a pure read-filter (one `EXISTS`, not four per row). `WorldSummary.rights` is always present — `manage` falls out of the owner set the world list already fetches, for free.

## Considered Options

- **A materialized rights table now** — rejected. A stored `(user, resource, verb)` table is a _cache_, not a source of truth; it adds a second representation that a fan-out invalidation job must keep in sync (a World Viewer added to a World with 500 `shared` Entities = 500 rows to recompute), and a stale row there is a silent security bug. At the current scale the read predicates are indexed `EXISTS` on tiny tables — there is no cost to cache. The `rights` array is the exact seam a table would later slot behind: `access()` becomes a lookup, the wire contract is unchanged. Deferring keeps one representation; building keeps two. Revisit when Hexly runs as a multi-tenant service (see below).
- **A single shared `Verb` enum across resources** — rejected: `read` means different things and a World has no substance to `edit`; a shared enum invites meaningless `(world, edit)` combos. Per-resource enums stay honest.
- **Keep `canWrite`/`canManage` alongside `rights`** — rejected: two representations of one truth is the redundancy this whole change removes.

## Consequences

- The verb-faithful array fixes a live show-then-403: the visibility toggle and browser delete now gate on `rights.includes('set-visibility')` / `rights.includes('delete')`, matching the server's `canWriteEntity`.
- `EntitiesService.list`/`facets` args rename `ownerId` → `readerId` (they filter by `canReadEntity`, not ownership); `listDescriptors`/`listTags` keep `ownerId` (genuinely `ownsEntity`-scoped).
- The per-row `EXISTS` cost of `EntitySummary.rights` on an opted-in list is the honest tripwire for materialization: when a listing measurably hurts at service scale, that is the signal to build the deferred table behind the unchanged array.
