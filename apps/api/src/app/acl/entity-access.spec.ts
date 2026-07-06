import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntityVerb } from '@hexly/domain';
import { createDb, Db } from '../db/db';
import { entities, entityGrants, users, worldMembers, worlds } from '../db/schema';
import { entityAccess } from './entity-access';

/**
 * The Entity authorization rule (ADR-0037), driven directly against a seeded SQLite — no
 * Nest, no HTTP, no cookies. This is the single source of truth for the role × visibility ×
 * superadmin → verbs matrix, so it doubles as the refactor's safety net: if a re-homing changes
 * a cell here, the ADR-0037 rule moved. `decide`/`rightsOf` compute the same predicates the
 * live read/write paths do, so a green matrix is a green authorization surface.
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
  // Two Entities: one private (proves grants pierce private), one shared (the curated surface).
  let priv: string;
  let shared: string;

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
      expect(access.decideMeta(priv)).toEqual({ canRead: true, isOwner: true });
      expect(entityAccess(db, wContrib).decideMeta(priv)).toEqual({
        canRead: false,
        isOwner: false,
      });
    });

    it('returns undefined for a non-existent Entity', () => {
      expect(entityAccess(db, eOwner).decideMeta(randomUUID())).toBeUndefined();
    });
  });

  describe('filter (read-scoped list predicate)', () => {
    it('lists exactly the Entities the caller can read', () => {
      const ids = (u: string) =>
        db
          .select({ id: entities.id })
          .from(entities)
          .where(entityAccess(db, u).filter)
          .all()
          .map((r) => r.id)
          .sort();
      expect(ids(eViewer)).toEqual([priv]); // viewer grant on private only
      expect(ids(wContrib)).toEqual([shared]); // member reads shared only
      expect(ids(superadmin)).toEqual([priv, shared].sort()); // repair sees all
      expect(ids(stranger)).toEqual([]);
    });
  });

  // ── seed helpers ──────────────────────────────────────────────────────────
  function seedWorld(): string {
    const id = randomUUID();
    db.insert(worlds).values({ id, name: 'Aldermoor', createdAt: 1, updatedAt: 1 }).run();
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

  function seedEntity(visibility: 'private' | 'shared'): string {
    const id = randomUUID();
    db.insert(entities)
      .values({
        id,
        worldId,
        name: `e-${visibility}`,
        type: 'note',
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
