import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { worldThemeSchema } from '@hexly/domain';
import { createDb, resolveAssetsDir } from './db';

/** Apply one migration file's SQL to a raw connection (`--> statement-breakpoint` is a comment). */
function applyMigration(sqlite: Database.Database, file: string): void {
  sqlite.exec(readFileSync(resolve(__dirname, 'migrations', file), 'utf8'));
}

/** The one home of the absolute/relative/absent rule for `assets.dir` (ADR-0034 amendment). */
describe('resolveAssetsDir (ADR-0034, ADR-0070)', () => {
  it('defaults to the `assets` folder inside the Instance Directory — no `assets.dir`, no change', () => {
    expect(resolveAssetsDir('/srv/hexly')).toBe(join('/srv/hexly', 'assets'));
  });

  it('takes a configured absolute path as-is', () => {
    expect(resolveAssetsDir('/srv/hexly', '/Volumes/Vault/hexly-assets')).toBe('/Volumes/Vault/hexly-assets');
  });

  it('resolves a configured relative path against the Instance Directory', () => {
    expect(resolveAssetsDir('/srv/hexly', '../big/assets')).toBe('/srv/big/assets');
    expect(resolveAssetsDir('/srv/hexly', 'media')).toBe('/srv/hexly/media');
  });

  it('falls back to a throwaway temp dir for a :memory: Instance, which reads no hexly.yml at all', () => {
    const dir = resolveAssetsDir(':memory:');
    expect(existsSync(dir)).toBe(true);
    expect(dir).not.toContain(':memory:');
  });
});

