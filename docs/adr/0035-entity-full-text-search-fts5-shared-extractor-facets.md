# Entity search: SQLite FTS5 fed by a shared format-tagged text extractor, plus column facets

This realizes the matching engine ADR-0025 deferred. `GET /api/entities` gains full-text search over **name, tags, and Content prose**, and faceted filtering by **type, tags, and visibility**. The wire contract (envelope, opaque cursor, `q`/`type` params) is unchanged; only the engine behind it and a new `tag`/`visibility` param arrive.

## Full-text search: FTS5 external-content table + triggers

Search is a SQLite **FTS5** virtual table (`entities_fts`) over `name`, `tags`, and a new `content_text` column on `entities`. It is **external-content** (`content='entities'`, `content_rowid='rowid'`) so FTS stores no duplicate copy, and it is kept in sync by `AFTER INSERT/UPDATE/DELETE` **triggers** on `entities` — not by app-level upserts.

Triggers over app-level upsert because there is more than one write path — normal save through `EntitiesService` **and** the bulk-import pipeline (ADR-0033), with more likely later. App-level upsert reintroduces a "did every writer remember to reindex?" hazard; the import path forgetting is the concrete failure. Triggers make any write that sets the columns index automatically. The cost is ~15 lines of write-once trigger DDL in a drizzle-kit migration (ADR-0027); the FTS table and `MATCH` queries live outside Drizzle's typed API as raw SQL either way, so triggers don't push logic _out_ of TS that app-level upsert would keep in it.

The UPDATE trigger is **guarded**: `WHEN old.name IS NOT new.name OR old.tags IS NOT new.tags OR old.content_text IS NOT new.content_text`. Only the three indexed fields trigger a reindex, so the close-to-live autosave path (ADR-0019's deferred-not-precluded editing) doesn't reindex when a save only touches `version`, `visibility`, `is_home`, or `updated_at`.

Ranking: with a query, order by `bm25(entities_fts)`; without a query, keep `updatedAt desc, id asc`. The opaque cursor (ADR-0025) absorbs this — offset paging works over any `ORDER BY`, so no consumer changes.

**Indexing stays synchronous, in-process.** Extraction is a microsecond JSON-tree walk and a single-row FTS reindex is sub-millisecond-to-low-ms; with autosave debounced, reindex frequency tracks saves, not keystrokes. A worker thread / child process was considered for close-to-live save and rejected: the FTS write lives inside the DB transaction (a worker can't reach it — `better-sqlite3` is a single synchronous connection, ADR-committed WAL), and cloning the document across a thread boundary costs more than the extraction it would offload. The trigger to revisit is _measured_ event-loop stalls at real user volume, and the fix then is a write queue or moving off synchronous SQLite — not a worker bolted onto this design.

`LIKE '%q%'` (today's name-only match) was rejected: no ranking, no tokenization, and it can't reach into Content. The user chose ranked full-text deliberately.

## Content text: a shared, format-tagged extractor — not server-side blob parsing

`content_text` is plain text extracted from the Entity's Content by a shared `extractText(content)` function that **switches on the Content format tag** (ADR-0019) and lives in shared code (`libs/domain`), called by _both_ the save path and the import pipeline. It runs server-side on every write and populates the column; triggers do the rest.

This is the load-bearing decision and it deliberately refines ADR-0019. That ADR's invariant is not "no code ever reads Content" — it is "the Entity **model and storage** stay editor-agnostic; format knowledge is isolated behind the format tag so swapping editors is localized." A format-tagged extractor honors that: the Entity schema, sharing, and save/version logic still never parse Content; only one dedicated, tag-dispatched module does, and a new editor format means registering one new extractor, not touching the API. For TipTap the extractor recursively collects `text` fields from the ProseMirror JSON tree — node-type-agnostic (~20 lines, no `@tiptap`/ProseMirror dependency server-side), so the callout/image/table/etc. nodes (ADR-0033) need no per-node handling.

Rejected: **client sends `contentText` on save.** It preserves ADR-0019 with zero server format knowledge, but bulk import writes entities with no editor in the loop — every imported entity would stay unsearchable until manually opened and re-saved. That defeats the point, since import (1000+ entities) is a primary driver.

Rejected: **the API parses the blob inline.** Same outcome as the extractor but with format knowledge smeared through the backend, contradicting ADR-0019. The shared tag-dispatched module is the same cost with the invariant intact.

## Facets: denormalized columns, counts via a dedicated read

Facets are **type**, **tags**, and **visibility** — all filters over denormalized columns (`type`, `visibility`) or the JSON `tags` column (matched via `json_each`). A dedicated read returns each facet's distinct values with counts, so the UI can show them without holding every page client-side.

Counts **drill down**: the read takes the active filter state (text query + selected facet values) and counts each facet's values against all _other_ active constraints, but not its own category — so a facet still shows the sibling values you could add, narrowed by everything else you've picked. Values that match nothing under the current filters are **hidden** (no greyed zero-count rows). The read is recomputed on every filter change.

**Metadata-key facets are deferred.** Faceting on arbitrary Obsidian frontmatter (ADR-0033) means _dynamic_ facets — variable keys, a different UI and query shape — and Metadata is read-only for now. Type/tags/visibility are a uniform single-column facet UI; metadata is a separate feature to build when asked, not before.

## Consequences

- New nullable `content_text` column on `entities`, populated by the extractor. A one-time backfill runs the extractor over existing rows and populates `entities_fts` (extraction is format-dispatched TS, so this is a boot-time pass, not a pure-SQL migration).
- `entityListQuerySchema` (`libs/domain`) gains `tag` and `visibility` params alongside the existing `q`/`type`. Client plumbing (`searchEntities`, `EntitiesClient.list`, `EntityQuickOpen`) carries them through unchanged.
- The Entity Browser moves filtering/sorting **server-side** (it currently sorts loaded pages client-side by `updatedAt`) — correct under pagination once a query or facet narrows the set.
- The facet read takes the active filters and recomputes on each change (drill-down counts, zero-count values hidden). It runs alongside the paged list read on every filter change — two reads per interaction, both cheap at this scale.
