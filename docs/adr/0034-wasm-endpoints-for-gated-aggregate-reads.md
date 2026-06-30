---
status: accepted (forward decision — amends ADR-0032; lands when descriptor-vocabulary scale demands it. Current code ships the client-dedup interim; implementation is its own slice)
---

# WASM custom endpoints own reads a Record API can't express — the descriptor vocabulary first

The `::` Link Descriptor vocabulary (ADR-0023, #132) is a trigger-maintained index — `entity_descriptors`, one row per `(entity, descriptor)`, carrying `world_id` — read for type-ahead suggestions. That read has three requirements at once: **DISTINCT** by descriptor, **visibility-gated per reader** (a `private` Entity's labels must never leak to its World members — ADR-0024), and **prefix-filtered** (`LIKE`) for type-ahead. #132 shipped it as a Record API over the index with the same per-row visibility cascade as `entities`, deduped client-side. That is correct, but **the vocabulary will get big** — many Entities reuse the same handful of labels — so the index returns many duplicate rows per descriptor, the read payload grows with *reuse* rather than with vocabulary *size*, and the list page cap can truncate the long tail (a popular label crowds out rarer ones).

## Why a Record API structurally can't do it

A Record API authorizes with **one per-row predicate** (`_ROW_`/`_USER_`/`_REQ_`) evaluated as the **last** filter on the rows the table/view emits — and the reader's identity (`_USER_`) enters **only** there. Our gate needs `_ROW_.entity_id` to join back to `entities` and check visibility. `DISTINCT` by descriptor **destroys that grain before the gate runs**, and the gate can't be precomputed into a view because visibility is **reader-dependent**: the same label is private-to-owner on one Entity and shared-to-members on another. A "keep a representative `entity_id`" view authorizes incorrectly either way (denies a label that's also on a shared Entity, or leaks one that's only on a private Entity). So **gate-then-DISTINCT cannot fit one Record API.** This is precisely the "a declarative rule genuinely can't express it" case ADR-0032 named.

## Decisions

- **The descriptor-vocabulary *read* moves to a WASM custom endpoint** that runs the gate-then-DISTINCT query with the authenticated user id — gating at full `(entity, descriptor)` grain, *then* collapsing:
  ```sql
  SELECT DISTINCT ed.descriptor
  FROM entity_descriptors ed JOIN entities e ON e.id = ed.entity_id
  WHERE ed.world_id = :world AND ed.descriptor LIKE :q AND (
    e.owner_id = :user
    OR (e.visibility = 'shared' AND EXISTS(SELECT 1 FROM world_members m WHERE m.world_id = e.world_id AND m.user_id = :user))
    OR EXISTS(SELECT 1 FROM entity_grants g WHERE g.entity_id = e.id AND g.user_id = :user))
  ORDER BY ed.descriptor LIMIT :n;
  ```
- **Write path unchanged.** The trigger-maintained `entity_descriptors` index, the `descriptors` save column, and the AFTER UPDATE trigger stay exactly as #132 built them. Only the read swaps — no migration risk to stored data.
- **`EntitiesClient.listDescriptors(worldId, query)` repoints** from the Record-API list to the endpoint; its signature and the type-ahead UX are unchanged, so the editor wiring (`descriptorSuggestion` / `content-editor`) is untouched. The `entity_descriptors` Record API read is retired once the endpoint lands, so the visibility gate has **one** source of truth (the endpoint SQL), not two.

## Amends ADR-0032

ADR-0032's "**WASM is held in reserve** — no custom server code for v1 unless a trigger genuinely can't express something" was right in principle but **overstated in tone**. The correct framing:

- **Writes** stay declarative — TrailBase has no write middleware, and the jsonschema `CHECK` + version access-rule + triggers cover the write path. No custom write code for v1. That half holds.
- **Reads** the declarative Record-API layer can't express — a **user-context-gated aggregate** (`DISTINCT`/`GROUP BY` behind a reader-dependent visibility gate) — belong in a **WASM endpoint as a first-class tool**, not a near-never last resort. The descriptor vocabulary is the first such read; expect more as aggregate read surfaces grow (counts, facets). This is the "few WASM routes" 0032 itself anticipated — it just undersold how soon and how normal the first one would be.

## Considered Options

- **Client-side dedup over a `LIKE`-filtered Record-API read** (the interim, shipped in #132). Correct and simple; the `LIKE` keeps payloads small at today's scale. Rejected as the *end state* because duplication grows with label reuse and the page cap can drop the long tail. **Kept as the interim** until the endpoint lands.
- **A `DISTINCT` view exposed as a Record API.** Rejected: loses the entity grain the gate needs; reader-dependent visibility can't be baked into a static view; a representative-row view authorizes incorrectly.
- **A denormalized per-`(world, descriptor)` summary table maintained by triggers.** Shrinks duplication but can't encode reader-dependent visibility (owner vs member vs grantee) in one precomputed flag, so reads still need the gate at full grain — more trigger complexity for partial benefit.

## Consequences

- **The first WASM route in the codebase** — establishes the toolchain and the pattern for the gated-aggregate reads that follow. It carries its own build target and JWT-reading auth; tracked as its own implementation slice.
- Until it lands, the interim client-dedup is the live behaviour — honest and correct, just not optimal at scale; the `listDescriptors` comment points here as the upgrade path.
- "Gated-aggregate read" is an architecture term, not domain language — it stays out of `CONTEXT.md` and lives here.
