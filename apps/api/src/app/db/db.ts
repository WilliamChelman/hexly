import { isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
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
 * mode for concurrent reads (ADR-0002), ensure the schema exists, and return a
 * Drizzle handle over it. The whole app shares one connection — one NestJS
 * process for a handful of users.
 */
export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  // SQLite ignores `REFERENCES` clauses unless foreign keys are enabled, and the
  // pragma is per-connection — so it must be set on every connection we open.
  sqlite.pragma('foreign_keys = ON');
  // NOTE: This DDL is the runtime source of truth for the schema, but it MUST be
  // kept in sync by hand with `./schema.ts` (the Drizzle definition the queries
  // are typed against). `IF NOT EXISTS` only creates missing tables — it will
  // NOT alter an existing table, so adding/changing a column here on a database
  // that already exists is a silent no-op. A real schema change to a live DB
  // requires a migration (e.g. drizzle-kit), not just editing this block.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    -- Speeds up the expired-session sweep that runs on every login.
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);
  return drizzle(sqlite, { schema });
}

/**
 * Resolve the SQLite file path the app should open, identically for every entry
 * point (server bootstrap, seed CLI) so they always agree on one file.
 *
 * - `':memory:'` is returned verbatim (tests rely on a fresh per-process DB).
 * - `HEXLY_DB_PATH`, when set, is honoured as-is — callers are expected to pass
 *   an absolute path. A relative value is still resolved against cwd as an
 *   explicit, opt-in override.
 * - With nothing set, we default to an absolute path anchored to this module's
 *   bundled location (`__dirname`) rather than cwd, which varies between the
 *   server and the seed CLI. Both entry points bundle next to each other, so
 *   they land on the same `hexly.db` regardless of where they were launched.
 */
export function resolveDbPath(): string {
  const configured = process.env.HEXLY_DB_PATH;
  if (configured) {
    return configured === ':memory:' || isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
  }
  return resolve(__dirname, 'hexly.db');
}
