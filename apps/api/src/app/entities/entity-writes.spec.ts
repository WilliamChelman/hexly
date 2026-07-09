import { emptyContent, emptyEntityBody, tiptapContent } from '@hexly/domain';
import { eq } from 'drizzle-orm';
import { createDb, Db } from '../db/db';
import {
  entities,
  entityDescriptors,
  entityGrants,
  users,
  worldMembers,
  worlds,
} from '../db/schema';
import { NudgeBus } from '../events/nudge-bus';
import { WriteOutbox } from '../events/write-outbox';
import { EntityChange, EntityWrites, MutateResult } from './entity-writes';

/**
 * `EntityWrites` is the single write handle for `entities` and `entity_grants` (ADR-0045), so
 * its interface is the test surface — the first service-level spec in `apps/api`, and justified
 * only because this module *is* the seam. Everything else here stays controller-level.
 *
 * The table below is the load-bearing part: it enumerates the write kinds, so a fifth kind added
 * without an emit fails CI rather than shipping the bug class ADR-0044 shipped twice.
 *
 * Real in-memory SQLite, real ACL. Only the bus is a recorder — it *is* the observation.
 */
describe('EntityWrites', () => {
  const ADA = 'ada';
  const BOB = 'bob';
  const WORLD = 'world-1';
  const ENTITY = 'entity-1';

  let db: Db;
  let emitted: string[];
  let writes: EntityWrites;

  beforeEach(() => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    emitted = [];
    // A recorder, not a mock: `emitEntityChange(id)` is the whole contract EntityWrites
    // depends on, and what it emitted is exactly what we assert. No vi.mock() in this repo.
    const bus = {
      emitEntityChange: (id: string) => void emitted.push(id),
    } as unknown as NudgeBus;
    // The real outbox: the transaction and the post-commit flush are part of what this spec
    // asserts, so only the bus at the far end of it is a recorder.
    writes = new EntityWrites(db, new WriteOutbox(db, bus));

    seedUser(ADA);
    seedWorld(WORLD, ADA);
    seedEntity(ENTITY, WORLD, ADA);
  });

  /**
   * The write kinds *are* the Rights verbs (ADR-0045). One representative change per kind —
   * the point is coverage of the set, not of each payload's shape.
   */
  const KINDS: ReadonlyArray<readonly [string, EntityChange]> = [
    ['edit', { kind: 'edit', name: 'Renamed' }],
    ['set-visibility', { kind: 'set-visibility', visibility: 'shared' }],
    // Revoking a grant is the write ADR-0044 shipped without an emit, evicting nobody.
    ['manage', { kind: 'manage', acl: (w) => w.removeGrant(BOB) }],
    ['delete', { kind: 'delete' }],
  ];

  // The invariant both ADR-0044 defects violated: a write cannot land without nudging.
  it.each(KINDS)('a committed %s emits exactly one nudge', (_kind, change) => {
    seedUser(BOB);
    seedGrant(ENTITY, BOB, 'viewer');

    const result = writes.mutate(ADA, ENTITY, change);

    expect(result.status).toBe('ok');
    expect(emitted).toEqual([ENTITY]);
  });

  /** Every kind but `delete` leaves a row behind to inspect. */
  const SURVIVING_KINDS = KINDS.filter(([kind]) => kind !== 'delete');

  it.each(SURVIVING_KINDS)('a committed %s bumps seq', (_kind, change) => {
    seedUser(BOB);
    seedGrant(ENTITY, BOB, 'viewer');

    writes.mutate(ADA, ENTITY, change);

    expect(rowOf(ENTITY).seq).toBe(2);
  });

  /**
   * `version` is the concurrency token in `edit`'s atomic WHERE. Bump it on a sharing or exposure
   * change and sharing an Entity would 409 a colleague's in-flight save. `updatedAt` is
   * user-visible ("edited {date}", `ORDER BY updatedAt DESC`): bump it and a GM who shares thirty
   * Entities before a session sends all thirty to the top of "Recently edited".
   */
  it.each([
    ['set-visibility', { kind: 'set-visibility', visibility: 'shared' }],
    ['manage', { kind: 'manage', acl: (w) => w.removeGrant(BOB) }],
  ] as ReadonlyArray<readonly [string, EntityChange]>)(
    '%s moves seq alone — never version, never updatedAt',
    (_kind, change) => {
      seedUser(BOB);
      seedGrant(ENTITY, BOB, 'viewer');
      const before = rowOf(ENTITY);

      writes.mutate(ADA, ENTITY, change);

      const after = rowOf(ENTITY);
      expect(after.seq).toBe(before.seq + 1);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toBe(before.updatedAt);
    },
  );

  it('edit moves updatedAt, and version only when a base version rides the change', () => {
    const before = rowOf(ENTITY);

    writes.mutate(ADA, ENTITY, { kind: 'edit', name: 'Renamed' });

    // A name-only patch is substance, so it is "edited" — but it carries no base version,
    // so it never invalidates an in-progress save.
    const renamed = rowOf(ENTITY);
    expect(renamed.version).toBe(before.version);
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);

    writes.mutate(ADA, ENTITY, { kind: 'edit', version: before.version, name: 'Again' });

    expect(rowOf(ENTITY).version).toBe(before.version + 1);
  });

  /**
   * `contentText` and `descriptors` are both derived from Content, but `insertEntity` computed
   * only the first — so a created or imported Entity contributed nothing to the `::` Link
   * Descriptor vocabulary until someone happened to re-save it. One derivation, one place.
   */
  describe('derived indexes', () => {
    const CONTENT = tiptapContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Married to ' },
            { type: 'entityLink', attrs: { entityId: 'e2', descriptor: 'spouse' } },
          ],
        },
      ],
    });

    it('an inserted Entity harvests its Link Descriptors, not just its search text', () => {
      writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Ealdred',
        tags: [],
        body: { type: 'note', content: CONTENT },
      });

      expect(descriptorsOf('Ealdred')).toEqual(['spouse']);
      expect(contentTextOf('Ealdred')).toBe('Married to');
    });

    it('an edit replaces the descriptor set, so it prunes itself', () => {
      const row = writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Ealdred',
        tags: [],
        body: { type: 'note', content: CONTENT },
      });

      writes.mutate(ADA, row.id, {
        kind: 'edit',
        version: row.version,
        document: { type: 'note', content: emptyContent() },
      });

      expect(descriptorsOf('Ealdred')).toEqual([]);
    });

    function idOf(name: string): string {
      const row = db.select().from(entities).where(eq(entities.name, name)).get();
      if (!row) throw new Error(`no entity named ${name}`);
      return row.id;
    }

    function descriptorsOf(name: string): string[] {
      return db
        .select({ d: entityDescriptors.descriptor })
        .from(entityDescriptors)
        .where(eq(entityDescriptors.entityId, idOf(name)))
        .all()
        .map((r) => r.d);
    }

    function contentTextOf(name: string): string | null {
      return rowOf(idOf(name)).contentText;
    }
  });

  /**
   * The kind *is* the Rights verb, so the kind determines the predicate — this is what deletes
   * `patch()`'s `changesVisibility ? writeFilter : editFilter` ternary, in which the caller chose
   * the rule that judged it.
   *
   * All four actors below can *read* the Entity; only the verb separates them.
   */
  describe('the kind picks the predicate', () => {
    const CARL = 'carl'; // A World Owner — curates the shared surface, owns no Entity.
    const EVE = 'eve'; //   An entity-level Viewer.
    const MALLORY = 'mallory'; // No standing at all.

    beforeEach(() => {
      seedUser(BOB);
      seedUser(CARL);
      seedUser(EVE);
      seedUser(MALLORY);
      seedGrant(ENTITY, BOB, 'editor');
      seedGrant(ENTITY, EVE, 'viewer');
      db.insert(worldMembers).values({ worldId: WORLD, userId: CARL, role: 'owner' }).run();
      // A World Owner's powers stop dead at `private`, so the Entity must be shared for
      // CARL to have any standing to test.
      db.update(entities).set({ visibility: 'shared' }).where(eq(entities.id, ENTITY)).run();
    });

    it.each([
      // An Editor edits substance and nothing else: no delete, no exposure, no sharing.
      ['an entity-level Editor', BOB, 'edit', 'ok'],
      ['an entity-level Editor', BOB, 'set-visibility', 'forbidden'],
      ['an entity-level Editor', BOB, 'delete', 'forbidden'],
      ['an entity-level Editor', BOB, 'manage', 'forbidden'],
      // A World Owner curates the shared surface — but grant management belongs to the
      // Entity's Owners alone, so `manage` stops here.
      ['a World Owner of a shared Entity', CARL, 'edit', 'ok'],
      ['a World Owner of a shared Entity', CARL, 'set-visibility', 'ok'],
      ['a World Owner of a shared Entity', CARL, 'delete', 'ok'],
      ['a World Owner of a shared Entity', CARL, 'manage', 'forbidden'],
      ['an entity-level Viewer', EVE, 'edit', 'forbidden'],
      ['an entity-level Viewer', EVE, 'set-visibility', 'forbidden'],
      ['an entity-level Viewer', EVE, 'manage', 'forbidden'],
      // Unreachable is indistinguishable from nonexistent — `private` never leaks existence,
      // and neither does a `shared` Entity in a World the caller is no member of.
      ['a stranger', MALLORY, 'edit', 'not-found'],
      ['a stranger', MALLORY, 'set-visibility', 'not-found'],
      ['a stranger', MALLORY, 'delete', 'not-found'],
      ['a stranger', MALLORY, 'manage', 'not-found'],
    ] as ReadonlyArray<readonly [string, string, EntityChange['kind'], MutateResult['status']]>)(
      '%s attempting %s → %s',
      (_who, actor, kind, expected) => {
        expect(writes.mutate(actor, ENTITY, changeOf(kind)).status).toBe(expected);
      },
    );

    /** A minimal change of each kind — the payload is irrelevant to the gate. */
    function changeOf(kind: EntityChange['kind']): EntityChange {
      switch (kind) {
        case 'edit':
          return { kind, name: 'Renamed' };
        case 'set-visibility':
          return { kind, visibility: 'private' };
        case 'manage':
          return { kind, acl: (w) => w.removeGrant(EVE) };
        case 'delete':
          return { kind };
      }
    }
  });

  /**
   * The outbox. Emitting inside the transaction would tell followers to refetch a version the
   * rollback then erased — and because their held `seq` never advanced, nothing later would
   * correct it. The follower would sit stale until it happened to reload.
   */
  describe('post-commit outbox', () => {
    it('buffers the nudge until the outermost transaction commits', () => {
      writes.transact(() => {
        writes.mutate(ADA, ENTITY, { kind: 'edit', name: 'A' });
        // The write is not durable yet, so no follower may be told to refetch it.
        expect(emitted).toEqual([]);
      });

      expect(emitted).toEqual([ENTITY]);
    });

    it('a rollback drops both the write and its buffered nudge', () => {
      expect(() =>
        writes.transact(() => {
          writes.mutate(ADA, ENTITY, { kind: 'edit', name: 'Doomed' });
          throw new Error('boom');
        }),
      ).toThrow('boom');

      expect(rowOf(ENTITY).name).toBe(ENTITY);
      expect(rowOf(ENTITY).seq).toBe(1);
      expect(emitted).toEqual([]);
    });

    it('a nested mutate joins the open transaction rather than flushing early', () => {
      writes.transact(() => {
        writes.mutate(ADA, ENTITY, { kind: 'edit', name: 'A' });
        writes.mutate(ADA, ENTITY, { kind: 'set-visibility', visibility: 'shared' });
        expect(emitted).toEqual([]);
      });

      // One commit, one flush — and one nudge, not one per change: the outbox deduplicates by id,
      // because a follower learns nothing from a second byte-identical `{ id, seq }` frame. The
      // `seq` it refetches under is the last one, so both changes ride the single nudge.
      expect(emitted).toEqual([ENTITY]);
      expect(rowOf(ENTITY).seq).toBe(3);
    });
  });

  /**
   * The optimistic-concurrency check. A rejected save must leave *nothing* behind: not the row,
   * not the `seq`, and above all not a nudge — a follower told to refetch a version that was never
   * written would advance its held `seq` past reality and then ignore the real change.
   */
  it('a stale base version conflicts: no write, no seq bump, no nudge', () => {
    writes.mutate(ADA, ENTITY, { kind: 'edit', version: 1, name: 'First' }); // version 1 → 2
    emitted.length = 0;
    const afterFirst = rowOf(ENTITY);

    const result = writes.mutate(ADA, ENTITY, { kind: 'edit', version: 1, name: 'Stale' });

    expect(result.status).toBe('conflict');
    const now = rowOf(ENTITY);
    expect(now.name).toBe('First');
    expect(now.version).toBe(afterFirst.version);
    expect(now.seq).toBe(afterFirst.seq);
    expect(emitted).toEqual([]);
  });

  /**
   * System writes take no `userId` and are structurally distinct from user writes: there is no
   * caller whose Rights could gate them.
   */
  describe('system writes', () => {
    it('cascadeDeleteWorld evicts every Entity in the World, and only that World', () => {
      const OTHER = 'world-2';
      seedWorld(OTHER, ADA);
      seedEntity('e-a', WORLD, ADA);
      seedEntity('e-b', WORLD, ADA);
      seedEntity('e-elsewhere', OTHER, ADA);

      writes.cascadeDeleteWorld(WORLD);

      // ADR-0044 deferred this: a cascaded Entity's own followers were left on a ghost row.
      expect([...emitted].sort()).toEqual(['e-a', 'e-b', ENTITY]);
      expect(idsIn(WORLD)).toEqual([]);
      expect(idsIn(OTHER)).toEqual(['e-elsewhere']);
    });

    /**
     * A deleted user's grants go, but nobody is told: their own sessions are dropped, so they
     * self-evict, and no *other* principal's Rights on those Entities changed. `seq` still bumps —
     * it is the record that the Entity's sharing state moved, and a later nudge must read as newer.
     */
    it('purgeGrantsOf revokes the user’s grants and bumps seq, but emits nothing', () => {
      seedUser(BOB);
      seedGrant(ENTITY, BOB, 'viewer');

      writes.purgeGrantsOf(BOB);

      expect(granteesOf(ENTITY)).toEqual([ADA]);
      expect(rowOf(ENTITY).seq).toBe(2);
      expect(emitted).toEqual([]);
    });

    /**
     * The World-membership fan-out. Rights on a `shared` Entity derive from the World's membership
     * set (`canRead` = `… ∨ (shared ∧ member)`, `canWrite` = `… ∨ (shared ∧ world-owner)`), so a
     * membership change moves them — and the follower must be told. The `seq` bump is the
     * load-bearing half: nudging without it would leave the follower's freshness gate dropping the
     * frame and its `rights` array stale, which is the half-fix ADR-0045 rejects.
     */
    it('bumpWorldShared bumps and nudges the World’s shared Entities, and only those', () => {
      const OTHER = 'world-2';
      seedWorld(OTHER, ADA);
      seedEntity('shared-a', WORLD, ADA, 'shared');
      seedEntity('shared-b', WORLD, ADA, 'shared');
      seedEntity('private-here', WORLD, ADA); // private: membership confers nothing on it
      seedEntity('shared-elsewhere', OTHER, ADA, 'shared');

      writes.bumpWorldShared(WORLD);

      expect([...emitted].sort()).toEqual(['shared-a', 'shared-b']);
      expect(rowOf('shared-a').seq).toBe(2);
      expect(rowOf('shared-b').seq).toBe(2);
      // A `private` Entity's Rights don't derive from World membership, so nothing moved.
      expect(rowOf('private-here').seq).toBe(1);
      expect(rowOf('shared-elsewhere').seq).toBe(1);
    });

    /** No shared Entities: no UPDATE, no nudge — the common case on a private-only World. */
    it('bumpWorldShared is a no-op when the World shares nothing', () => {
      writes.bumpWorldShared(WORLD);

      expect(emitted).toEqual([]);
      expect(rowOf(ENTITY).seq).toBe(1);
    });

    function idsIn(worldId: string): string[] {
      return db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.worldId, worldId))
        .all()
        .map((r) => r.id)
        .sort();
    }

    function granteesOf(entityId: string): string[] {
      return db
        .select({ userId: entityGrants.userId })
        .from(entityGrants)
        .where(eq(entityGrants.entityId, entityId))
        .all()
        .map((r) => r.userId);
    }
  });

  function rowOf(id: string) {
    const row = db.select().from(entities).where(eq(entities.id, id)).get();
    if (!row) throw new Error(`no entity ${id}`);
    return row;
  }

  function seedUser(id: string): void {
    db.insert(users)
      .values({
        id,
        email: `${id}@hexly.test`,
        displayName: id,
        passwordHash: 'not-a-real-hash',
        createdAt: Date.now(),
      })
      .run();
  }

  function seedWorld(id: string, ownerId: string): void {
    const now = Date.now();
    db.insert(worlds).values({ id, name: id, createdAt: now, updatedAt: now }).run();
    db.insert(worldMembers).values({ worldId: id, userId: ownerId, role: 'owner' }).run();
  }

  /** Seeded raw, so `mutate`'s behaviour is observed independently of `insert`'s. */
  function seedEntity(
    id: string,
    worldId: string,
    ownerId: string,
    visibility: 'private' | 'shared' = 'private',
  ): void {
    const now = Date.now();
    db.insert(entities)
      .values({
        id,
        worldId,
        name: id,
        type: 'note',
        tags: [],
        visibility,
        version: 1,
        seq: 1,
        document: JSON.stringify(emptyEntityBody('note')),
        contentText: '',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(entityGrants).values({ entityId: id, userId: ownerId, role: 'owner' }).run();
  }

  function seedGrant(entityId: string, userId: string, role: 'editor' | 'viewer'): void {
    db.insert(entityGrants).values({ entityId, userId, role }).run();
  }
});
