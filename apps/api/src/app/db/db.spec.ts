import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { emptyEntityBody } from '@hexly/domain';
import { createDb } from './db';

/**
 * Build a database in the *pre-Worlds* shape (#101): an `entities` table with no
 * `world_id` column and the retired `visibility = 'public'` value still in use.
 * Returns the file path so `createDb` can re-open it and run the migration.
 */
function seedLegacyDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hexly-mig-'));
  const path = join(dir, 'hexly.db');
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE entities (
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
  `);

  const insUser = sqlite.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)`,
  );
  insUser.run('ada', 'ada@hexly.test', 'Ada', 'x', 1);
  insUser.run('bob', 'bob@hexly.test', 'Bob', 'x', 1);

  const insEntity = sqlite.prepare(
    `INSERT INTO entities (id, owner_id, name, type, tags, visibility, version, document, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  const doc = JSON.stringify(emptyEntityBody('note'));
  // Ada has two entities: an older private one and a newer 'public' one.
  insEntity.run('e-old', 'ada', 'Keep', 'note', '[]', 'private', 1, doc, 10, 10);
  insEntity.run('e-new', 'ada', 'Share', 'note', '[]', 'public', 1, doc, 20, 20);
  // Bob has none — the migration must mint him a Home note.
  sqlite.close();
  return path;
}

describe('Worlds migration (#101)', () => {
  const paths: string[] = [];

  afterEach(() => {
    // better-sqlite3 leaves WAL/SHM siblings; remove the whole temp dir.
    for (const p of paths.splice(0)) rmSync(join(p, '..'), { recursive: true, force: true });
  });

  function migrate(path: string) {
    paths.push(path);
    const db = createDb(path);
    const client = db.$client;
    return {
      worlds: () =>
        client.prepare(`SELECT * FROM worlds ORDER BY owner_id`).all() as any[],
      entities: () =>
        client.prepare(`SELECT * FROM entities ORDER BY id`).all() as any[],
      close: () => client.close(),
    };
  }

  it('creates one World per existing user', () => {
    const db = migrate(seedLegacyDb());
    const worlds = db.worlds();
    expect(worlds.map((w) => w.owner_id).sort()).toEqual(['ada', 'bob']);
    db.close();
  });

  it('assigns every existing entity to its owner World', () => {
    const db = migrate(seedLegacyDb());
    const adaWorld = db.worlds().find((w) => w.owner_id === 'ada');
    const adaEntities = db.entities().filter((e) => e.owner_id === 'ada');
    expect(adaEntities).toHaveLength(2);
    for (const e of adaEntities) expect(e.world_id).toBe(adaWorld.id);
    db.close();
  });

  it('remaps retired visibility = "public" to "shared", leaving "private" alone', () => {
    const db = migrate(seedLegacyDb());
    const byId = Object.fromEntries(db.entities().map((e) => [e.id, e]));
    expect(byId['e-old'].visibility).toBe('private');
    expect(byId['e-new'].visibility).toBe('shared');
    db.close();
  });

  it('flags the oldest existing entity as the World Home when the user has one', () => {
    const db = migrate(seedLegacyDb());
    const byId = Object.fromEntries(db.entities().map((e) => [e.id, e]));
    expect(byId['e-old'].is_home).toBe(1);
    expect(byId['e-new'].is_home).toBe(0);
    db.close();
  });

  it('mints a blank Home note (is_home) for a user with no entities', () => {
    const db = migrate(seedLegacyDb());
    const bobWorld = db.worlds().find((w) => w.owner_id === 'bob');
    const home = db
      .entities()
      .find((e) => e.world_id === bobWorld.id && e.is_home === 1);
    expect(home).toMatchObject({ owner_id: 'bob', type: 'note' });
    db.close();
  });

  it('flags exactly one Home Entity per World', () => {
    const db = migrate(seedLegacyDb());
    const homesPerWorld = new Map<string, number>();
    for (const e of db.entities().filter((e) => e.is_home === 1)) {
      homesPerWorld.set(e.world_id, (homesPerWorld.get(e.world_id) ?? 0) + 1);
    }
    expect([...homesPerWorld.values()]).toEqual([1, 1]);
    db.close();
  });

  it('leaves no entity without a World after migrating', () => {
    const db = migrate(seedLegacyDb());
    expect(db.entities().every((e) => e.world_id)).toBe(true);
    db.close();
  });

  it('is idempotent — re-opening the migrated DB adds no further Worlds', () => {
    const path = seedLegacyDb();
    const first = migrate(path);
    const count = first.worlds().length;
    first.close();
    const second = migrate(path);
    expect(second.worlds()).toHaveLength(count);
    second.close();
  });
});
