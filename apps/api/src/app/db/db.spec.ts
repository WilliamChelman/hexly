import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './db';

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
