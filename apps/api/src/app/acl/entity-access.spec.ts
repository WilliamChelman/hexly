import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntityVerb } from '@hexly/domain';
import { createDb, Db } from '../db/db';
import { containers, entities, entityGrants, users, worldMembers, worlds, WORLD_CONTAINER_KIND } from '../db/schema';
import { entityAccess } from './entity-access';

/**
 * The Entity authorization rule (ADR-0037) — the role × visibility × superadmin → verbs
 * matrix, driven against a seeded SQLite with no Nest, no HTTP, no cookies.
 */
describe('entityAccess', () => {
  let db: Db;
  let worldId: string;
  // Standings under test.
  let eOwner: string; // entity-level owner grant
  let eEditor: string; // entity-level editor grant
  let eViewer: string; // entity-level viewer grant
  let wOwner: string; // World Owner, no entity grant
  let wContrib: string; // World member (contributor), no entity grant
  let stranger: string; // no membership, no grant
  let superadmin: string;
  // Three Entities: one private (proves grants pierce private), one shared (the curated surface),
  // one open (ADR-0084 — Instance-wide reachable to any signed-in caller).
  let priv: string;
  let shared: string;
  let open: string;

  beforeEach(() => {
    db = createDb(':memory:');
    worldId = seedWorld();
    eOwner = seedUser();
    eEditor = seedUser();
    eViewer = seedUser();
    wOwner = seedUser();
    wContrib = seedUser();
    stranger = seedUser();
    superadmin = seedUser({ superadmin: true });

    db.insert(worldMembers)
      .values([
        { worldId, userId: wOwner, role: 'owner' },
        { worldId, userId: wContrib, role: 'contributor' },
      ])
      .run();

    priv = seedEntity('private');
    shared = seedEntity('shared');
    open = seedEntity('open');

    db.insert(entityGrants)
      .values([
        { entityId: priv, userId: eOwner, role: 'owner' },
        { entityId: priv, userId: eEditor, role: 'editor' },
        { entityId: priv, userId: eViewer, role: 'viewer' },
      ])
      .run();
  });

  /** The caller's Rights on `id` — the decision the read paths compute, projected to verbs. */
  function verbs(userId: string, id: string): EntityVerb[] {
    const access = entityAccess(db, userId);
    const decision = access.decide(id);
    return decision ? access.rightsOf(decision) : [];
  }

  describe('on a private Entity', () => {
    it('gives an entity Owner every verb (owner pierces private)', () => {
      expect(verbs(eOwner, priv)).toEqual(['read', 'edit', 'delete', 'set-visibility', 'manage']);
    });

    it('gives an entity Editor read + edit, no lifecycle or manage (grant pierces private)', () => {
      expect(verbs(eEditor, priv)).toEqual(['read', 'edit']);
    });

    it('gives an entity Viewer read only (grant pierces private)', () => {
      expect(verbs(eViewer, priv)).toEqual(['read']);
    });

    it('gives a World Owner nothing — management stops dead at private', () => {
      expect(verbs(wOwner, priv)).toEqual([]);
    });

    it('gives a stranger nothing', () => {
      expect(verbs(stranger, priv)).toEqual([]);
    });
  });

  describe('on a shared Entity', () => {
    it('gives a World Owner the curation verbs but not manage (no ownership grant)', () => {
      expect(verbs(wOwner, shared)).toEqual(['read', 'edit', 'delete', 'set-visibility']);
    });

    it('gives a plain World member read only', () => {
      expect(verbs(wContrib, shared)).toEqual(['read']);
    });

    it('gives a non-member nothing — shared is member-scoped', () => {
      expect(verbs(stranger, shared)).toEqual([]);
    });
  });

  describe('on an open Entity (ADR-0084)', () => {
    it('gives a signed-in non-member read only — open is Instance-wide reachable', () => {
      expect(verbs(stranger, open)).toEqual(['read']);
    });

    it('gives a World member read only — open is the widest rung, members read it too', () => {
      expect(verbs(wContrib, open)).toEqual(['read']);
    });

    it('gives the entity Owner every verb — the Owner still governs the open Entity', () => {
      db.insert(entityGrants).values({ entityId: open, userId: eOwner, role: 'owner' }).run();
      expect(verbs(eOwner, open)).toEqual(['read', 'edit', 'delete', 'set-visibility', 'manage']);
    });

    // The delegated World-Owner power is gated on `shared`, unchanged by #433: once an Entity is `open`
    // (not `shared`), a World Owner holds read only — set-visibility back down is the entity Owner's alone.
    it('gives a World Owner read only — the delegated curation power stops at shared', () => {
      expect(verbs(wOwner, open)).toEqual(['read']);
    });

    // The management cliff (ADR-0084, intended footgun): opening an Entity strands it above the World
    // Owner's delegated reach, which is `shared`-gated. So a World Owner cannot transition an `open`
    // Entity back down to `shared`/`private` — `set-visibility` is the entity Owner's alone from here.
    it('strands the World Owner above an open Entity — only the entity Owner can transition it back down', () => {
      db.insert(entityGrants).values({ entityId: open, userId: eOwner, role: 'owner' }).run();
      expect(verbs(wOwner, open)).not.toContain('set-visibility');
      expect(verbs(eOwner, open)).toContain('set-visibility');
    });
  });

  it('gives a Superadmin every verb at any visibility (repair bypass)', () => {
    const all: EntityVerb[] = ['read', 'edit', 'delete', 'set-visibility', 'manage'];
    expect(verbs(superadmin, priv)).toEqual(all);
    expect(verbs(superadmin, shared)).toEqual(all);
  });

  it('returns undefined from decide for a non-existent Entity', () => {
    expect(entityAccess(db, eOwner).decide(randomUUID())).toBeUndefined();
  });

  describe('decideMeta (blob-free owner/link gate)', () => {
    it('agrees with decide on reachability and ownership without loading the document', () => {
      const access = entityAccess(db, eOwner);
      // The Container rides along, so a caller that must tell home content from foreign needs no second read.
      expect(access.decideMeta(priv)).toEqual({ canRead: true, isOwner: true, containerId: worldId });
      expect(entityAccess(db, wContrib).decideMeta(priv)).toEqual({
        canRead: false,
        isOwner: false,
        containerId: worldId,
      });
    });

    it('returns undefined for a non-existent Entity', () => {
      expect(entityAccess(db, eOwner).decideMeta(randomUUID())).toBeUndefined();
    });

    // Regression: the read predicate rides a SELECT projection in decideMeta, where a naive
    // `worldMembers.world_id = entities.container_id` correlation can strip to a tautology and report
    // "member of *any* World" as readable. A member of a DIFFERENT World, with no membership or
    // grant here, must not read this shared Entity.
    it('does not read a shared Entity for a member of a different World', () => {
      const otherWorld = seedWorld('Elsewhere');
      const outsider = seedUser();
      db.insert(worldMembers).values({ worldId: otherWorld, userId: outsider, role: 'contributor' }).run();
      expect(entityAccess(db, outsider).decideMeta(shared)).toEqual({
        canRead: false,
        isOwner: false,
        containerId: worldId,
      });
      // And the branch genuinely works — a member of THIS World does read the shared Entity.
      expect(entityAccess(db, wContrib).decideMeta(shared)).toEqual({
        canRead: true,
        isOwner: false,
        containerId: worldId,
      });
    });
  });

  describe('listFilter (listing predicate) vs reachFilter (reachability)', () => {
    const ids = (predicate: 'listFilter' | 'reachFilter') => (u: string) =>
      db
        .select({ id: entities.id })
        .from(entities)
        .where(entityAccess(db, u)[predicate])
        .all()
        .map((r) => r.id)
        .sort();

    // Listing stays untouched by ADR-0084: `open` is absent, so an open Entity lists nowhere for a
    // non-member — the unlisted property the retired Public Link had. A caller lists it only via another
    // standing (here: the entity Owner grant added below).
    it('listFilter lists exactly the Entities the caller may enumerate — open is not a listing disjunct', () => {
      const listable = ids('listFilter');
      expect(listable(eViewer)).toEqual([priv]); // viewer grant on private only
      expect(listable(wContrib)).toEqual([shared]); // member lists shared only
      expect(listable(superadmin)).toEqual([priv, shared, open].sort()); // repair sees all
      expect(listable(stranger)).toEqual([]); // a stranger lists nothing, not even the open Entity
    });

    // Reachability adds the open disjunct: a stranger reaches the open Entity by id though it lists nowhere.
    it('reachFilter resolves the open Entity for everyone, over and above what lists', () => {
      const reachable = ids('reachFilter');
      expect(reachable(eViewer)).toEqual([priv, open].sort());
      expect(reachable(wContrib)).toEqual([shared, open].sort());
      expect(reachable(stranger)).toEqual([open]); // reachable by id, unlisted
    });

    // The Open-World disjunct (ADR-0084): opening the *World* widens its `shared` Entities to any
    // signed-in caller — the successor to the World Public Link's `shared`-only reach — while `private`
    // stays unreachable (Instance membership never pierces `private`) and listing is untouched.
    it("reachFilter resolves an Open World's shared Entities for a stranger, never its private ones", () => {
      db.update(worlds).set({ open: true }).where(eq(worlds.id, worldId)).run();
      const reachable = ids('reachFilter');
      // A stranger now reaches shared (via the Open World) and open (its own rung), but not private.
      expect(reachable(stranger)).toEqual([shared, open].sort());
      // Listing is still untouched — an Open World's shared Entities stay unlisted for a non-member.
      expect(ids('listFilter')(stranger)).toEqual([]);
    });
  });

  // ── seed helpers ──────────────────────────────────────────────────────────
  function seedWorld(name = 'Aldermoor'): string {
    const id = randomUUID();
    db.insert(containers).values({ id, kind: WORLD_CONTAINER_KIND, name, createdAt: 1, updatedAt: 1 }).run();
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

  function seedEntity(visibility: 'private' | 'shared' | 'open'): string {
    const id = randomUUID();
    db.insert(entities)
      .values({
        id,
        containerId: worldId,
        name: `e-${visibility}`,
        types: ['core.type.note'],
        tags: [],
        visibility,
        version: 1,
        document: '{}',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    return id;
  }
});
