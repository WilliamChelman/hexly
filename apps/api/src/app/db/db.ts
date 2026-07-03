import { isAbsolute, resolve } from 'node:path';
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
  // Foreign keys are per-connection and must be enabled on every connection.
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // Apply unapplied migrations at boot (ADR-0027). Migrations are generated
  // from schema.ts and shipped in the bundle; __dirname resolves them in both
  // prod and tests (same __dirname pattern as resolveDbPath).
  migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  return db;
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
