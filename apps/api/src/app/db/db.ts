import { isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  emptyContent,
  EntityBody,
  hexMapSchema,
  visibilitySchema,
} from '@hexly/domain';
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
  // Convert any pre-#69 `maps` rows into Entities, then drop the old table.
  migrateLegacyMaps(sqlite);
  return drizzle(sqlite, { schema });
}

/** A row of the pre-#69 `maps` table, as the migration reads it. */
interface LegacyMapRow {
  id: string;
  owner_id: string;
  title: string;
  visibility: string;
  version: number;
  document: string;
  created_at: number;
  updated_at: number;
}

/**
 * The deliberate `maps` → `entities` migration (issue #69, ADR-0018). The schema
 * is hand-synced raw DDL with no migration framework, so this runs every time a
 * DB is opened: if the legacy `maps` table is present, each row becomes an
 * Entity of `type: 'hexmap'` (name ← title, empty tags, the grid re-wrapped
 * under the typed payload alongside an empty Content envelope), and the old
 * table is dropped. Each row is converted independently and any row that cannot
 * be (corrupt/invalid document, orphaned owner) is skipped and logged rather than
 * aborting the whole migration — one bad legacy row must never wedge app boot for
 * everyone. The legacy table is dropped only once *every* row has migrated
 * cleanly, so a skipped row is preserved for recovery; until then this stays
 * idempotent (`INSERT OR IGNORE` re-runs harmlessly) and retries the stragglers
 * on the next boot. Once `maps` is gone the guard returns early.
 */
export function migrateLegacyMaps(sqlite: Database.Database): void {
  const legacy = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maps'")
    .get();
  if (!legacy) return;

  const rows = sqlite.prepare('SELECT * FROM maps').all() as LegacyMapRow[];
  // OR IGNORE makes a re-run idempotent: rows already migrated on an earlier
  // boot (when other rows failed and kept the table) are skipped, not duplicated.
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO entities
       (id, owner_id, name, type, tags, visibility, version, document, created_at, updated_at)
     VALUES
       (@id, @owner_id, @name, 'hexmap', '[]', @visibility, @version, @document, @created_at, @updated_at)`,
  );
  let skipped = 0;
  for (const row of rows) {
    try {
      // Parse through the hex-map schema so documents saved before regions/labels
      // existed gain their defaults, then wrap the grid under the hexmap body.
      const grid = hexMapSchema.parse(JSON.parse(row.document));
      const body: EntityBody = { type: 'hexmap', content: emptyContent(), ...grid };
      insert.run({
        id: row.id,
        owner_id: row.owner_id,
        name: row.title,
        // A stored visibility outside the schema falls back to the safe default
        // (private) rather than failing the row or leaking it as public.
        visibility: visibilitySchema.catch('private').parse(row.visibility),
        version: row.version,
        document: JSON.stringify(body),
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    } catch (cause) {
      // A single un-migratable row (bad document, missing owner FK) is logged and
      // skipped — the table is kept below so the row survives for manual recovery.
      skipped++;
      console.error(`Skipping un-migratable legacy map ${row.id}`, cause);
    }
  }
  // Drop the legacy table only if nothing was left behind, so skipped rows aren't
  // silently destroyed and the migration retries them on the next boot.
  if (skipped === 0) sqlite.exec('DROP TABLE maps');
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
