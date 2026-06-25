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
  // Runtime source of truth for the schema, kept in sync by hand with
  // `./schema.ts`. `IF NOT EXISTS` won't alter an existing table — a column
  // change on a live DB needs a migration (drizzle-kit), not an edit here.
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
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      tags TEXT NOT NULL,
      visibility TEXT NOT NULL,
      version INTEGER NOT NULL,
      document TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- The list endpoint and every access check filter by owner.
    CREATE INDEX IF NOT EXISTS idx_entities_owner_id ON entities(owner_id);
  `);
  return drizzle(sqlite, { schema });
}

/**
 * Resolve the SQLite file path, identically for every entry point (server, seed
 * CLI) so they agree on one file.
 *
 * - `':memory:'` verbatim (tests rely on a fresh per-process DB).
 * - `HEXLY_DB_PATH` honoured as-is if absolute, else resolved against cwd.
 * - Nothing set: default to `__dirname` (where both entry points bundle), not
 *   cwd, which differs between the server and the seed CLI.
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
