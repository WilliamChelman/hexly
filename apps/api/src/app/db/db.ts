import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

/**
 * Drizzle handle bound to the Hexly schema; the type AuthService depends on.
 * Includes `$client`, the underlying better-sqlite3 `Database`, so the
 * connection lifecycle (DbModule shutdown) can close it.
 */
export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/** DI token for the Drizzle handle so tests can swap in an in-memory database. */
export const DB = Symbol('DB');

/**
 * Open a SQLite database at `path` (use `':memory:'` for tests), put it in WAL
 * mode for concurrent reads (ADR-0002), bring the schema up to date by applying
 * any unapplied migrations, and return a Drizzle handle over it. The whole app
 * shares one connection — one NestJS process for a handful of users.
 */
export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  // Apply unapplied migrations at boot (ADR-0027). Migrations are generated
  // from schema.ts and shipped in the bundle; __dirname resolves them in both
  // prod and tests (same __dirname pattern as resolveDbPath).
  //
  // Foreign keys stay OFF for the migration window: drizzle runs every migration
  // inside one transaction, where `PRAGMA foreign_keys` is a no-op, so a table
  // rebuild (SQLite's only way to drop a FK-referenced column, e.g. ADR-0037's
  // owner_id retirement) would fire ON DELETE CASCADE on the implicit DROP TABLE
  // and wipe dependent rows mid-migration. Enable enforcement only afterwards, for
  // the runtime connection. Foreign keys are per-connection (set on every one).
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  sqlite.pragma('foreign_keys = ON');
  return db;
}

/**
 * Resolve the Instance Directory (ADR-0036) — the folder holding `hexly.db` and
 * `hexly.yml` — identically for every entry point (server, seed CLI) so they
 * agree on one location.
 *
 * - `':memory:'` verbatim (tests rely on a fresh per-process DB; config falls
 *   back to defaults for it).
 * - `HEXLY_DIR` honoured as-is if absolute, else resolved against cwd.
 * - Nothing set: default to `__dirname` (where both entry points bundle), not
 *   cwd, which differs between the server and the seed CLI.
 */
export function resolveInstanceDir(): string {
  const configured = process.env.HEXLY_DIR;
  if (configured) {
    return configured === ':memory:' || isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
  }
  return __dirname;
}

/** The SQLite file inside the Instance Directory (or `':memory:'` verbatim for tests). */
export function resolveDbPath(): string {
  const dir = resolveInstanceDir();
  return dir === ':memory:' ? ':memory:' : resolve(dir, 'hexly.db');
}

/**
 * The Asset bytes folder beside the database (ADR-0034), `<instanceDir>/assets`. For a
 * `:memory:` instance (no real directory) it falls back to a throwaway OS temp dir, so an
 * in-memory run still has somewhere real to write bytes.
 */
export function resolveAssetsDir(instanceDir: string = resolveInstanceDir()): string {
  return instanceDir === ':memory:'
    ? mkdtempSync(join(tmpdir(), 'hexly-assets-'))
    : join(instanceDir, 'assets');
}
