import { coordKey, emptyContent, entityBodySchema } from '@hexly/domain';
import { createDb, migrateLegacyMaps } from './db';

/**
 * The deliberate `maps` → `entities` migration (issue #69). The schema is
 * hand-synced raw DDL with no auto-migration framework, so this is the one
 * conversion: every legacy Hex Map row becomes an Entity of `type: 'hexmap'`,
 * its grid re-wrapped under the typed payload alongside an empty Content
 * envelope. We test the function directly against a database carrying the legacy
 * shape.
 */
describe('migrateLegacyMaps', () => {
  /** Stand up a DB with the new `entities` table plus the legacy `maps` table. */
  function legacyDb() {
    const db = createDb(':memory:');
    const sqlite = db.$client;
    // A user for the owner FK the migrated entity will reference.
    sqlite
      .prepare(
        'INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('ada', 'ada@hexly.test', 'Ada', 'hash', 1);
    // The pre-#69 `maps` table, exactly as the old DDL declared it.
    sqlite.exec(`
      CREATE TABLE maps (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        visibility TEXT NOT NULL,
        version INTEGER NOT NULL,
        document TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    return sqlite;
  }

  it('converts a legacy map row into a hexmap Entity, grid intact under the body', () => {
    const sqlite = legacyDb();
    const grid = {
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
      regions: [],
      labels: [],
    };
    sqlite
      .prepare(
        'INSERT INTO maps VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('m1', 'ada', 'The Reach of Aldermoor', 'private', 3, JSON.stringify(grid), 10, 20);

    migrateLegacyMaps(sqlite);

    const row = sqlite
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get('m1') as Record<string, unknown>;
    // Metadata: name ← title, type hexmap, empty tags, version/timestamps kept.
    expect(row).toMatchObject({
      id: 'm1',
      owner_id: 'ada',
      name: 'The Reach of Aldermoor',
      type: 'hexmap',
      tags: '[]',
      visibility: 'private',
      version: 3,
      created_at: 10,
      updated_at: 20,
    });
    // Body: a valid hexmap body — empty Content envelope, the grid carried whole.
    const body = entityBodySchema.parse(JSON.parse(row.document as string));
    expect(body).toEqual({ type: 'hexmap', content: emptyContent(), ...grid });
  });

  /** Insert one pre-#69 `maps` row with the given columns. */
  function insertMap(
    sqlite: ReturnType<typeof legacyDb>,
    row: {
      id: string;
      owner?: string;
      title?: string;
      visibility?: string;
      document?: string;
    },
  ) {
    sqlite
      .prepare('INSERT INTO maps VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        row.id,
        row.owner ?? 'ada',
        row.title ?? 'A map',
        row.visibility ?? 'private',
        1,
        row.document ?? JSON.stringify({ hexes: {} }),
        1,
        1,
      );
  }

  /** True if a row with `id` made it into the new `entities` table. */
  function migrated(sqlite: ReturnType<typeof legacyDb>, id: string): boolean {
    return !!sqlite.prepare('SELECT 1 FROM entities WHERE id = ?').get(id);
  }

  /** True if the legacy `maps` table still exists. */
  function legacyTableExists(sqlite: ReturnType<typeof legacyDb>): boolean {
    return !!sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maps'")
      .get();
  }

  it('skips a legacy row with an un-parseable document instead of crashing the whole migration', () => {
    const sqlite = legacyDb();
    insertMap(sqlite, { id: 'good' });
    insertMap(sqlite, { id: 'bad', document: 'not valid json{' });

    expect(() => migrateLegacyMaps(sqlite)).not.toThrow();

    // The healthy row migrates; the one bad row does not take the app down with it.
    expect(migrated(sqlite, 'good')).toBe(true);
    expect(migrated(sqlite, 'bad')).toBe(false);
    // The legacy table is preserved (not dropped) so the un-migrated row isn't lost.
    expect(legacyTableExists(sqlite)).toBe(true);
  });

  it('skips a legacy row whose owner no longer exists (orphaned FK) instead of crashing', () => {
    const sqlite = legacyDb();
    insertMap(sqlite, { id: 'good', owner: 'ada' });
    // An orphan can only exist if FKs weren't enforced when it was written
    // (the pre-#69 connection); migration then trips the entities owner FK.
    sqlite.pragma('foreign_keys = OFF');
    insertMap(sqlite, { id: 'orphan', owner: 'ghost' });
    sqlite.pragma('foreign_keys = ON');

    expect(() => migrateLegacyMaps(sqlite)).not.toThrow();

    expect(migrated(sqlite, 'good')).toBe(true);
    expect(migrated(sqlite, 'orphan')).toBe(false);
    expect(legacyTableExists(sqlite)).toBe(true);
  });

  it('defaults an out-of-range visibility to private rather than migrating an invalid value', () => {
    const sqlite = legacyDb();
    insertMap(sqlite, { id: 'm1', visibility: 'top-secret' });

    migrateLegacyMaps(sqlite);

    const row = sqlite
      .prepare('SELECT visibility FROM entities WHERE id = ?')
      .get('m1') as { visibility: string };
    expect(row.visibility).toBe('private');
  });

  it('drops the legacy table and is a no-op when run again', () => {
    const sqlite = legacyDb();
    sqlite
      .prepare('INSERT INTO maps VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('m1', 'ada', 'X', 'private', 1, JSON.stringify({ hexes: {} }), 1, 1);

    migrateLegacyMaps(sqlite);

    const stillThere = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maps'")
      .get();
    expect(stillThere).toBeUndefined();
    // A second run finds no legacy table and changes nothing.
    expect(() => migrateLegacyMaps(sqlite)).not.toThrow();
    expect(
      sqlite.prepare('SELECT count(*) AS n FROM entities').get(),
    ).toEqual({ n: 1 });
  });
});