describe('createDb boot migration (ADR-0027)', () => {
  it('builds the full schema on a fresh in-memory DB', () => {
    const db = createDb(':memory:');
    const tables = (
      db.$client.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'sessions',
        'entities',
        'containers',
        'worlds',
        // The Compendium satellite beside `worlds` on the shared Container (ADR-0078, ADR-0079).
        'compendiums',
        'world_members',
        'world_links',
        'entity_descriptors',
        // Entity-level grants (ADR-0037, #161) — the boot migration adds this.
        'entity_grants',
        // The full-text search virtual table (ADR-0035).
        'entities_fts',
      ]),
    );
    db.$client.close();
  });

  it('builds the FTS index and its three sync triggers (ADR-0035)', () => {
    const db = createDb(':memory:');
    const triggers = (
      db.$client.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`).all() as { name: string }[]
    ).map((r) => r.name);

    // INSERT/UPDATE/DELETE triggers keep entities_fts in sync with entities.
    expect(triggers).toEqual(expect.arrayContaining(['entities_fts_ai', 'entities_fts_au', 'entities_fts_ad']));
    db.$client.close();
  });

  it('carries the roles set, the Superadmin flag, and the disable stamp on users (ADR-0037, ADR-0047)', () => {
    const db = createDb(':memory:');
    const columns = (db.$client.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map((c) => c.name);
    // Migration 0009 added the tier flags; 0014/0015 replaced `is_admin`/`can_create_worlds`
    // with the `roles` JSON set, leaving the Superadmin flag and disable stamp.
    expect(columns).toEqual(expect.arrayContaining(['roles', 'is_superadmin', 'disabled_at']));
    expect(columns).not.toContain('is_admin');
    expect(columns).not.toContain('can_create_worlds');
    db.$client.close();
  });

  it('is safe to run twice — the migration ledger skips applied files', () => {
    // Re-running migrate() skips already-applied files (not CREATE TABLE again).
    const db = createDb(':memory:');
    expect(() => migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') })).not.toThrow();
    db.$client.close();
  });
});

/**
 * 0003 backfills each prior single Owner into the ownership sets, then retires the
 * `owner_id` columns. A fresh test DB would run the backfill over empty tables, so
 * the pre-0037 schema is rebuilt by hand and seeded with owned data.
 */
describe('symmetric-owners migration round-trip (0003)', () => {
  function seededPre0037(): Database.Database {
    const sqlite = new Database(':memory:');
    // Rebuild is a table drop+recreate; FK cascades would wipe the backfill mid-run
    // (createDb disables enforcement for the same reason).
    sqlite.pragma('foreign_keys = OFF');
    for (const file of ['0000_amused_nomad.sql', '0001_supreme_sersi.sql', '0002_past_randall_flagg.sql']) {
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
    expect(sqlite.prepare(`SELECT user_id FROM world_members WHERE world_id = 'w1' AND role = 'owner'`).all()).toEqual([
      { user_id: 'u1' },
    ]);
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
    expect(sqlite.prepare(`SELECT name, document FROM entities WHERE id = 'e1'`).get()).toEqual({
      name: 'Lady Mara',
      document: '{"type":"note"}',
    });
    // The FTS index still matches by prose — rowid carried forward, triggers recreated.
    expect(
      sqlite
        .prepare(
          `SELECT e.id FROM entities_fts f JOIN entities e ON e.rowid = f.rowid WHERE entities_fts MATCH 'obelisk'`,
        )
        .all(),
    ).toEqual([{ id: 'e1' }]);
    sqlite.close();
  });
});

/**
 * 0007 backfills every `entity_owners` row as a `role: 'owner'` row in `entity_grants`,
 * then drops the table. Owner wins the merge — a user who was both an Owner and held an
 * editor/viewer grant collapses to one owner row. A fresh DB would fold an empty table,
 * so the pre-fold shape is seeded by hand.
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
 * 0005 flips every pre-existing Home Entity to 'shared' — old rows stored 'private' and
 * were unreadable to members. A fresh DB has no old Homes, so one is seeded the old way.
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

    expect(sqlite.prepare(`SELECT visibility FROM entities WHERE id = 'home1'`).get()).toEqual({
      visibility: 'shared',
    });
    sqlite.close();
  });
});

/**
 * 0011 drops `entities.is_home` and the `idx_world_home` partial unique index, and adds
 * `worlds.pinned_entity_ids`. An existing home note survives as an ordinary row — no
 * demotion — and the entities rebuild carries rowid forward so the FTS index stays aligned.
 * A fresh DB has no old home, so one is seeded the old way.
 */
describe('Home-Entity removal migration (0011)', () => {
  function seededPre0011(): Database.Database {
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
      '0007_fold_entity_owners.sql',
      '0008_complex_ink.sql',
      '0009_dry_lila_cheney.sql',
      '0010_world_creation_capability.sql',
    ]) {
      applyMigration(sqlite, file);
    }
    sqlite.prepare(`INSERT INTO worlds (id, name, created_at, updated_at) VALUES ('w1', 'Aldermoor', 0, 0)`).run();
    // A home note stored the old way — flagged is_home, locked shared.
    sqlite
      .prepare(
        `INSERT INTO entities (id, world_id, is_home, name, type, tags, visibility, version, document, content_text, created_at, updated_at)
         VALUES ('home1', 'w1', 1, 'Aldermoor', 'note', '[]', 'shared', 1, '{"type":"note"}', 'the buried obelisk', 0, 0)`,
      )
      .run();
    return sqlite;
  }

  it('drops is_home + idx_world_home, adds pinned_entity_ids, keeps the home note as a normal row', () => {
    const sqlite = seededPre0011();
    applyMigration(sqlite, '0011_remove_home_entity.sql');

    const entityCols = (sqlite.prepare(`PRAGMA table_info(entities)`).all() as { name: string }[]).map((c) => c.name);
    expect(entityCols).not.toContain('is_home');

    const indexes = (
      sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(indexes).not.toContain('idx_world_home');

    const worldCols = (sqlite.prepare(`PRAGMA table_info(worlds)`).all() as { name: string }[]).map((c) => c.name);
    expect(worldCols).toContain('pinned_entity_ids');
    // The pre-existing World backfills to an empty pin set.
    expect(sqlite.prepare(`SELECT pinned_entity_ids FROM worlds WHERE id = 'w1'`).get()).toEqual({
      pinned_entity_ids: '[]',
    });

    // The former home note survives intact as an ordinary Note — no demotion, no deletion.
    expect(sqlite.prepare(`SELECT name, document FROM entities WHERE id = 'home1'`).get()).toEqual({
      name: 'Aldermoor',
      document: '{"type":"note"}',
    });
    sqlite.close();
  });

  it('carries rowid forward so the FTS index still matches by prose after the rebuild', () => {
    const sqlite = seededPre0011();
    applyMigration(sqlite, '0011_remove_home_entity.sql');

    expect(
      sqlite
        .prepare(
          `SELECT e.id FROM entities_fts f JOIN entities e ON e.rowid = f.rowid WHERE entities_fts MATCH 'obelisk'`,
        )
        .all(),
    ).toEqual([{ id: 'home1' }]);
    sqlite.close();
  });
});

/**
 * 0031 rewrites both surfaces the ColorScheme rename touches (ADR-0077): the stored World Theme's
 * own `solar`/`astral` keys — at the top level and under `overrides` — with its version, and the
 * roaming Preference's `colorScheme` value.
 *
 * Seeded on the current schema rather than by replaying 0000…0030: the migration is data-only, so
 * the pre-migration *schema* is this one and only the rows differ.
 */
describe('ColorScheme light/dark migration round-trip (0031)', () => {
  /** One Palette as version 1 stored it — the anchor set is unchanged by this migration. */
  const PALETTE = {
    page: 'oklch(0.92 0.045 87)',
    ink: 'oklch(0.26 0.03 70)',
    inkQuiet: 'oklch(0.48 0.05 78)',
    accent: 'oklch(0.51 0.11 76)',
    danger: 'oklch(0.47 0.18 33)',
    success: 'oklch(0.44 0.13 132)',
    canvas: 'oklch(0.91 0.04 87)',
    soot: 'oklch(0.3 0.04 68)',
    polarity: 1,
    lineAlpha: 0.371,
    veil: 0.12,
  };

  function seededPreRename(): Database.Database {
    const db = createDb(':memory:');
    const sqlite = db.$client;
    sqlite.pragma('foreign_keys = OFF');
    // A World themed before the upgrade, token overrides included — the fine-tuning that must not be
    // the part that gets lost.
    const theme = {
      version: 1,
      solar: PALETTE,
      astral: { ...PALETTE, polarity: -1 },
      radii: { '--radius-md': '0px' },
      fontPairing: 'codex',
      overrides: {
        solar: { '--color-ink': 'oklch(0.2 0.01 90)' },
        astral: { '--color-canvas-glow': 'rgba(1,2,3,0.4)' },
      },
    };
    seedWorld(sqlite, 'w1', 'Aldermoor', JSON.stringify(theme));
    // A World with no Theme at all, which is every World that never opened the editor.
    seedWorld(sqlite, 'w2', 'Whisperwood', null);
    // Two readers with a roaming choice, and one who never expressed any.
    for (const [id, prefs] of [
      ['u1', '{"locale":"fr","colorScheme":"astral"}'],
      ['u2', '{"colorScheme":"solar"}'],
      ['u3', '{"locale":"en"}'],
    ]) {
      sqlite
        .prepare(
          `INSERT INTO users (id, email, display_name, password_hash, preferences, created_at) VALUES (?,?,?,?,?,0)`,
        )
        .run(id, `${id}@hexly.test`, id, 'h', prefs);
    }
    return sqlite;
  }

  /** A World as the current schema stores it: its Container identity row plus its satellite (ADR-0078). */
  function seedWorld(sqlite: Database.Database, id: string, name: string, theme: string | null): void {
    sqlite
      .prepare(`INSERT INTO containers (id, kind, name, created_at, updated_at) VALUES (?,'world',?,0,0)`)
      .run(id, name);
    sqlite.prepare(`INSERT INTO worlds (id, theme) VALUES (?,?)`).run(id, theme);
  }

  function themeOf(sqlite: Database.Database, id: string): Record<string, unknown> | null {
    const row = sqlite.prepare(`SELECT theme FROM worlds WHERE id = ?`).get(id) as { theme: string | null };
    return row.theme === null ? null : (JSON.parse(row.theme) as Record<string, unknown>);
  }

  it('rewrites a stored Theme’s keys and version, at both levels, and it re-validates', () => {
    const sqlite = seededPreRename();
    applyMigration(sqlite, '0031_color_scheme_light_dark.sql');

    const theme = themeOf(sqlite, 'w1');
    expect(Object.keys(theme ?? {}).sort()).toEqual(['dark', 'fontPairing', 'light', 'overrides', 'radii', 'version']);
    expect(Object.keys((theme?.['overrides'] as object) ?? {}).sort()).toEqual(['dark', 'light']);
    // The values ride through untouched — a World already themed paints identically afterwards.
    expect(theme?.['light']).toEqual(PALETTE);
    expect(theme?.['dark']).toEqual({ ...PALETTE, polarity: -1 });
    expect(theme?.['overrides']).toEqual({
      light: { '--color-ink': 'oklch(0.2 0.01 90)' },
      dark: { '--color-canvas-glow': 'rgba(1,2,3,0.4)' },
    });

    // The point of the version bump: what comes out is what this build's choke point accepts.
    const parsed = worldThemeSchema.safeParse(theme);
    expect(parsed.success, parsed.error?.message).toBe(true);

    // A World that carries no Theme is left alone rather than given an empty one.
    expect(themeOf(sqlite, 'w2')).toBeNull();
    sqlite.close();
  });

  it('rewrites the roaming Preference, so a signed-in reader keeps the ColorScheme they chose', () => {
    const sqlite = seededPreRename();
    applyMigration(sqlite, '0031_color_scheme_light_dark.sql');

    const prefs = (
      sqlite.prepare(`SELECT id, preferences FROM users ORDER BY id`).all() as { id: string; preferences: string }[]
    ).map((row) => [row.id, JSON.parse(row.preferences)]);

    expect(prefs).toEqual([
      // The other Preferences in the bag ride through untouched.
      ['u1', { locale: 'fr', colorScheme: 'dark' }],
      ['u2', { colorScheme: 'light' }],
      // No expressed choice stays no expressed choice — the client still detects the OS preference.
      ['u3', { locale: 'en' }],
    ]);
    sqlite.close();
  });
});

/**
 * 0032 backfills every World into `containers` at its *own* id, then rebuilds `worlds` as the
 * satellite. The claim worth pinning is that an existing Instance upgrades in place: no World id
 * moves, no name / `seq` / timestamp is lost, and nothing hanging off a World is cascaded away by
 * the rebuild. A fresh DB has no pre-existing Worlds, so one is seeded the old way.
 */
describe('containers backfill migration (0032)', () => {
  function seededPre0032(): Database.Database {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    // Every file before this one — too many to list, unlike the earlier round-trips.
    for (const file of readdirSync(resolve(__dirname, 'migrations'))
      .filter((f) => f.endsWith('.sql') && f < '0032')
      .sort()) {
      applyMigration(sqlite, file);
    }
    sqlite
      .prepare(
        `INSERT INTO worlds (id, name, seq, pinned_entity_ids, theme, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run('w1', 'Aldermoor', 42, '["e1"]', '{"version":2}', 100, 200);
    sqlite
      .prepare(
        `INSERT INTO worlds (id, name, seq, pinned_entity_ids, theme, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run('w2', 'Whisperwood', 7, '[]', null, 300, 400);
    sqlite.prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES ('w1','u1','owner')`).run();
    sqlite.prepare(`INSERT INTO world_links (id, world_id, created_at) VALUES ('tok','w1',0)`).run();
    sqlite
      .prepare(
        `INSERT INTO world_types (world_id, type_id, label, field_refs, views, created_at, updated_at)
         VALUES ('w1','world.type.deity','Deity','[]',NULL,0,0)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO world_fields (world_id, field_id, definition, created_at, updated_at)
         VALUES ('w1','world.field.era','{}',0,0)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO entities (id, world_id, name, types, tags, visibility, version, seq, document, content_text, created_at, updated_at)
         VALUES ('e1','w1','Lady Mara','[]','[]','shared',1,3,'{}','the buried obelisk',0,0)`,
      )
      .run();
    return sqlite;
  }

  it('gives every World a Container at the same id, and keeps its name, seq and timestamps', () => {
    const sqlite = seededPre0032();
    applyMigration(sqlite, '0032_containers_hold_identity.sql');

    expect(sqlite.prepare(`SELECT * FROM containers ORDER BY id`).all()).toEqual([
      { id: 'w1', kind: 'world', name: 'Aldermoor', seq: 42, created_at: 100, updated_at: 200 },
      { id: 'w2', kind: 'world', name: 'Whisperwood', seq: 7, created_at: 300, updated_at: 400 },
    ]);
    // The satellite keeps the pins and the Theme, at the same id, and sheds identity.
    expect(sqlite.prepare(`SELECT * FROM worlds ORDER BY id`).all()).toEqual([
      { id: 'w1', pinned_entity_ids: '["e1"]', theme: '{"version":2}' },
      { id: 'w2', pinned_entity_ids: '[]', theme: null },
    ]);
    sqlite.close();
  });

  it('leaves Collaboration and every world_id pointing at the World untouched by the rebuild', () => {
    const sqlite = seededPre0032();
    applyMigration(sqlite, '0032_containers_hold_identity.sql');

    // The DROP TABLE inside the rebuild must not have cascaded any of these away.
    expect(sqlite.prepare(`SELECT world_id, user_id, role FROM world_members`).all()).toEqual([
      { world_id: 'w1', user_id: 'u1', role: 'owner' },
    ]);
    expect(sqlite.prepare(`SELECT id, world_id FROM world_links`).all()).toEqual([{ id: 'tok', world_id: 'w1' }]);
    expect(sqlite.prepare(`SELECT world_id, type_id FROM world_types`).all()).toEqual([
      { world_id: 'w1', type_id: 'world.type.deity' },
    ]);
    expect(sqlite.prepare(`SELECT world_id, field_id FROM world_fields`).all()).toEqual([
      { world_id: 'w1', field_id: 'world.field.era' },
    ]);
    // The entity side still names its column `world_id` here: #396 renames it, never a value.
    expect(sqlite.prepare(`SELECT id, world_id, seq FROM entities`).all()).toEqual([
      { id: 'e1', world_id: 'w1', seq: 3 },
    ]);
    sqlite.close();
  });
});

/**
 * 0033 repoints the entity side at the Container (ADR-0078): five tables rename `world_id` to
 * `container_id` and `entities`' foreign key moves to `containers`. The claims worth pinning are the
 * ones a rename can silently break — not one stored value moves, the FTS index survives the `entities`
 * rebuild, and the Asset dedup key still resolves every already-uploaded Asset's byte address. A fresh
 * DB has nothing to carry across, so a World's worth of rows is seeded the old way.
 */
describe('container repoint migration (0033)', () => {
  const HASH = 'a1b2c3';

  function seededPre0033(): Database.Database {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    for (const file of readdirSync(resolve(__dirname, 'migrations'))
      .filter((f) => f.endsWith('.sql') && f < '0033')
      .sort()) {
      applyMigration(sqlite, file);
    }
    sqlite
      .prepare(
        `INSERT INTO containers (id, kind, name, seq, created_at, updated_at) VALUES ('w1','world','Aldermoor',1,0,0)`,
      )
      .run();
    sqlite.prepare(`INSERT INTO worlds (id, pinned_entity_ids) VALUES ('w1','[]')`).run();
    for (const [id, name] of [
      ['e1', 'Lady Mara'],
      ['a1', 'Portrait'],
    ]) {
      sqlite
        .prepare(
          `INSERT INTO entities (id, world_id, name, types, tags, visibility, version, seq, document, content_text, created_at, updated_at)
           VALUES (?,'w1',?,'[]','[]','shared',1,3,'{}','the buried obelisk',0,0)`,
        )
        .run(id, name);
    }
    // One row in each derived index, as the write choke point would have materialised it.
    sqlite.prepare(`INSERT INTO asset_index (entity_id, world_id, hash, ext) VALUES ('a1','w1',?, '.png')`).run(HASH);
    sqlite
      .prepare(
        `INSERT INTO entity_edges (source_entity_id, world_id, target_kind, target_id, descriptor, decor)
         VALUES ('e1','w1','asset',?,NULL,1)`,
      )
      .run(HASH);
    sqlite
      .prepare(
        `INSERT INTO entity_field_facets (entity_id, world_id, key, value, num) VALUES ('e1','w1','core.field.kind','image',NULL)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO entity_import_source (entity_id, world_id, importer, source_id, rev)
         VALUES ('e1','w1','draw-steel.importer.monsters','goblin','sha-abc')`,
      )
      .run();
    return sqlite;
  }

  it('renames the column on all five tables and moves not one stored value', () => {
    const sqlite = seededPre0033();
    applyMigration(sqlite, '0033_entities_belong_to_containers.sql');

    const containerIds = (table: string) =>
      sqlite.prepare(`SELECT DISTINCT container_id AS id FROM ${table}`).all() as { id: string }[];
    for (const table of ['entities', 'entity_edges', 'entity_field_facets', 'entity_import_source', 'asset_index']) {
      // The World's Container id *is* the World's id, so every row stays where it was.
      expect(containerIds(table), table).toEqual([{ id: 'w1' }]);
      expect(
        (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
        table,
      ).not.toContain('world_id');
    }
    // The rest of each row rides through the rebuild untouched.
    expect(sqlite.prepare(`SELECT id, name, seq FROM entities ORDER BY id`).all()).toEqual([
      { id: 'a1', name: 'Portrait', seq: 3 },
      { id: 'e1', name: 'Lady Mara', seq: 3 },
    ]);
    // `entities` now hangs off the Container, which is what lets a Compendium's Entity live here later.
    expect(
      (sqlite.prepare(`PRAGMA foreign_key_list(entities)`).all() as { table: string }[]).map((f) => f.table),
    ).toEqual(['containers']);
    sqlite.close();
  });

  it('carries rowid forward so the FTS index still matches by prose after the entities rebuild', () => {
    const sqlite = seededPre0033();
    applyMigration(sqlite, '0033_entities_belong_to_containers.sql');

    expect(
      sqlite
        .prepare(
          `SELECT e.id FROM entities_fts f JOIN entities e ON e.rowid = f.rowid WHERE entities_fts MATCH 'obelisk' ORDER BY e.id`,
        )
        .all(),
    ).toEqual([{ id: 'a1' }, { id: 'e1' }]);
    // The recreated triggers keep syncing, so a post-migration write is still findable.
    sqlite.prepare(`UPDATE entities SET content_text = 'the drowned lighthouse' WHERE id = 'e1'`).run();
    expect(
      sqlite
        .prepare(
          `SELECT e.id FROM entities_fts f JOIN entities e ON e.rowid = f.rowid WHERE entities_fts MATCH 'lighthouse'`,
        )
        .all(),
    ).toEqual([{ id: 'e1' }]);
    sqlite.close();
  });

  it('keeps every uploaded Asset’s byte address and its dedup key resolving', () => {
    const sqlite = seededPre0033();
    applyMigration(sqlite, '0033_entities_belong_to_containers.sql');

    // `<containerId>/<hash><ext>` is the on-disk address, and it is the same string it was before.
    expect(sqlite.prepare(`SELECT container_id, hash, ext FROM asset_index WHERE entity_id = 'a1'`).get()).toEqual({
      container_id: 'w1',
      hash: HASH,
      ext: '.png',
    });
    // The unique dedup key still holds, so re-uploading identical bytes still resolves to the Asset
    // that already wraps them rather than minting a twin.
    expect(() =>
      sqlite.prepare(`INSERT INTO asset_index (entity_id, container_id, hash) VALUES ('e1','w1',?)`).run(HASH),
    ).toThrow(/UNIQUE/);
    sqlite.close();
  });
});

/**
 * 0034 repoints the authored vocabulary at the Container (ADR-0078): `world_types` and `world_fields`
 * rename `world_id` to `container_id` and hang off `containers`. Both are rebuilt, since the foreign key
 * and the composite primary key both span the renamed column. The claims worth pinning are what a
 * rebuild can silently break — not one stored value moves, the composite key still refuses a twin, and
 * the cascade that used to run through the `worlds` satellite still takes a deleted World's vocabulary
 * with it. A fresh DB has nothing to carry across, so a World's worth of rows is seeded the old way.
 */
describe('vocabulary repoint migration (0034)', () => {
  function seededPre0034(): Database.Database {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    for (const file of readdirSync(resolve(__dirname, 'migrations'))
      .filter((f) => f.endsWith('.sql') && f < '0034')
      .sort()) {
      applyMigration(sqlite, file);
    }
    sqlite
      .prepare(
        `INSERT INTO containers (id, kind, name, seq, created_at, updated_at) VALUES ('w1','world','Aldermoor',1,0,0)`,
      )
      .run();
    sqlite.prepare(`INSERT INTO worlds (id, pinned_entity_ids) VALUES ('w1','[]')`).run();
    sqlite
      .prepare(
        `INSERT INTO world_types (world_id, type_id, label, field_refs, views, created_at, updated_at)
         VALUES ('w1','world.type.deity','Deity','["world.field.era"]','[{"fieldId":"world.field.era"}]',10,20)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO world_fields (world_id, field_id, definition, created_at, updated_at)
         VALUES ('w1','world.field.era','{"label":"Era","dataType":"string"}',30,40)`,
      )
      .run();
    return sqlite;
  }

  it('renames the column on both tables and moves not one stored value', () => {
    const sqlite = seededPre0034();
    applyMigration(sqlite, '0034_types_and_fields_belong_to_containers.sql');

    for (const table of ['world_types', 'world_fields']) {
      expect(
        (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
        table,
      ).not.toContain('world_id');
      // The World's Container id *is* the World's id, so the vocabulary stays where it was.
      expect(sqlite.prepare(`SELECT DISTINCT container_id AS id FROM ${table}`).all(), table).toEqual([{ id: 'w1' }]);
      // The vocabulary now hangs off the Container, which is what lets it travel with the content later.
      expect(
        (sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string }[]).map((f) => f.table),
        table,
      ).toEqual(['containers']);
    }
    // The rest of each row rides through the rebuild untouched — the authored labels, the Field
    // references, the View order a type named, and both timestamps.
    expect(sqlite.prepare(`SELECT * FROM world_types`).all()).toEqual([
      {
        container_id: 'w1',
        type_id: 'world.type.deity',
        label: 'Deity',
        field_refs: '["world.field.era"]',
        views: '[{"fieldId":"world.field.era"}]',
        created_at: 10,
        updated_at: 20,
      },
    ]);
    expect(sqlite.prepare(`SELECT * FROM world_fields`).all()).toEqual([
      {
        container_id: 'w1',
        field_id: 'world.field.era',
        definition: '{"label":"Era","dataType":"string"}',
        created_at: 30,
        updated_at: 40,
      },
    ]);
    sqlite.close();
  });

  it('re-heads the composite key on the container, so an id is still authored at most once', () => {
    const sqlite = seededPre0034();
    applyMigration(sqlite, '0034_types_and_fields_belong_to_containers.sql');

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO world_types (container_id, type_id, label, field_refs, views, created_at, updated_at)
           VALUES ('w1','world.type.deity','Twin','[]',NULL,0,0)`,
        )
        .run(),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO world_fields (container_id, field_id, definition, created_at, updated_at)
           VALUES ('w1','world.field.era','{}',0,0)`,
        )
        .run(),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
    sqlite.close();
  });

  it('still takes a deleted World’s Types and Fields with it, now cascading off the Container', () => {
    const sqlite = seededPre0034();
    applyMigration(sqlite, '0034_types_and_fields_belong_to_containers.sql');
    // The cascade source moved from the `worlds` satellite to the `containers` row; enforcement is on
    // for the runtime connection, which is where a World delete actually runs (createDb, ADR-0027).
    sqlite.pragma('foreign_keys = ON');

    sqlite.prepare(`DELETE FROM containers WHERE id = 'w1'`).run();

    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM world_types`).get()).toEqual({ n: 0 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM world_fields`).get()).toEqual({ n: 0 });
    sqlite.close();
  });
});
