import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
 * mode for concurrent reads (ADR-0002), bring the schema up to date by applying
 * any unapplied migrations, and return a Drizzle handle over it. The whole app
 * shares one connection — one NestJS process for a handful of users.
 */
export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  // SQLite ignores `REFERENCES` clauses unless foreign keys are enabled, and the
  // pragma is per-connection — so it must be set on every connection we open.
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // Apply unapplied migrations at boot (ADR-0027). `schema.ts` is the single
  // source of truth; the SQL files in `./migrations` are generated from it by
  // `pnpm db:generate` and shipped beside the bundle (webpack asset-map), so
  // `__dirname` resolves them in prod and in source-run tests alike — the same
  // `__dirname` convention `resolveDbPath` relies on.
  migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  return db;
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
