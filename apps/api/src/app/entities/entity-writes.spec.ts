import { EntityDocument, ReindexFailure, emptyEntityDocument } from '@hexly/domain';
import { emptyContent, tiptapContent } from '@hexly/plugin-content';
import { eq } from 'drizzle-orm';
import { createDb, Db } from '../db/db';
import {
  entities,
  entityDescriptors,
  entityEdges,
  entityFieldFacets,
  entityGrants,
  users,
  worldMembers,
  worlds,
} from '../db/schema';
import { NudgeBus } from '../events/nudge-bus';
import { WriteOutbox } from '../events/write-outbox';
import { loadConfig } from '../config';
import { BUNDLED_PLUGIN_CONFIGS } from './bundled-plugins';
import { EntityChange, EntityWrites, MutateResult } from './entity-writes';
import { TypeFieldRegistry } from './type-field-registry';
import { WorldTypeFields } from './world-type-fields';

/**
 * `EntityWrites` is the single write handle for `entities` and `entity_grants` (ADR-0045).
 * Real in-memory SQLite, real ACL; only the bus is a recorder.
 */
describe('EntityWrites', () => {
  const ADA = 'ada';
  const BOB = 'bob';
  const WORLD = 'world-1';
  const ENTITY = 'entity-1';

  let db: Db;
  let emitted: string[];
  let writes: EntityWrites;
  let typeFields: TypeFieldRegistry;

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
    // Every bundled Plugin enabled (the default), so the derive pass sees the full data-type set.
    typeFields = new TypeFieldRegistry(loadConfig(':memory:', BUNDLED_PLUGIN_CONFIGS));
    // The world-scoped resolver over the same registry — no World-defined types are seeded here, so
    // it resolves through to the plugin registry (#191).
    writes = new EntityWrites(db, new WriteOutbox(db, bus), new WorldTypeFields(db, typeFields), typeFields);

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
   * `version` is the concurrency token in `edit`'s atomic WHERE — bumping it on a sharing change
   * would 409 an in-flight save. `updatedAt` is user-visible ("edited {date}",
   * `ORDER BY updatedAt DESC`), so sharing must not reorder "Recently edited".
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

    writes.mutate(ADA, ENTITY, {
      kind: 'edit',
      version: before.version,
      name: 'Again',
    });

    expect(rowOf(ENTITY).version).toBe(before.version + 1);
  });

  describe('derived indexes', () => {
    /** A grid carrying every named thing it can: one Hex, one Region, one Label. */
    const GRID = {
      hexes: { '0,0': { terrain: 'grass', name: 'Ashford' } },
      regions: [{ id: 'r1', name: 'The Kingdom of Avalon', color: '#aabbcc', hexes: {} }],
      labels: [{ id: 'l1', text: 'The Whisperwood', position: { x: 0, y: 0 }, size: 12 }],
    };

    const CONTENT = tiptapContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Married to ' },
            {
              type: 'entityLink',
              attrs: { entityId: 'e2', descriptor: 'spouse' },
            },
          ],
        },
      ],
    });

    it('an inserted Entity harvests its Link Descriptors, not just its search text', () => {
      writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Ealdred',
        types: ['core.note'],
        tags: [],
        document: { content: CONTENT },
      });

      expect(descriptorsOf('Ealdred')).toEqual(['spouse']);
      expect(contentTextOf('Ealdred')).toBe('Married to');
    });

    /** The search text is the whole document's, not the Content's (#205): the grid contributes too. */
    it('an inserted Hex Map indexes its grid’s Hex and Region names beside its prose', () => {
      writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'The Reach',
        types: ['core.hexmap'],
        tags: [],
        document: { content: CONTENT, grid: GRID },
      });

      expect(contentTextOf('The Reach')).toBe('Married to Ashford The Kingdom of Avalon The Whisperwood');
    });

    /**
     * The edge index (ADR-0046). `worldId` is denormalized off the source so the World Graph's
     * edge fetch is one indexed lookup; the target is unconstrained — dangling is valid, and `e2`
     * here does not exist.
     */
    it('an inserted Entity stores the edges its document expresses', () => {
      writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Ealdred',
        types: ['core.note'],
        tags: [],
        document: { content: CONTENT },
      });

      expect(edgesOf('Ealdred')).toEqual([
        {
          worldId: WORLD,
          targetKind: 'entity',
          targetId: 'e2',
          descriptor: 'spouse',
        },
      ]);
    });

    /**
     * The edge keeps the descriptor as the author typed it; the `::` vocabulary folds case, as
     * Tags do.
     */
    it('stores the authored descriptor on the edge, and its folded form in the vocabulary', () => {
      writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Aldermoor',
        types: ['core.note'],
        tags: [],
        document: {
          content: tiptapContent({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'entityLink',
                    attrs: { entityId: 'e2', descriptor: 'Capital Of' },
                  },
                ],
              },
            ],
          }),
        },
      });

      expect(edgesOf('Aldermoor')).toEqual([
        {
          worldId: WORLD,
          targetKind: 'entity',
          targetId: 'e2',
          descriptor: 'Capital Of',
        },
      ]);
      expect(descriptorsOf('Aldermoor')).toEqual(['capital of']);
    });

    it('an edit replaces the descriptor set, so it prunes itself', () => {
      const row = writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Ealdred',
        types: ['core.note'],
        tags: [],
        document: { content: CONTENT },
      });

      writes.mutate(ADA, row.id, {
        kind: 'edit',
        version: row.version,
        document: { content: emptyContent() },
      });

      expect(descriptorsOf('Ealdred')).toEqual([]);
    });

    /** Wholesale replace, no diffing — mirroring `replaceDescriptors`. Unlinking prunes the edge. */
    it('an edit replaces the edge set, so unlinking prunes the edge', () => {
      const row = writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Ealdred',
        types: ['core.note'],
        tags: [],
        document: { content: CONTENT },
      });

      writes.mutate(ADA, row.id, {
        kind: 'edit',
        version: row.version,
        document: { content: emptyContent() },
      });

      expect(edgesOf('Ealdred')).toEqual([]);
    });

    /**
     * A rejected save must leave the derived indexes untouched: they are a cache of the last
     * *committed* document, and a stale-version write never became one.
     */
    it('a conflicted edit leaves the edge set as the last successful save left it', () => {
      const row = writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Ealdred',
        types: ['core.note'],
        tags: [],
        document: { content: CONTENT },
      });
      writes.mutate(ADA, row.id, {
        kind: 'edit',
        version: row.version,
        name: 'Bumped',
      });

      const result = writes.mutate(ADA, row.id, {
        kind: 'edit',
        version: row.version, // stale
        document: { content: emptyContent() },
      });

      expect(result.status).toBe('conflict');
      expect(edgesOf('Bumped')).toEqual([
        {
          worldId: WORLD,
          targetKind: 'entity',
          targetId: 'e2',
          descriptor: 'spouse',
        },
      ]);
    });

    /**
     * The Superadmin Reindex (ADR-0046, #180). The derived tables are a cache of the document:
     * always discardable and recomputable, so no backfill migration is involved.
     */
    describe('reindexChunk', () => {
      /** Drives the pages to exhaustion, as the reindex `AdminService`'s job loop does. */
      function reindexAll(limit = 100) {
        let cursor: string | null = null;
        const walk = {
          walked: 0,
          reindexed: 0,
          failures: [] as ReindexFailure[],
          chunks: 0,
        };
        for (;;) {
          const chunk = writes.reindexChunk(cursor, limit);
          walk.walked += chunk.walked;
          walk.reindexed += chunk.reindexed;
          walk.failures.push(...chunk.failures);
          walk.chunks++;
          if (chunk.cursor === null) return walk;
          cursor = chunk.cursor;
        }
      }

      it('rebuilds an unindexed Entity’s edges, descriptors, and search text from its document', () => {
        seedUnindexed('ealdred', WORLD, { content: CONTENT });

        reindexAll();

        expect(edgesFrom('ealdred')).toEqual([
          {
            worldId: WORLD,
            targetKind: 'entity',
            targetId: 'e2',
            descriptor: 'spouse',
          },
        ]);
        expect(descriptorsOf('ealdred')).toEqual(['spouse']);
        expect(rowOf('ealdred').contentText).toBe('Married to');
      });

      /**
       * A **Structured Field**'s text is derived state like any other (#205): a Hex Map saved before
       * the grid declared an `extractText`, its `content_text` holding the prose alone, is findable
       * by its Hex names after a reindex — no backfill migration.
       */
      it('recomputes a Structured Field’s searchable text from the stored document', () => {
        seedRaw(
          'the-reach',
          WORLD,
          JSON.stringify({ content: CONTENT, grid: GRID }),
          'hexmap',
          'Married to', // What the old, Content-only derivation left behind.
        );

        reindexAll();

        expect(rowOf('the-reach').contentText).toBe('Married to Ashford The Kingdom of Avalon The Whisperwood');
      });

      /**
       * The one write here that lands without a nudge *and* without a `seq` bump: recomputing from
       * an unchanged document writes back what it read. Only just after a deploy adds a derivation
       * does it yield new state, and that stale window closes on the reader's next navigation.
       */
      it('rewrites the indexes silently: no seq bump, no nudge', () => {
        seedUnindexed('ealdred', WORLD, { content: CONTENT });

        reindexAll();

        expect(emitted).toEqual([]);
        expect(rowOf('ealdred').seq).toBe(1);
        expect(rowOf(ENTITY).seq).toBe(1);
      });

      /** Safe to re-run: the document is authoritative and the write is a wholesale replace. */
      it('is idempotent: a second run leaves the same rows and reports the same count', () => {
        seedUnindexed('ealdred', WORLD, { content: CONTENT });

        const first = reindexAll();
        const afterFirst = {
          edges: edgesFrom('ealdred'),
          descriptors: descriptorsOf('ealdred'),
        };
        const second = reindexAll();

        expect(second.walked).toBe(first.walked);
        expect(second.reindexed).toBe(first.reindexed);
        expect(edgesFrom('ealdred')).toEqual(afterFirst.edges);
        expect(descriptorsOf('ealdred')).toEqual(afterFirst.descriptors);
      });

      /**
       * The walk is instance-wide: no World scoping, no membership filter. `WORLD`'s own seeded
       * `ENTITY` is walked too, hence three.
       */
      it('walks every Entity in every World, and counts them', () => {
        const OTHER = 'world-2';
        seedUser(BOB);
        seedWorld(OTHER, BOB); // A World the reindex has no membership in, and reaches anyway.
        seedUnindexed('ealdred', WORLD, { content: CONTENT });
        seedUnindexed('elsewhere', OTHER, { content: CONTENT });

        expect(reindexAll()).toMatchObject({
          walked: 3,
          reindexed: 3,
          failures: [],
        });

        expect(edgesFrom('elsewhere')).toEqual([
          {
            worldId: OTHER,
            targetKind: 'entity',
            targetId: 'e2',
            descriptor: 'spouse',
          },
        ]);
      });

      /**
       * Paged so the event loop can breathe between transactions: one synchronous instance-wide
       * transaction would serve no other request while it ran.
       */
      it('pages through the instance, reaching every Entity exactly once', () => {
        seedUnindexed('ealdred', WORLD, { content: CONTENT });
        seedUnindexed('elsewhere', WORLD, { content: CONTENT });

        // 3 Entities at a page apiece, plus the empty page that settles the exhausted cursor.
        expect(reindexAll(1)).toMatchObject({
          walked: 3,
          reindexed: 3,
          chunks: 4,
        });
        expect(descriptorsOf('ealdred')).toEqual(['spouse']);
        expect(descriptorsOf('elsewhere')).toEqual(['spouse']);
      });

      /** A short page is the last page — the walk ends without asking for one more. */
      it('ends on a short page without an extra round trip', () => {
        expect(writes.reindexChunk(null, 100)).toMatchObject({
          walked: 1,
          cursor: null,
        });
      });

      /** Nothing derived, nothing written — and the walk still advances past the page. */
      it('walks on when a whole page is unreadable', () => {
        db.delete(entities).run(); // Only the corrupt row remains.
        seedCorrupt('broken', WORLD);

        expect(writes.reindexChunk(null, 100)).toMatchObject({
          walked: 1,
          reindexed: 0,
        });
      });

      /**
       * A document this build cannot parse is skipped and named, never allowed to roll back the
       * Entities around it: one corrupt row must not deny every other Entity its derivation.
       */
      it('skips a document it cannot parse, reports it, and reindexes the rest', () => {
        seedUnindexed('ealdred', WORLD, { content: CONTENT });
        seedCorrupt('broken', WORLD);

        const walk = reindexAll();

        expect(walk).toMatchObject({ walked: 3, reindexed: 2 });
        expect(walk.failures).toEqual([
          {
            entityId: 'broken',
            worldId: WORLD,
            reason: expect.stringContaining('JSON'),
          },
        ]);
        // Its neighbours in the very same chunk are indexed regardless.
        expect(descriptorsOf('ealdred')).toEqual(['spouse']);
        expect(rowOf('ealdred').contentText).toBe('Married to');
      });

      /**
       * A document with no derived rows at all. Seeded raw, so the walk is observed independently
       * of `insert`, which would have derived them on the way in.
       */
      function seedUnindexed(id: string, worldId: string, doc: EntityDocument): void {
        seedRaw(id, worldId, JSON.stringify(doc), 'note');
      }

      /** An Entity whose stored document this build cannot read at all. */
      function seedCorrupt(id: string, worldId: string): void {
        seedRaw(id, worldId, '{ not json', 'note');
      }

      function seedRaw(
        id: string,
        worldId: string,
        document: string,
        type: string,
        contentText: string | null = null,
      ): void {
        const now = Date.now();
        db.insert(entities)
          .values({
            id,
            worldId,
            name: id,
            types: ['core.' + type],
            tags: [],
            visibility: 'private',
            version: 1,
            seq: 1,
            document,
            contentText,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        db.insert(entityGrants).values({ entityId: id, userId: ADA, role: 'owner' }).run();
      }
    });

    /**
     * A typed Entity-Link Field (#190) feeds both derived indexes: its value materialises an edge
     * and, when facetable, a Field-facet row keyed by the *target id*.
     */
    describe('Entity-Link Field edges + facets (#190)', () => {
      beforeEach(() => {
        typeFields.register('test.monster', [
          { key: 'lair', label: 'Lair', dataType: { kind: 'entityLink' }, facetable: true },
        ]);
      });

      it('materialises an edge and a target-id facet from an Entity-Link Field value', () => {
        writes.insert({
          ownerId: ADA,
          worldId: WORLD,
          name: 'Aboleth',
          types: ['test.monster'],
          tags: [],
          document: { content: emptyContent(), lair: { entityId: 'whisperwood', label: 'The Whisperwood' } },
        });

        expect(edgesOf('Aboleth')).toEqual([
          { worldId: WORLD, targetKind: 'entity', targetId: 'whisperwood', descriptor: null },
        ]);
        expect(facetsOf('Aboleth')).toEqual([{ key: 'lair', value: 'whisperwood', num: null }]);
      });

      it('re-pointing the link replaces both the edge and the facet (self-pruning)', () => {
        const row = writes.insert({
          ownerId: ADA,
          worldId: WORLD,
          name: 'Aboleth',
          types: ['test.monster'],
          tags: [],
          document: { content: emptyContent(), lair: { entityId: 'whisperwood', label: 'The Whisperwood' } },
        });

        writes.mutate(ADA, row.id, {
          kind: 'edit',
          version: row.version,
          types: ['test.monster'],
          document: { content: emptyContent(), lair: { entityId: 'sunken-keep', label: 'Sunken Keep' } },
        });

        expect(edgesOf('Aboleth')).toEqual([
          { worldId: WORLD, targetKind: 'entity', targetId: 'sunken-keep', descriptor: null },
        ]);
        expect(facetsOf('Aboleth')).toEqual([{ key: 'lair', value: 'sunken-keep', num: null }]);
      });

      function facetsOf(name: string) {
        return db
          .select({ key: entityFieldFacets.key, value: entityFieldFacets.value, num: entityFieldFacets.num })
          .from(entityFieldFacets)
          .where(eq(entityFieldFacets.entityId, idOf(name)))
          .all();
      }
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

    /**
     * `sourceEntityId` FKs `entities.id` with ON DELETE CASCADE, so an Entity's outbound edges die
     * with it. Its *inbound* rows do not: they are keyed by their own source, which still holds the
     * link. The read drops them (the target no longer resolves) and the source's next save rewrites
     * them (ADR-0046).
     */
    it('deleting the source cascades its outbound edges, and leaves inbound rows to it standing', () => {
      const ealdred = writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Ealdred',
        types: ['core.note'],
        tags: [],
        document: { content: CONTENT }, // Ealdred → e2
      });
      const mira = writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'Mira',
        types: ['core.note'],
        tags: [],
        document: { content: linkTo(ealdred.id) }, // Mira → Ealdred
      });

      writes.mutate(ADA, ealdred.id, { kind: 'delete' });

      expect(edgesFrom(ealdred.id)).toEqual([]);
      expect(edgesFrom(mira.id)).toEqual([
        {
          worldId: WORLD,
          targetKind: 'entity',
          targetId: ealdred.id,
          descriptor: null,
        },
      ]);
    });

    /**
     * SQLite binds at most 32766 parameters per statement, and an edge row binds five. A single
     * `VALUES` list therefore hard-fails past 6553 edges with "too many SQL variables", rolling
     * back the save and leaving the document unsavable — so the insert chunks.
     */
    it('stores an edge set far larger than SQLite’s bound-parameter limit', () => {
      const hexes = Object.fromEntries(
        Array.from({ length: 7000 }, (_, i) => [`${i},0`, { terrain: 'grass' as const, entityId: `target-${i}` }]),
      );

      const row = writes.insert({
        ownerId: ADA,
        worldId: WORLD,
        name: 'The Reach',
        types: ['core.hexmap'],
        tags: [],
        document: { content: emptyContent(), grid: { hexes, regions: [], labels: [] } },
      });

      expect(edgesFrom(row.id)).toHaveLength(7000);
    });

    /** Content holding one bare `entityLink` at `targetId`. */
    function linkTo(targetId: string) {
      return tiptapContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'entityLink', attrs: { entityId: targetId } }],
          },
        ],
      });
    }

    function edgesOf(name: string) {
      return edgesFrom(idOf(name));
    }

    function edgesFrom(sourceEntityId: string) {
      return db
        .select({
          worldId: entityEdges.worldId,
          targetKind: entityEdges.targetKind,
          targetId: entityEdges.targetId,
          descriptor: entityEdges.descriptor,
        })
        .from(entityEdges)
        .where(eq(entityEdges.sourceEntityId, sourceEntityId))
        .all();
    }
  });

  /**
   * The kind *is* the Rights verb, so the kind determines the predicate. All four actors below
   * can *read* the Entity; only the verb separates them.
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
        writes.mutate(ADA, ENTITY, {
          kind: 'set-visibility',
          visibility: 'shared',
        });
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

    const result = writes.mutate(ADA, ENTITY, {
      kind: 'edit',
      version: 1,
      name: 'Stale',
    });

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
     * Rights on a `shared` Entity derive from the World's membership set (`canRead` =
     * `… ∨ (shared ∧ member)`, `canWrite` = `… ∨ (shared ∧ world-owner)`), so a membership change
     * moves them and the follower must be told. The `seq` bump is required: nudging without it
     * leaves the follower's freshness gate dropping the frame and its `rights` array stale.
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
        types: ['core.note'],
        tags: [],
        visibility,
        version: 1,
        seq: 1,
        document: JSON.stringify(emptyEntityDocument()),
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
