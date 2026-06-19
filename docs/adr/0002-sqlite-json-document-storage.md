# Maps stored as JSON documents in SQLite, sized for a small closed group

Hexly is a "desktop-style" web app for a small, closed set of users (~5). Given that scale, each Hex Map is persisted as a **single JSON document in a SQLite database** (the document in a `TEXT` column on a `maps` row, with relational metadata — id, owner, title, visibility, version, timestamps — alongside). SQLite runs in WAL mode as one file on a mounted volume; the backend is one NestJS process. DB access uses Drizzle ORM (the schema — `users`, `maps`, `shares` — is too small to justify Prisma/TypeORM).

## Considered Options

The reflexive choice would be Postgres with a normalized schema (`hexes`, `regions`, … rows). We rejected it: at ~5 users SQLite never approaches its write-concurrency ceiling, and a normalized schema buys partial server-side updates and row-level collaboration that we **explicitly deferred** (see real-time collab being out of scope). A single-document model makes save/load/export/import trivial and matches the "small portable JSON" shape of the map.

## Consequences

- Saves write the whole document; concurrency is whole-document granularity, resolved by an optimistic **`version`** field (a save whose base version has moved is rejected — surfaced as HTTP 409).
- No server-side partial updates or querying *into* a map.
- If a single map ever outgrows one document, it can be chunked by coordinate region later — the document shape does not preclude that. If the user base grows beyond a handful, this decision (DB + storage shape) is the one to revisit first.
