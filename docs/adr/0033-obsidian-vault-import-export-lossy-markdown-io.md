# Importing and exporting Obsidian vaults: markdown is I/O only, one vault ⇄ one World

> **Amended in part by [ADR-0050](./0050-payload-kinds-collapse-into-structured-fields.md) (#203):** two
> statements below are reversed. Export no longer **drops a Hex Map's grid** — a **Structured Field**'s
> value rides the frontmatter as nested YAML like any other Field's — and `hexly.type` is stamped from
> the Entity's whole ordered Type set, naming no type id. Import no longer lands **everything as a
> `note`**: it reads that stamp back and applies it, so a Monster, a Hex Map, and a user-defined type all
> survive the round-trip. Everything else here still stands: markdown is I/O only, the boundary is lossy
> by design, loss is measured at import, and one vault mints one World.

Hexly imports mostly-vanilla Obsidian vaults (a `.zip` of `.md` files, folders, and asset binaries) and exports a World back to the same shape, primarily as a round-trip fidelity check ("what did we lose?"). Markdown is **I/O only** — stored Content stays opaque `tiptap-v*` ProseMirror JSON (ADR-0019); conversion happens in two hand-written pure functions (`mdast → ProseMirror`, `ProseMirror → mdast`) built on **remark/mdast**, chosen for its GFM/frontmatter/wikilink ecosystem and a clean tree to map from. The boundary is deliberately **lossy**: markdown a native extension can't represent is **degraded to the nearest existing node** on import (not preserved verbatim). Loss is measured at **import time** via the summary report, and improvements are iterative by **re-importing the original vault** (which stays authoritative on disk) — not by upgrading stored content in place.

## Mapping

- **One vault → one new World** (named after the vault), non-idempotent: re-import duplicates, no merge, no dedup — keeps the import→inspect→discard test loop simple.
- **Each `.md` → one `note` Entity**; filename → `name`. Everything imports as `note` (Obsidian has no `hexmap`). The World's auto-created Home Entity (ADR-0029) is left untouched; a vault's own index note just becomes a regular note.
- **Folders → Metadata `hexly.sourcePath`** (vault-relative path) — not Tags (would collide with real Obsidian tags and pollute the tag space) and not a new Folder concept (YAGNI). Export reconstructs the folder tree from it.
- **Frontmatter → Metadata map.** Frontmatter `tags:` → Hexly Tags (round-trips back to frontmatter). `aliases:` and every other key → pass-through Metadata, no behaviour (Obsidian resolves aliases only at authoring time, baking the alias into `[[name|alias]]`, so no runtime alias resolution is needed). Inline `#tags` stay literal body text, unharvested for now.
- **`[[wikilinks]]` → `entityLink`**, in a two-pass import (create all Entities, then resolve). Resolution is by basename then explicit path, case-insensitive; an ambiguous basename resolves to the first match in a deterministic order. `[[X|display]]` → the `display` attr; `[[X#heading]]` → the `heading` attr (best-effort text match on navigate); `[[X#^block]]` → block anchor dropped. An unresolved `[[X]]` → a **dangling** `entityLink` (a bare `[[alias]]` with no filename match goes dangling — a measured loss vs Obsidian). `![[Note]]` transclusion degrades to a plain `entityLink` (embed → link).
- **Markdown features:** tables, task lists, images, `==highlight==`, and **callouts** (a custom node preserving `[!type]` + title with live, linkable inner content) render natively. Footnotes, math, mermaid, and `%%comments%%` have no native node and are **degraded to the nearest node** (fenced code / plain text) or dropped, and reported. See ADR-0019 for the full `tiptap-v3` extension set.

## Mechanics

- **Import:** `POST /worlds/import` — Hexly's first multipart endpoint — unzips server-side and runs **synchronously** with a spinner (a background job queue is YAGNI at ~5 users; accepted ceiling: a huge image-heavy vault could approach request-timeout). Skips `.obsidian/` and any non-`.md`/non-asset files. Continue-on-error: a bad file is skipped, never aborts the import. Returns a **summary** — notes imported, wikilinks resolved vs. dangling, assets stored, constructs degraded (footnotes/math/etc.), files skipped — which is the primary "what did we lose" instrument and is surfaced in the UI. Entry point: an "Import vault" action on the World Index (ADR-0028).
- **Export:** World → downloadable `.zip`, pure serialization (stores nothing new). Folders rebuilt from `hexly.sourcePath`; assets written with their original filenames. A `hexmap` Entity exports its lore as `.md` with the **grid dropped** (flagged `hexly.type: hexmap` so the loss is visible); grid round-trip via a sidecar file is deferred. Single-entity `.md` export is deferred.

## Considered Options

- **Markdown as the stored source of truth** (parse-on-edit) — rejected: overturns ADR-0019, breaks the `entityLink` model (raw markdown can't carry `entityId`/`descriptor`), and makes round-trip lossless _by construction_, defeating the loss-measurement goal.
- **A dedicated raw-passthrough node** (`rawBlock`) carrying unsupported markdown verbatim for byte-faithful re-export — considered and **cut**: its value collapses because the original vaults stay authoritative on disk (improve by re-importing, not by upgrading stored blocks), loss is measured at import, and edit-in-Hexly-then-faithful-export is not a target flow. Revisit only if that flow becomes real. Degrade-to-nearest-node is the lazier choice.
- **prosemirror-markdown / tiptap-markdown** — rejected: weaker source positions and single-maintainer risk (the trap ADR-0019 already named), respectively; remark also has the richer ecosystem for the Obsidian-specific syntaxes.
- **Folders as Tags, or as a new Folder concept** — rejected for `hexly.sourcePath` Metadata: no tag pollution, no new domain primitive, and export can still rebuild the tree.
- **Idempotent / merge-into-existing import** — deferred: a syncing model is a much larger feature than the spin-up-and-inspect loop this serves.
