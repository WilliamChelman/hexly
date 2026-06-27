import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { emptyEntityBody } from '@hexly/domain';
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
    -- Entities reference worlds (world_id); a World holds no FK back, so there is
    -- no cycle. The worlds table is created just below — SQLite permits the forward
    -- reference at CREATE time. The Home Entity is the World's is_home row.
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      world_id TEXT NOT NULL REFERENCES worlds(id),
      is_home INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      tags TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private',
      version INTEGER NOT NULL,
      document TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- The list endpoint and every access check filter by owner.
    CREATE INDEX IF NOT EXISTS idx_entities_owner_id ON entities(owner_id);
    -- A World groups Entities for one campaign (ADR-0024). owner_id is the World
    -- Owner; the Home Entity landing page is the World's is_home Entity.
    CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_worlds_owner_id ON worlds(owner_id);
    -- Named World membership below the Owner: contributor | viewer.
    CREATE TABLE IF NOT EXISTS world_members (
      world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL,
      PRIMARY KEY (world_id, user_id)
    );
    -- A World Public Link: id is the unguessable token granting Viewer access.
    CREATE TABLE IF NOT EXISTS world_links (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_links_world_id ON world_links(world_id);
    -- The owner's Link Descriptor vocabulary (#96): one row per (entity, descriptor),
    -- replaced on each successful save and cascade-deleted with its entity.
    -- owner_id is omitted — derivable via entities(id) JOIN, and the PK covers entity lookups.
    CREATE TABLE IF NOT EXISTS entity_descriptors (
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      descriptor TEXT NOT NULL,
      PRIMARY KEY (entity_id, descriptor)
    );
  `);
  migrateToWorlds(sqlite);
  // After the migration has added `world_id`/`is_home` to a legacy `entities`
  // table — both columns already exist on a fresh DB — index the World-scoped
  // reads and enforce one Home Entity per World (partial unique over is_home).
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_entities_world_id ON entities(world_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_world_home ON entities(world_id) WHERE is_home = 1;
  `);
  return drizzle(sqlite, { schema });
}

/**
 * One-time, idempotent migration to the Worlds model (ADR-0024, #101). Only runs
 * against a *pre-Worlds* `entities` table — one created before `world_id` existed.
 * A fresh database is created with `world_id` already present, so this is a no-op
 * there (and on any DB it has already migrated).
 *
 * For each existing user it creates one World, assigns all their Entities to it,
 * remaps the retired `visibility = 'public'` to `'shared'`, and designates a Home
 * Entity — flagging their oldest existing Entity `is_home`, or minting a fresh
 * blank note if they have none. No circular FK: a World is inserted first, then
 * Entities reference it. The whole thing runs in one transaction for atomicity.
 *
 * NOTE: SQLite cannot add a NOT NULL column to a populated table without a default,
 * so the ALTER adds `world_id` nullable; the backfill leaves no NULL behind and the
 * app (Drizzle `notNull()`) enforces the invariant on every write thereafter.
 */
function migrateToWorlds(sqlite: Database.Database): void {
  const columns = sqlite
    .prepare(`PRAGMA table_info(entities)`)
    .all() as { name: string }[];
  if (columns.some((c) => c.name === 'world_id')) return;

  sqlite.transaction(() => {
    sqlite.exec(`ALTER TABLE entities ADD COLUMN world_id TEXT REFERENCES worlds(id)`);
    sqlite.exec(`ALTER TABLE entities ADD COLUMN is_home INTEGER NOT NULL DEFAULT 0`);
    sqlite.exec(`UPDATE entities SET visibility = 'shared' WHERE visibility = 'public'`);

    const now = Date.now();
    const users = sqlite
      .prepare(`SELECT id, display_name FROM users`)
      .all() as { id: string; display_name: string }[];
    const oldestEntity = sqlite.prepare(
      `SELECT id FROM entities WHERE owner_id = ? ORDER BY created_at, id LIMIT 1`,
    );
    const insertWorld = sqlite.prepare(
      `INSERT INTO worlds (id, name, owner_id, created_at, updated_at) VALUES (?,?,?,?,?)`,
    );
    const assign = sqlite.prepare(
      `UPDATE entities SET world_id = ? WHERE owner_id = ? AND world_id IS NULL`,
    );
    const flagHome = sqlite.prepare(`UPDATE entities SET is_home = 1 WHERE id = ?`);

    for (const user of users) {
      const existing = oldestEntity.get(user.id) as { id: string } | undefined;
      if (!existing) {
        // No Entities to home in — mint a blank Home note (same as a brand-new user).
        mintWorldWithHome(sqlite, user.id, user.display_name, now);
        continue;
      }
      const worldId = randomUUID();
      insertWorld.run(worldId, user.display_name, user.id, now, now);
      assign.run(worldId, user.id);
      flagHome.run(existing.id);
    }
  })();
}

/**
 * Create a World for `ownerId` with a freshly minted blank Home note (ADR-0024).
 * Used when there is no existing Entity to home in — by {@link migrateToWorlds}
 * for an entity-less user, and to stand in for the future World-creation flow.
 * The World is inserted first, then its Home note (`is_home = 1`) references it —
 * no cycle, so a plain transaction (atomicity only) suffices.
 */
export function mintWorldWithHome(
  sqlite: Database.Database,
  ownerId: string,
  name: string,
  now: number = Date.now(),
): { worldId: string; homeEntityId: string } {
  const worldId = randomUUID();
  const homeEntityId = randomUUID();
  const document = JSON.stringify(emptyEntityBody('note'));
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `INSERT INTO worlds (id, name, owner_id, created_at, updated_at) VALUES (?,?,?,?,?)`,
      )
      .run(worldId, name, ownerId, now, now);
    sqlite
      .prepare(
        `INSERT INTO entities (id, owner_id, world_id, is_home, name, type, tags, visibility, version, document, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, 'note', '[]', 'private', 1, ?, ?, ?)`,
      )
      .run(homeEntityId, ownerId, worldId, name, document, now, now);
  })();
  return { worldId, homeEntityId };
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
