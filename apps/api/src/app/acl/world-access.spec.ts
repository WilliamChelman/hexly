import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorldVerb } from '@hexly/domain';
import { createDb, Db } from '../db/db';
import {
  containerMounts,
  containers,
  entities,
  entityGrants,
  users,
  worldMembers,
  worlds,
  WORLD_CONTAINER_KIND,
} from '../db/schema';
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
        isMember: true,
        isOwner: true,
        canContribute: true,
      });
      // A Contributor reaches and may contribute (author Entities/Assets) but does not own.
      expect(worldAccess(db, contributor).decideMeta(worldId)).toEqual({
        reachable: true,
        isMember: true,
        isOwner: false,
        canContribute: true,
      });
      // A Viewer reaches but neither owns nor contributes.
      expect(worldAccess(db, viewer).decideMeta(worldId)).toEqual({
        reachable: true,
        isMember: true,
        isOwner: false,
        canContribute: false,
      });
      // A World that exists but is unreachable: reachable false, not undefined (undefined ≡ no row).
      expect(worldAccess(db, stranger).decideMeta(worldId)).toEqual({
        reachable: false,
        isMember: false,
        isOwner: false,
        canContribute: false,
      });
      expect(worldAccess(db, superadmin).decideMeta(worldId)).toEqual({
        reachable: true,
        isMember: true,
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
      // Reachable residue, but no member row — so neither owns nor contributes to the World, and the
      // membership-facing reads (its roster, its Mounts) are closed to them.
      expect(worldAccess(db, exMember).decideMeta(worldId)).toEqual({
        reachable: true,
        isMember: false,
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

  describe('reachFilter (read-scoped predicate)', () => {
    it('reaches for every member, not for a stranger', () => {
      expect(reaches(owner)).toEqual([worldId]);
      expect(reaches(contributor)).toEqual([worldId]);
      expect(reaches(viewer)).toEqual([worldId]);
      expect(reaches(stranger)).toEqual([]);
      expect(reaches(superadmin)).toEqual([worldId]); // match-all
    });
  });

  describe('listFilter (the World Index predicate) beside reachFilter', () => {
    /** The Owner's own shelf, mounted into the World the others are members of. */
    function mountShelf(): string {
      const shelf = seedWorld();
      db.insert(worldMembers).values({ worldId: shelf, userId: owner, role: 'owner' }).run();
      db.insert(containerMounts).values({ containerId: worldId, mountedContainerId: shelf, position: 0 }).run();
      return shelf;
    }

    it('leaves a mounted World readable and unlisted (ADR-0080)', () => {
      const shelf = mountShelf();
      // A Mount widens what a World may point at, never what its readers appear to have: the shelf's
      // content resolves for the campaign's Viewer, and the shelf stays out of every "the Worlds you
      // have" reading.
      expect(reaches(viewer).sort()).toEqual([worldId, shelf].sort());
      expect(lists(viewer)).toEqual([worldId]);
      // Its own Owner holds a member row, so it is hers to list as it always was.
      expect(lists(owner).sort()).toEqual([worldId, shelf].sort());
    });

    it('drops the cascade when no Owner of the mounting World still Owns the mounted Container', () => {
      const shelf = mountShelf();
      // The Own-only rule is what makes the cascade safe (ADR-0080), so it is asked per read: evict the
      // Owner who declared the Mount from the mounting World and the Mount stops republishing.
      db.delete(worldMembers)
        .where(and(eq(worldMembers.worldId, worldId), eq(worldMembers.userId, owner)))
        .run();
      expect(reaches(viewer)).toEqual([worldId]);
    });
  });

  describe('the Open-World disjunct (ADR-0084) — reachable Instance-wide, still unlisted', () => {
    /** Flip the World Open (the Owner-gated toggle's stored effect). */
    function open(id: string): void {
      db.update(worlds).set({ open: true }).where(eq(worlds.id, id)).run();
    }

    it('reaches an Open World for a stranger, yet never lists it (the retired-link property)', () => {
      // A signed-in non-member reaches the Open World by id/URL — the successor to the World Public
      // Link — but it stays absent from every "the Worlds you have" reading.
      expect(reaches(stranger)).toEqual([]);
      expect(lists(stranger)).toEqual([]);
      open(worldId);
      expect(reaches(stranger)).toEqual([worldId]);
      expect(lists(stranger)).toEqual([]);
    });

    it('decideMeta reports an Open World reachable to a stranger, without membership or ownership', () => {
      open(worldId);
      expect(worldAccess(db, stranger).decideMeta(worldId)).toEqual({
        reachable: true,
        isMember: false,
        isOwner: false,
        canContribute: false,
      });
    });

    it('leaves members and Owners exactly as they were — openness only widens the stranger case', () => {
      open(worldId);
      expect(reaches(viewer)).toEqual([worldId]);
      expect(lists(viewer)).toEqual([worldId]);
      expect(reaches(owner)).toEqual([worldId]);
      expect(lists(owner)).toEqual([worldId]);
    });
  });

  /** What the caller may *read* — the Mount cascade included. */
  function reaches(userId: string): string[] {
    return db
      .select({ id: worlds.id })
      .from(worlds)
      .where(worldAccess(db, userId).reachFilter)
      .all()
      .map((r) => r.id);
  }

  /** What the World Index *lists* — reachability minus the Mount cascade. */
  function lists(userId: string): string[] {
    return db
      .select({ id: worlds.id })
      .from(worlds)
      .where(worldAccess(db, userId).listFilter)
      .all()
      .map((r) => r.id);
  }

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
