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
        // Entity-level grants (ADR-0037, #161) — the boot migration adds this.
        'entity_grants',
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

  it('adds the admin-tier columns to users (ADR-0037, #163)', () => {
    const db = createDb(':memory:');
    const columns = (
      db.$client.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]
    ).map((c) => c.name);
    // The boot migration (0009) adds the two tier flags and the disable stamp.
    expect(columns).toEqual(
      expect.arrayContaining(['is_admin', 'is_superadmin', 'disabled_at']),
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
    // The Entity Owner is now an `entity_owners` row (folded into entity_grants by 0007,
    // which this test predates — it applies only 0003, so the standalone table still exists here).
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

/**
 * The entity_owners fold (ADR-0037, 0007): entity ownership stops being its own table and
 * becomes a `role: 'owner'` row in `entity_grants`, mirroring `world_members`. The migration
 * backfills every `entity_owners` row as an owner grant, then drops the table. Owner wins the
 * merge — a user who was both an Owner and held an editor/viewer grant collapses to one owner
 * row. A fresh DB folds an empty table, so this seeds the pre-fold shape and asserts the move.
 */
describe('entity_owners fold migration (0007)', () => {
  it('backfills owners as owner grants (owner wins the merge), preserves other grants, drops the table', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    for (const file of [
      '0000_amused_nomad.sql',
      '0001_supreme_sersi.sql',
      '0002_past_randall_flagg.sql',
      '0003_symmetric_owner_sets.sql',
      '0004_elite_sleepwalker.sql',
      '0005_open_hearth.sql',
      '0006_smart_maddog.sql',
    ]) {
      applyMigration(sqlite, file);
    }
    sqlite
      .prepare(
        `INSERT INTO entities (id, world_id, is_home, name, type, tags, visibility, version, document, content_text, created_at, updated_at)
         VALUES ('e1', 'w1', 0, 'Lady Mara', 'note', '[]', 'private', 1, '{"type":"note"}', '', 0, 0)`,
      )
      .run();
    // u1 and u2 are Owners; u2 *also* holds an editor grant (the collision); u3 is a plain viewer.
    for (const u of ['u1', 'u2']) {
      sqlite.prepare(`INSERT INTO entity_owners (entity_id, user_id) VALUES ('e1', ?)`).run(u);
    }
    sqlite.prepare(`INSERT INTO entity_grants (entity_id, user_id, role) VALUES ('e1', 'u2', 'editor')`).run();
    sqlite.prepare(`INSERT INTO entity_grants (entity_id, user_id, role) VALUES ('e1', 'u3', 'viewer')`).run();

    applyMigration(sqlite, '0007_fold_entity_owners.sql');

    // Owners are now owner grants; u2's editor grant lost to owner; u3's viewer grant survives.
    expect(
      sqlite.prepare(`SELECT user_id, role FROM entity_grants WHERE entity_id = 'e1' ORDER BY user_id`).all(),
    ).toEqual([
      { user_id: 'u1', role: 'owner' },
      { user_id: 'u2', role: 'owner' },
      { user_id: 'u3', role: 'viewer' },
    ]);
    // The table is gone.
    const tables = (
      sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).not.toContain('entity_owners');
    sqlite.close();
  });
});

/**
 * The Home-visibility backfill (ADR-0037, 0005) flips every pre-existing Home Entity to
 * 'shared'. New Homes are created locked-shared, but old rows stored 'private' became
 * unreadable to members. A fresh DB has no old Homes, so this seeds a 'private' Home the
 * old way, applies 0005, and asserts the flip.
 */
describe('Home-visibility backfill migration (0005)', () => {
  it('flips every pre-existing private Home Entity to shared', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    for (const file of [
      '0000_amused_nomad.sql',
      '0001_supreme_sersi.sql',
      '0002_past_randall_flagg.sql',
      '0003_symmetric_owner_sets.sql',
      '0004_elite_sleepwalker.sql',
    ]) {
      applyMigration(sqlite, file);
    }
    // A Home Entity stored 'private', as pre-ADR-0037 worlds created it.
    sqlite
      .prepare(
        `INSERT INTO entities (id, world_id, is_home, name, type, tags, visibility, version, document, content_text, created_at, updated_at)
         VALUES ('home1', 'w1', 1, 'Aldermoor', 'note', '[]', 'private', 1, '{"type":"note"}', '', 0, 0)`,
      )
      .run();

    applyMigration(sqlite, '0005_open_hearth.sql');

    expect(
      sqlite.prepare(`SELECT visibility FROM entities WHERE id = 'home1'`).get(),
    ).toEqual({ visibility: 'shared' });
    sqlite.close();
  });
});
