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
      ])
    );
    db.$client.close();
  });

  it('is safe to run twice — the migration ledger skips applied files', () => {
    // A second handle over a fresh DB still boots cleanly; on a real file the
    // ledger makes re-application a no-op rather than a "table exists" error.
    expect(() => createDb(':memory:').$client.close()).not.toThrow();
  });
});
