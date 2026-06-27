# Entity Content is an editor-agnostic format-tagged snapshot; TipTap is the editor

Every Entity (ADR-0018) carries a rich-text **Content** body. The domain stores it as an **opaque, format-tagged snapshot** — `{ format: 'tiptap-v1', snapshot: {...} }` — that the Entity schema, sharing, and save/version logic never parse. The editor that produces it is therefore **not** lock-in at the domain level: swapping editors or formats later is a content migration behind the `format` tag, not an Entity-model change.

The editor is **TipTap v3** (MIT), integrated into the Angular app (ADR-0007/0008) via the community **`ngx-tiptap`** wrapper, or a thin hand-rolled `@tiptap/core` wrapper if that wrapper's single-maintainer risk bites (it's thin and replaceable). The Content snapshot is TipTap/ProseMirror JSON (`editor.getJSON()`).

## Considered Options

- **BlockSuite** (AFFiNE's Lit/Yjs editor) — spiked first. Verdict: *viable but unimpressive* — ~950 kB gzip lazy and three separate version-pinning landmines (compiled-JS only up to 0.19.5, a floating-dep icon typo, `effects()` registration). Rejected as heavy and high-friction.
- **BlockNote** — the most polished out-of-the-box Notion shell, but its UI and idiomatic custom-block API are **React-only**, its sole Angular wrapper is **deprecated/archived**, and "XL" features (multi-column, AI, PDF/DOCX export) are **GPL-3.0-or-commercial ($195/mo)**. Adopting it means running a permanent React island inside Angular plus a licensing watch. Rejected: not worth a second UI framework for this app.
- **TipTap** — chosen. Framework-agnostic ProseMirror core (no React runtime), ~120 kB gzip (≈8× lighter than the BlockSuite spike), fully MIT with no licensing traps, 1.0+ semver. Decisively, its **node views can be plain DOM or Angular components**, which is the natural home for our planned custom blocks — the **hex-map canvas** and an **entity-reference** block (the latter is the free `mention` extension). The cost we accept: TipTap is **headless**, so we build the slash menu and formatting toolbar ourselves.

## Consequences

- **ProseMirror JSON is schema-coupled: content for a node type not in the registered extension set is silently dropped on load.** So the registered extension set is part of the `format` contract — a schema change is a format change (bump the `format` tag and migrate), not a transparent edit. This is the main sharp edge of the choice and the reason the format tag exists.
- We own UI chrome (slash menu, toolbar) and a thin dependency on `ngx-tiptap`; both are deliberate, bounded costs.

## Registered extension set for `tiptap-v1`

The authoritative list lives in code at `apps/web/src/app/note-view/content-extensions.ts` (`CONTENT_EXTENSIONS`); this records what it contains so the boundary is explicit. As of the first content slice (#71) it is exactly **`@tiptap/starter-kit` (v3)** — the document/paragraph/text core plus headings, bullet & ordered lists, bold, italic, strike, underline, code, code block, blockquote, horizontal rule, hard break, and links.

**Update — `tiptap-v2` (ADR-0023):** adds the `entityLink` inline atom (an Entity Link living in prose Content). Readers accept both `tiptap-v1` and `tiptap-v2`; the node is additive, so v1 docs load unchanged and saves write `tiptap-v2`. This is the first bump and sets the dual-read migration pattern.

Adding or removing a schema node/mark changes which documents a `tiptap-vN` reader can load losslessly, so either is a `format` bump (`tiptap-v2`, …) + migration — **not** a transparent edit. Removal loses existing data on load. Adding is safe for *existing* content, but lets new content carry nodes an unbumped reader silently drops — e.g. on rollback or staged rollout, where a faithful `tiptap-v1` reader meets a `tiptap-v1`-tagged doc that now contains the new node. The `format` tag's contract is "support a version's extensions ⇒ load any doc of that version losslessly"; widening the set without bumping makes that false. Non-schema extensions (input rules, keymaps, history) may change freely. The planned slash menu, formatting toolbar, and custom blocks (hex-map and entity-reference node views) extend this set behind the same contract.

## Collaboration is deferred, not precluded

This revises the wording of **ADR-0004**, which read as if real-time co-editing were designed out. It is not: it is **deferred**. We build no collab plumbing now (effort for nobody at ~5 users), but the path stays cheap: TipTap's collaboration is the y-prosemirror lineage (`@tiptap/extension-collaboration` + `@tiptap/y-tiptap`) with a self-hostable MIT backend (Hocuspocus). We store a plain JSON snapshot today under last-write-wins guarded by `version`; turning collab on later means bridging stored JSON → a Yjs `Y.Doc` and moving concurrency to CRDT merge — a contained migration the `format` tag absorbs, not a model change.
