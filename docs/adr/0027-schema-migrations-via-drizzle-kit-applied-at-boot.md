# Schema migrations via drizzle-kit, applied at boot

The schema had two hand-synced sources of truth — a raw `CREATE TABLE IF NOT EXISTS` block in `db.ts` (runtime truth) and `schema.ts` (Drizzle types) — plus bespoke, hand-written upgrades for live databases (`migrateToWorlds`). As the schema grows and real databases must travel across app versions without losing data, this drifts and doesn't scale. We adopt **drizzle-kit** with the **`generate` + `migrate`** workflow: `schema.ts` becomes the single source, `drizzle-kit generate` emits versioned SQL migration files committed to the repo, and drizzle's `migrate()` applies the unapplied ones **at boot, inside `createDb`** — the same path serves the production process, the seed CLI, and every `:memory:` test, so tests exercise the real migration files rather than a parallel schema.

Boot-time application (rather than a separate deploy/CLI step) is deliberate: there is one NestJS process on one SQLite file (ADR-0002), so nothing races the migration, and some self-hosters are **non-technical** — no manual migration step is acceptable. Deploy = restart, schema follows automatically.

## Considered Options

- **`drizzle-kit push` (diff-and-apply, no files).** Rejected: no review, no ordering, no apply-once ledger, and — decisively — nowhere to put a data backfill. `push` is for throwaway prototype databases; ours carry data across versions.
- **Separate migration CLI step in the deploy sequence.** Rejected: the only reason to split migration from boot is multiple racing instances, which we don't have. A separate step also reintroduces a manual operation non-technical self-hosters can't perform.
- **Keep hand-written DDL + per-feature migration functions** (the `migrateToWorlds` pattern). Rejected: this is exactly the duplication and drift we're removing; ordering and apply-once tracking would be reinvented by hand.

## Consequences

- **`schema.ts` is the single source of truth.** The `CREATE TABLE` block in `db.ts` and the now-obsolete `migrateToWorlds` are deleted. `mintWorldWithHome` survives as application code (used by tests and the future World-creation flow); only its migration duty ends.
- **Migration history starts at `0000`.** No legacy/pre-Worlds state exists, so `0000` is the current full schema. The one existing up-to-date database is adopted into the history as-is via a one-time transitional baseline (no data loss, no ledger surgery); the production process then only ever applies *new* files.
- **Migration files are co-located and bundled.** They live at `apps/api/src/app/db/migrations` (next to `schema.ts`), are asset-mapped by webpack to `dist/apps/api/migrations`, and are resolved at runtime via `__dirname` — mirroring how `resolveDbPath` already treats `__dirname`, so one path works in both the bundle and source-run tests.
- **Data backfills use `generate --custom`** — an empty, ordered, ledger-tracked migration hand-written as SQL — applied automatically at boot alongside generated DDL. No scaffolding is built for this until first needed.
- **TS-logic backfills are deferred but unblocked.** A backfill needing application logic (e.g. building an `emptyEntityBody` document) cannot live in a `.sql` file. When a non-technical user needs such a change to reach their DB, the path is an ordered, idempotent TS-step runner layered *after* drizzle's `migrate()` in the same `createDb` boot flow (a "JS migration journal"), tracked in its own applied-steps ledger. Nothing in this decision precludes it; we add it the day it's required, not before.
