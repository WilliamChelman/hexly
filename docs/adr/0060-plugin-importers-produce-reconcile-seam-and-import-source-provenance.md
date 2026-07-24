# Plugin Importers: a produce/reconcile seam and `hexly.source` provenance

A plugin needs to bulk-create Entities from an external source (the Draw Steel _Monsters_ pack) and let a World Owner wipe-and-reimport them. We split the work so no importer reimplements the provenance-shaped parts. A plugin contributes an **Importer** — `ServerPlugin.importers: [{ id, produce() }]` — that only fetches and transforms, yielding **Import Records** (`{ sourceId, name, types, document }`). A generic, importer-agnostic framework service reconciles those against one World: upsert by `(importer, sourceId)`, **reusing the existing Entity id** so inbound links and grants survive; delete records whose `sourceId` vanished upstream; and stamp each Entity with an **Import Source** — the reserved `hexly.source = { importer, sourceId, rev }` key (CONTEXT.md → Entity Document, the `hexly.*` provenance namespace). Reimport is an identity-preserving overwrite: imported Entities are a managed reference library, so a user's edits to one are not preserved across a run. The reconcile runs as a per-World chunked, yielding, polled job reusing the Reindex batching pattern (ADR-0046), owner-gated, triggered from a generic **Imports panel** in World Settings that lists whatever Importers the enabled plugins registered — so Draw Steel contributes only its `produce()` and its copy, no bespoke route or chrome (ADR-0053).

Because filtering a World by provenance must never load big documents (a hex grid, rich content), the `hexly.source` doc key stays the source of truth while a skinny derived **`entityImportSource`** index — materialized at the write choke point beside the facet and link indexes (ADR-0045, ADR-0046) — answers "what did this importer create here" with Entity ids alone.

## Considered Options

- **Importer owns the whole import** (fetch + transform + DB writes + provenance). Rejected: the upsert/delete/stamp logic is entirely importer-agnostic, so every importer would reimplement it — it belongs once in the framework, leaving the plugin a near-pure producer that is trivially fixture-tested.
- **A first-class import-run table as the provenance source of truth.** Rejected: a second store to keep in sync with the Entity Document. The reserved `hexly.*` namespace already exists for exactly this, and a _derived_ index gives the query path without a second source of truth.
- **Destructive delete-all-then-recreate on reimport.** Rejected: recreated Entities get new ids, dangling every user link to an imported monster and cascading away its grants and public-link tokens; the `(importer, sourceId)` index buys identity-preserving upsert at nearly the same cost.
- **A single whole-run transaction.** Rejected in favour of the established per-chunk-commit Reindex pattern (ADR-0046); idempotent upsert makes a re-run self-healing, so whole-run atomicity is not needed.

## Consequences

- Overwrite-on-reimport means imported monsters are **not** a customization surface. A future "fork to an editable copy" flow would be the adopt-and-edit path.
- Atomicity is **per-chunk**, not per-run: a failed run can leave a partial bestiary, but re-running the (idempotent) import reconciles it.
- `entityImportSource` is derived, never authoritative — a rebuild re-reads `hexly.source` from the documents, like the facet and link indexes.
- The seam is reusable: any future importer (even the vault import) can produce Import Records and inherit reconcile, provenance, and the panel for free.
