# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **multi-context**: a `CONTEXT-MAP.md` at the repo root indexes a root **Platform** `CONTEXT.md` (the host: Entity model, Containers, sharing, shared surfaces, self-hosting) plus a per-plugin `CONTEXT.md` colocated in each plugin lib. One `docs/adr/` at the repo root serves all contexts.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — the index of contexts and how they relate. Read it first to find which context owns the area you're about to work in.
- The **`CONTEXT.md`** for that context: the root one for Platform-level work, or `libs/plugin-<name>/CONTEXT.md` when the work is inside a plugin's vocabulary. Read the Platform one alongside it — plugin language is always downstream of the Entity/Field kernel.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo:

```
/
├── CONTEXT-MAP.md            # indexes the contexts and their relationships
├── CONTEXT.md                # the Platform (host) context
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── libs/
    ├── plugin-hexmap/CONTEXT.md
    ├── plugin-board/CONTEXT.md
    ├── plugin-content/CONTEXT.md
    └── plugin-asset/CONTEXT.md
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
