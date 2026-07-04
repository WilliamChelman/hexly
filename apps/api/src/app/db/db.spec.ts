import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './db';

/** Apply one migration file's SQL to a raw connection (`--> statement-breakpoint` is a comment). */
function applyMigration(sqlite: Database.Database, file: string): void {
  sqlite.exec(readFileSync(resolve(__dirname, 'migrations', file), 'utf8'));
}

/**
 * `createDb` applies the migration files at boot (ADR-0027). This proves the
 * migrations folder resolves via `__dirname` under vitest and that `0000` builds
 * the full schema on a fresh DB — the path every spec and the real boot share.
 */
describe('createDb boot migration (ADR-0027)', () => {
  it('builds the full schema on a fresh in-memory DB', () => {
    const db = createDb(':memory:');
    const tables = (
      db.$client
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'sessions',
        'entities',
        'worlds',
        'world_members',
        'world_links',
        'entity_descriptors',
        // The full-text search virtual table (ADR-0035).
        'entities_fts',
      ])
    );
    db.$client.close();
  });

  it('builds the FTS index and its three sync triggers (ADR-0035)', () => {
    const db = createDb(':memory:');
    const triggers = (
      db.$client
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
        .all() as { name: string }[]
    ).map((r) => r.name);

    // INSERT/UPDATE/DELETE triggers keep entities_fts in sync with entities.
    expect(triggers).toEqual(
      expect.arrayContaining(['entities_fts_ai', 'entities_fts_au', 'entities_fts_ad']),
    );
    db.$client.close();
  });

  it('is safe to run twice — the migration ledger skips applied files', () => {
    // Re-running migrate() skips already-applied files (not CREATE TABLE again).
    const db = createDb(':memory:');
    expect(() =>
      migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') }),
    ).not.toThrow();
    db.$client.close();
  });
});

/**
 * The symmetric-owners migration (ADR-0037, #158) backfills each prior single Owner
 * into the new ownership sets, then retires the `owner_id` columns. A fresh test DB
 * runs the backfill over empty tables, so this rebuilds the pre-0037 schema by hand,
 * seeds real owned data, applies 0003, and asserts the round-trip preserves it.
 */
describe('symmetric-owners migration round-trip (0003)', () => {
  function seededPre0037(): Database.Database {
    const sqlite = new Database(':memory:');
    // Rebuild is a table drop+recreate; FK cascades would wipe the backfill mid-run
    // (createDb disables enforcement for the same reason).
    sqlite.pragma('foreign_keys = OFF');
    for (const file of [
      '0000_amused_nomad.sql',
      '0001_supreme_sersi.sql',
      '0002_past_randall_flagg.sql',
    ]) {
      applyMigration(sqlite, file);
    }
    // A user who solely owns a World and an Entity, as the old schema stored it.
    sqlite
      .prepare(`INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,0)`)
      .run('u1', 'a@b.c', 'Ada', 'h');
    sqlite
      .prepare(`INSERT INTO worlds (id, name, owner_id, created_at, updated_at) VALUES (?,?,?,0,0)`)
      .run('w1', 'Aldermoor', 'u1');
    sqlite
      .prepare(
        `INSERT INTO entities (id, owner_id, world_id, is_home, name, type, tags, visibility, version, document, content_text, created_at, updated_at)
         VALUES ('e1', 'u1', 'w1', 0, 'Lady Mara', 'note', '[]', 'private', 1, '{"type":"note"}', 'the buried obelisk', 0, 0)`,
      )
      .run();
    return sqlite;
  }

  it('backfills each prior Owner into the ownership sets and retires the columns', () => {
    const sqlite = seededPre0037();
    applyMigration(sqlite, '0003_symmetric_owner_sets.sql');

    // The World Owner is now a `world_members` row with role 'owner'.
    expect(
      sqlite.prepare(`SELECT user_id FROM world_members WHERE world_id = 'w1' AND role = 'owner'`).all(),
    ).toEqual([{ user_id: 'u1' }]);
    // The Entity Owner is now an `entity_owners` row.
    expect(sqlite.prepare(`SELECT user_id FROM entity_owners WHERE entity_id = 'e1'`).all()).toEqual([
      { user_id: 'u1' },
    ]);
    // Both owner_id columns are gone.
    const cols = (t: string) =>
      (sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('worlds')).not.toContain('owner_id');
    expect(cols('entities')).not.toContain('owner_id');
    sqlite.close();
  });

  it('preserves the Entity row and its full-text index across the rebuild', () => {
    const sqlite = seededPre0037();
    applyMigration(sqlite, '0003_symmetric_owner_sets.sql');

    // The row survives intact.
    expect(
      sqlite.prepare(`SELECT name, document FROM entities WHERE id = 'e1'`).get(),
    ).toEqual({ name: 'Lady Mara', document: '{"type":"note"}' });
    // The FTS index still matches by prose — rowid carried forward, triggers recreated.
    expect(
      sqlite
        .prepare(`SELECT e.id FROM entities_fts f JOIN entities e ON e.rowid = f.rowid WHERE entities_fts MATCH 'obelisk'`)
        .all(),
    ).toEqual([{ id: 'e1' }]);
    sqlite.close();
  });
});
