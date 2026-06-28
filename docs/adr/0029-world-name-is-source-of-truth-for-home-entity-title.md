# World name is the source of truth for the Home Entity's title

A World's name and its Home Entity's title are one name, not two kept in step. The **World name is the source of truth**; the Home Entity's title is derived and read-only, displayed on the landing page with a hint to rename via the World. Renaming a World (`PATCH /worlds/:id`) writes `worlds.name` *and* the Home Entity's `name` in the same transaction.

This supersedes the launch behaviour, where `mintWorldWithHome` seeded the two equal but `rename` left "the Home Entity untouched" and the Home note's title was independently editable — so they diverged on the first rename or edit. Collapsing them to one name with one write path makes divergence impossible.

## Considered Options

- **Home Entity title as source of truth** (world name a mirror updated on entity-save) — rejected: puts a special-case branch in the generic entity-save path and forces a write-back from the World Index, i.e. two-way sync.
- **Two-way sync** — rejected: most moving parts, most ways to race or diverge, for no gain over a single source of truth.

## Consequences

- The Home Entity's title isn't free-text — correct, because it isn't its own thing, it's the World's name. Consistent with the Home Entity already being the can't-delete, can't-move note (ADR-0024).
