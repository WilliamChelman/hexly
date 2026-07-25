import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

/**
 * Drizzle handle bound to the Hexly schema. Exposes `$client`, the underlying
 * better-sqlite3 `Database`, so DbModule can close the connection on shutdown.
 */
export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/** DI token for the Drizzle handle so tests can swap in an in-memory database. */
export const DB = Symbol('DB');

/**
 * Open a SQLite database at `path` (`':memory:'` for tests) in WAL mode for
 * concurrent reads (ADR-0002), apply any unapplied migrations, and return a
 * Drizzle handle over it. The whole app shares this one connection.
 */
export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  // Migrations are shipped in the bundle; __dirname resolves them in both prod and tests.
  //
  // Foreign keys stay OFF for the migration window: drizzle runs every migration
  // inside one transaction, where `PRAGMA foreign_keys` is a no-op, so a table
  // rebuild (SQLite's only way to drop a FK-referenced column) would fire
  // ON DELETE CASCADE on the implicit DROP TABLE and wipe dependent rows
  // mid-migration. Enforcement is enabled only afterwards, for the runtime
  // connection. Foreign keys are per-connection (set on every one).
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  sqlite.pragma('foreign_keys = ON');
  return db;
}

/**
 * Resolve the Instance Directory (ADR-0036) — the folder holding `hexly.db` and
 * `hexly.yml`.
 *
 * - `':memory:'` verbatim (config falls back to defaults for it).
 * - `HEXLY_DIR` honoured as-is if absolute, else resolved against cwd.
 * - Nothing set: `__dirname` (where both entry points bundle), not cwd, which
 *   differs between the server and the seed CLI.
 */
export function resolveInstanceDir(): string {
  const configured = process.env.HEXLY_DIR;
  if (configured) {
    return configured === ':memory:' || isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  }
  return __dirname;
}

/** The SQLite file inside the Instance Directory (or `':memory:'` verbatim for tests). */
export function resolveDbPath(): string {
  const dir = resolveInstanceDir();
  return dir === ':memory:' ? ':memory:' : resolve(dir, 'hexly.db');
}

/**
 * The Asset bytes root (ADR-0034): `<instanceDir>/assets` unless `hexly.yml`'s `assets.dir` moves it —
 * absolute as-is, relative against the Instance Directory. The one home for that rule, so no consumer reads
 * config (ADR-0036). A `:memory:` Instance has no real directory, so it falls back to an OS temp dir.
 */
export function resolveAssetsDir(instanceDir: string, configured?: string): string {
  if (instanceDir === ':memory:') return mkdtempSync(join(tmpdir(), 'hexly-assets-'));
  // `resolve` is the absolute-vs-relative rule: a later absolute segment wins.
  return resolve(instanceDir, configured ?? 'assets');
}
