import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorldVerb } from '@hexly/domain';
import { createDb, Db } from '../db/db';
import { containers, entities, entityGrants, users, worldMembers, worlds, WORLD_CONTAINER_KIND } from '../db/schema';
import { canCreateEntityFilter, worldAccess, worldOwnerFilter } from './world-access';

/**
 * The World authorization rule (ADR-0024, ADR-0037, ADR-0039) — the role × superadmin → verbs
 * matrix, driven against a seeded SQLite with no Nest and no HTTP.
 */
describe('worldAccess', () => {
  let db: Db;
  let worldId: string;
  // Standings under test.
  let owner: string;
  let contributor: string;
  let viewer: string;
  let stranger: string; // no membership, no entity grant
  let superadmin: string;

  beforeEach(() => {
    db = createDb(':memory:');
    worldId = seedWorld();
    owner = seedUser();
    contributor = seedUser();
    viewer = seedUser();
    stranger = seedUser();
    superadmin = seedUser({ superadmin: true });

    db.insert(worldMembers)
      .values([
        { worldId, userId: owner, role: 'owner' },
        { worldId, userId: contributor, role: 'contributor' },
        { worldId, userId: viewer, role: 'viewer' },
      ])
      .run();
  });

  /** The caller's Rights on `id` — the decision the read paths compute, projected to verbs. */
  function verbs(userId: string, id: string): WorldVerb[] {
    const access = worldAccess(db, userId);
    const world = access.decide(id);
    return world
      ? access.rightsOf({ isOwner: access.managedBy(ownersOf(id)), canContribute: access.contributingIn([id]).has(id) })
      : [];
  }

  describe('rightsOf ∘ decide', () => {
    it('gives an Owner read + create-entity + manage', () => {
      expect(verbs(owner, worldId)).toEqual(['read', 'create-entity', 'manage']);
    });

    it('gives a Contributor read + create-entity, but no manage', () => {
      expect(verbs(contributor, worldId)).toEqual(['read', 'create-entity']);
    });

    it('gives a Viewer read only', () => {
      expect(verbs(viewer, worldId)).toEqual(['read']);
    });

    it('gives a stranger nothing — unreachable ≡ missing', () => {
      expect(verbs(stranger, worldId)).toEqual([]);
    });

    it('gives a Superadmin read + create-entity + manage (repair bypass, outside the model)', () => {
      expect(verbs(superadmin, worldId)).toEqual(['read', 'create-entity', 'manage']);
    });
  });

  it('returns undefined from decide for a non-existent World', () => {
    expect(worldAccess(db, owner).decide(randomUUID())).toBeUndefined();
  });

  describe('decideMeta (single-query reachability + ownership)', () => {
    it('agrees with the manage and contribute rules for every standing', () => {
      expect(worldAccess(db, owner).decideMeta(worldId)).toEqual({
        reachable: true,
        isOwner: true,
        canContribute: true,
      });
      // A Contributor reaches and may contribute (author Entities/Assets) but does not own.
      expect(worldAccess(db, contributor).decideMeta(worldId)).toEqual({
        reachable: true,
        isOwner: false,
        canContribute: true,
      });
      // A Viewer reaches but neither owns nor contributes.
      expect(worldAccess(db, viewer).decideMeta(worldId)).toEqual({
        reachable: true,
        isOwner: false,
        canContribute: false,
      });
      // A World that exists but is unreachable: reachable false, not undefined (undefined ≡ no row).
      expect(worldAccess(db, stranger).decideMeta(worldId)).toEqual({
        reachable: false,
        isOwner: false,
        canContribute: false,
      });
      expect(worldAccess(db, superadmin).decideMeta(worldId)).toEqual({
        reachable: true,
        isOwner: true,
        canContribute: true,
      });
    });

    it('returns undefined for a non-existent World', () => {
      expect(worldAccess(db, owner).decideMeta(randomUUID())).toBeUndefined();
    });

    // The ex-member residue (ADR-0037): a non-member who still owns an Entity inside the World
    // stays reachable (403 on management, not 404). Regression guard — the reachability predicate
    // rides a SELECT projection in decideMeta, where a naive `worlds.id` correlation would break
    // the entity-grant branch and wrongly report unreachable.
    it('reaches a non-member who still owns an Entity in the World', () => {
      const exMember = seedUser();
      const entityId = randomUUID();
      db.insert(entities)
        .values({
          id: entityId,
          containerId: worldId,
          name: 'Relic',
          types: ['core.type.note'],
          tags: [],
          visibility: 'private',
          version: 1,
          document: '{}',
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      db.insert(entityGrants).values({ entityId, userId: exMember, role: 'owner' }).run();
      // Reachable residue, but no member role — so neither owns nor contributes to the World.
      expect(worldAccess(db, exMember).decideMeta(worldId)).toEqual({
        reachable: true,
        isOwner: false,
        canContribute: false,
      });
    });
  });

  describe('managedBy (set form over an already-loaded owner set)', () => {
    it('matches decideMeta.isOwner without a query', () => {
      const owners = ownersOf(worldId);
      expect(worldAccess(db, owner).managedBy(owners)).toBe(true);
      expect(worldAccess(db, contributor).managedBy(owners)).toBe(false);
      // Superadmin manages regardless of set membership.
      expect(worldAccess(db, superadmin).managedBy(owners)).toBe(true);
      expect(worldAccess(db, superadmin).managedBy([])).toBe(true);
    });
  });

  describe('contributingIn (the `create-entity` Right, resolved for a page in one read)', () => {
    const contributes = (userId: string, ids: string[] = [worldId]) => [...worldAccess(db, userId).contributingIn(ids)];

    it('agrees with the owner ∨ contributor rule for every standing', () => {
      expect(contributes(owner)).toEqual([worldId]);
      expect(contributes(contributor)).toEqual([worldId]);
      expect(contributes(viewer)).toEqual([]);
      expect(contributes(stranger)).toEqual([]);
      expect(contributes(superadmin)).toEqual([worldId]);
    });

    // An Editor granted rights on one Entity reaches its World but is no Contributor in it — the
    // standing the Create rows hang on (ADR-0073).
    it('excludes a reachable-by-entity-grant caller with no member row', () => {
      const editor = seedUser();
      const entityId = randomUUID();
      db.insert(entities)
        .values({
          id: entityId,
          containerId: worldId,
          name: 'Relic',
          types: ['core.type.note'],
          tags: [],
          visibility: 'private',
          version: 1,
          document: '{}',
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      db.insert(entityGrants).values({ entityId, userId: editor, role: 'editor' }).run();

      expect(worldAccess(db, editor).decide(worldId)).toBeDefined();
      expect(contributes(editor)).toEqual([]);
    });

    it('answers a whole page in one read, and an empty page without one', () => {
      const second = seedWorld();
      db.insert(worldMembers).values({ worldId: second, userId: viewer, role: 'contributor' }).run();

      expect(contributes(viewer, [worldId, second])).toEqual([second]);
      expect(contributes(owner, [])).toEqual([]);
      // The Superadmin bypass answers without touching the membership table at all.
      expect(contributes(superadmin, [worldId, second]).sort()).toEqual([worldId, second].sort());
    });
  });

  describe('canCreateEntityFilter (owner ∨ contributor)', () => {
    const creatable = (userId: string, superadminFlag: boolean) =>
      db
        .select({ id: worlds.id })
        .from(worlds)
        .where(canCreateEntityFilter(userId, superadminFlag))
        .all()
        .map((r) => r.id);

    it('lets an Owner create', () => expect(creatable(owner, false)).toEqual([worldId]));
    it('lets a Contributor create', () => expect(creatable(contributor, false)).toEqual([worldId]));
    it('refuses a Viewer', () => expect(creatable(viewer, false)).toEqual([]));
    it('refuses a stranger', () => expect(creatable(stranger, false)).toEqual([]));
    it('lets a Superadmin create anywhere (repair)', () => expect(creatable(stranger, true)).toEqual([worldId]));
  });

  describe('worldOwnerFilter (owner only, no Superadmin bypass)', () => {
    const owned = (userId: string) =>
      db
        .select({ id: worlds.id })
        .from(worlds)
        .where(worldOwnerFilter(userId))
        .all()
        .map((r) => r.id);

    it('matches an Owner', () => expect(owned(owner)).toEqual([worldId]));
    it('excludes a Contributor', () => expect(owned(contributor)).toEqual([]));
    it('excludes a Viewer', () => expect(owned(viewer)).toEqual([]));
    it('excludes a stranger', () => expect(owned(stranger)).toEqual([]));
    // The load-bearing property: no match-all. Used for the un-scoped create default, a Superadmin
    // who owns nothing must NOT default into the globally-oldest World.
    it('excludes a Superadmin who holds no owner row', () => expect(owned(superadmin)).toEqual([]));
  });

  describe('reachFilter (read-scoped list predicate)', () => {
    it('reaches for every member, not for a stranger', () => {
      const reaches = (userId: string) =>
        db
          .select({ id: worlds.id })
          .from(worlds)
          .where(worldAccess(db, userId).reachFilter)
          .all()
          .map((r) => r.id);
      expect(reaches(owner)).toEqual([worldId]);
      expect(reaches(contributor)).toEqual([worldId]);
      expect(reaches(viewer)).toEqual([worldId]);
      expect(reaches(stranger)).toEqual([]);
      expect(reaches(superadmin)).toEqual([worldId]); // match-all
    });
  });

  // ── seed helpers ──────────────────────────────────────────────────────────
  function seedWorld(): string {
    const id = randomUUID();
    db.insert(containers)
      .values({ id, kind: WORLD_CONTAINER_KIND, name: 'Aldermoor', createdAt: 1, updatedAt: 1 })
      .run();
    db.insert(worlds).values({ id }).run();
    return id;
  }

  function seedUser(opts: { superadmin?: boolean } = {}): string {
    const id = randomUUID();
    db.insert(users)
      .values({
        id,
        email: `${id}@hexly.test`,
        displayName: 'Test',
        passwordHash: 'x',
        isSuperadmin: opts.superadmin ?? false,
        createdAt: 1,
      })
      .run();
    return id;
  }

  function ownersOf(id: string): string[] {
    return db
      .select({ userId: worldMembers.userId })
      .from(worldMembers)
      .where(and(eq(worldMembers.worldId, id), eq(worldMembers.role, 'owner')))
      .all()
      .map((r) => r.userId);
  }
});
