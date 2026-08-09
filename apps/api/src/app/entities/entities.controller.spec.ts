import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { defineField, defineStructuredDataType, Field, WorldGraphNode } from '@hexly/domain';
import * as z from 'zod';
import { emptyRichContent, tiptapContent } from '@hexly/plugin-content';
import { coordKey } from '@hexly/plugin-hexmap';
import { and, eq } from 'drizzle-orm';
import { DB, Db, createDb } from '../db/db';
import { entities, entityGrants } from '../db/schema';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from './entities.module';
import { EntitiesService } from './entities.service';
import { TypeFieldRegistry } from './type-field-registry';
import * as entityAccessModule from '../acl/entity-access';
import { ConfigModule } from '../config/config.module';
import { WorldsModule } from '../worlds/worlds.module';
import { WorldsService } from '../worlds/worlds.service';
import { CompendiumWrites } from '../worlds/compendium-writes';

/**
 * Register a code-style type whose Fields are registered by id, then referenced by `fieldRefs`
 * (ADR-0054) — mirroring how a real bundled plugin declares a type over its `defineField` Fields.
 */
function registerType(registry: TypeFieldRegistry, typeId: string, fields: readonly Field[], label?: string): void {
  for (const field of fields) registry.registerField(field);
  registry.register(
    typeId,
    fields.map((field) => field.id),
    label,
  );
}

/** A Hex Map Entity Document: prose at `content`, grid at `grid` (ADR-0051). */
function hexmapBody(hexes: Record<string, unknown> = {}) {
  return {
    'core.field.content': emptyRichContent(),
    'core.field.grid': { hexes, regions: [], labels: [] },
  };
}

/** The empty plane a fresh Hex Map is minted with (and the editor round-trips). */
const emptyHexmapBody = hexmapBody();

/**
 * A World-authored scalar enum Field — the attach fixture the retired `dnd.size` used to be (ADR-0055).
 * The server slugs `world.field.size` from the segment and pins the document key to it (ADR-0056).
 */
const SIZE_FIELD = {
  segment: 'size',
  label: 'Size',
  dataType: { kind: 'enum', options: ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] },
  facetable: true,
};

describe('Entities endpoints', () => {
  let app: INestApplication;
  let db: Db;
  let adaId: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, EntitiesModule, WorldsModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);

    adaId = await seedUserWithWorld('ada@hexly.test', 'correct horse', 'Ada');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  /**
   * Seed a user and give them a World — the precondition for creating Entities (ADR-0024). The World
   * is empty (ADR-0043), so nothing surfaces in the owner's Entity list.
   */
  async function seedUserWithWorld(email: string, password: string, name: string) {
    const userId = await app.get(AuthService).seedUser(email, password, name, { roles: ['create-worlds'] });
    app.get(WorldsService).mintWorld(userId, name);
    return userId;
  }

  /** Seed a bare Instance user (no World) — a member reads someone else's World. */
  async function seedUser(email: string, password: string, name: string) {
    return app.get(AuthService).seedUser(email, password, name);
  }

  /** Flip an existing row's visibility directly — decouples read-predicate tests from the mutation feature (ADR-0037, #160). */
  function setVisibility(id: string, visibility: 'private' | 'shared' | 'open') {
    db.update(entities).set({ visibility }).where(eq(entities.id, id)).run();
  }

  /** Reassign sole ownership of a row — seeds a member-owned Entity inside another user's World. */
  function setOwner(id: string, userId: string) {
    // Ownership is an `owner`-role grant row post-fold (ADR-0037, migration 0007).
    db.delete(entityGrants)
      .where(and(eq(entityGrants.entityId, id), eq(entityGrants.role, 'owner')))
      .run();
    db.insert(entityGrants).values({ entityId: id, userId, role: 'owner' }).run();
  }

  async function signIn(email: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  }

  it('creates a named, typed entity for the owner, empty at version 1', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada
      .post('/entities')
      .send({ name: 'The Reach of Aldermoor', types: ['core.type.hex-map'] })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      worldId: expect.any(String),
      name: 'The Reach of Aldermoor',
      types: ['core.type.hex-map'],
      tags: [],
      visibility: 'private',
      version: 1,
      // The live-follow freshness key (ADR-0045); a fresh Entity is at sequence 1.
      seq: 1,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      document: emptyHexmapBody,
    });
  });

  it('creates a note as RichContent-only — it declares no Fields, so it mints no EntityDocument', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada
      .post('/entities')
      .send({ name: 'Lady Aldermoor', types: ['core.type.note'] })
      .expect(201);

    expect(res.body.types).toEqual(['core.type.note']);
    expect(res.body.document).toEqual({ 'core.field.content': emptyRichContent() });
  });

  it('seeds a multi-type create’s initial EntityDocument into the minted body (#189)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    // Creating with more than one type, carrying the values the create dialog collected for a
    // picked type's required Fields — seeded straight into the body's EntityDocument map.
    const res = await ada
      .post('/entities')
      .send({ name: 'Balthazar', types: ['core.type.note', 'core.type.hex-map'], document: { role: 'lich' } })
      .expect(201);

    expect(res.body.types).toEqual(['core.type.note', 'core.type.hex-map']);
    // The collected EntityDocument seeds over the minted defaults, not in place of them. `core.type.note` and
    // `core.type.hex-map` both reference the prose Field, but the effective set dedupes it to one (ADR-0051).
    expect(res.body.document).toEqual({
      'core.field.content': emptyRichContent(),
      'core.field.grid': { hexes: {}, regions: [], labels: [] },
      role: 'lich',
    });
  });

  /**
   * The **System-managed** create guard (ADR-0068): a raw `POST /entities` may no more mint an
   * asset-typed Entity than a raw edit may add the asset type to a hand-made one. Only the system's own
   * mint/import/reindex paths (which call `writes.insert` directly, not this create seam) assign it.
   */
  it('rejects a raw create carrying the System-managed asset type', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada
      .post('/entities')
      .send({ name: 'Fake', types: ['core.type.asset'] })
      .expect(403);
  });

  /**
   * The escalation the shape diff alone would miss: a create whose *document* carries a `core.field.asset`
   * value attaches the System-managed Field through the effective set (ADR-0057), forging an `asset_index`
   * dedup row for bytes no upload ever stored. The guard consults the effective set, so it is caught too.
   */
  it('rejects a raw create attaching the System-managed asset-ref Field via a crafted document', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada
      .post('/entities')
      .send({
        name: 'Forged',
        types: ['core.type.note'],
        document: { 'core.field.asset': { hash: 'a'.repeat(64), ext: '.png', mime: 'image/png', size: 1 } },
      })
      .expect(403);
  });

  it('trims surrounding whitespace off a created entity name', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada
      .post('/entities')
      .send({ name: '  The Whisperwood  ', types: ['core.type.note'] })
      .expect(201);

    expect(res.body.name).toBe('The Whisperwood');
  });

  /**
   * A directly-attached Field is now a namespaced document key its types never default (ADR-0057): it
   * rides create → load → save through the document itself, with no separate `fields[]` wire. A
   * World-authored `size` enum Field rides a plain Note the note type never names (story 2).
   */
  it('attaches a Field via a namespaced document key and round-trips it (ADR-0057)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = (await ada.get('/worlds').expect(200)).body[0].id;
    await ada.post(`/worlds/${worldId}/fields`).send(SIZE_FIELD).expect(201);

    // Attach `world.field.size` empty: its `null` key persists the attachment before a value is chosen.
    const created = await ada
      .post('/entities')
      .send({ name: 'Ealdred', types: ['core.type.note'], document: { 'world.field.size': null }, worldId })
      .expect(201);
    expect(created.body.document).toEqual({ 'core.field.content': emptyRichContent(), 'world.field.size': null });

    const loaded = await ada.get(`/entities/${created.body.id}`).expect(200);
    expect(loaded.body.document['world.field.size']).toBeNull();

    // A typed save (carrying `types`) fills the value; validation runs over the effective set, so the
    // enum is checked though no type declares `size` (story 15).
    await ada
      .put(`/entities/${created.body.id}`)
      .send({
        document: { 'core.field.content': emptyRichContent(), 'world.field.size': 'Large' },
        version: created.body.version,
        tags: [],
        types: ['core.type.note'],
      })
      .expect(200);

    const reloaded = await ada.get(`/entities/${created.body.id}`).expect(200);
    expect(reloaded.body.document['world.field.size']).toBe('Large');
  });

  /**
   * The forward-only Field gate runs over the *effective* set (ADR-0054/ADR-0057): on an active typed
   * save (one carrying `types`), an ill-typed value for a Field the document attaches is rejected, even
   * when no type names it (story 15).
   */
  it('rejects a typed save whose attached Field value is ill-typed, though no type declares it', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldId = (await ada.get('/worlds').expect(200)).body[0].id;
    await ada.post(`/worlds/${worldId}/fields`).send(SIZE_FIELD).expect(201);

    const created = await ada
      .post('/entities')
      .send({ name: 'Ealdred', types: ['core.type.note'], document: { 'world.field.size': null }, worldId })
      .expect(201);

    // `size` is an enum; a value outside its options fails the effective-set validation.
    await ada
      .put(`/entities/${created.body.id}`)
      .send({
        document: { 'core.field.content': emptyRichContent(), 'world.field.size': 'Colossal' },
        version: created.body.version,
        tags: [],
        types: ['core.type.note'],
      })
      .expect(400);
  });

  it('lets a Contributor create an Entity in a World they do not own (CONTEXT.md → Contributor)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const bobId = await seedUser('bob@hexly.test', 'correct horse', 'Bob');
    const bob = await signIn('bob@hexly.test', 'correct horse');
    const worldId = (await ada.get('/worlds').expect(200)).body[0].id;

    // Bob has no World of his own, so nothing is creatable → 404 NoWritableWorld.
    await bob
      .post('/entities')
      .send({ name: 'Premature', types: ['core.type.note'], worldId })
      .expect(404);

    // Ada grants Bob Contributor standing in her World; now he may author there.
    await ada.post(`/worlds/${worldId}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
    const res = await bob
      .post('/entities')
      .send({ name: 'Bob’s Note', types: ['core.type.note'], worldId })
      .expect(201);

    expect(res.body.worldId).toBe(worldId);
    // Contributor becomes the created Entity's sole Owner (ADR-0037) — he can read it back.
    await bob.get(`/entities/${res.body.id}`).expect(200);
  });

  // ADR-0084 (#433): `open` is the third rung — a signed-in non-member reaches an open Entity by id,
  // the same Instance-wide reach a Compendium has, while it stays unlisted for them (reachability, not listing).
  describe('open reachability for a signed-in non-member (ADR-0084)', () => {
    it('reads an open Entity by id but not a shared or private sibling in a World it is not in', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await seedUser('bob@hexly.test', 'correct horse', 'Bob');
      const bob = await signIn('bob@hexly.test', 'correct horse');
      const worldId = (await ada.get('/worlds').expect(200)).body[0].id;

      // Ada authors three siblings in her World; Bob holds no membership or grant on any.
      const priv = await ada
        .post('/entities')
        .send({ name: 'Priv', types: ['core.type.note'], worldId })
        .expect(201);
      const shared = await ada
        .post('/entities')
        .send({ name: 'Shared', types: ['core.type.note'], worldId })
        .expect(201);
      const opened = await ada
        .post('/entities')
        .send({ name: 'Opened', types: ['core.type.note'], worldId })
        .expect(201);
      setVisibility(shared.body.id, 'shared');
      setVisibility(opened.body.id, 'open');

      // Only the open one reaches the non-member; shared and private are indistinguishable from missing.
      await bob.get(`/entities/${opened.body.id}`).expect(200);
      await bob.get(`/entities/${shared.body.id}`).expect(404);
      await bob.get(`/entities/${priv.body.id}`).expect(404);
    });

    it('does not surface the open Entity in the non-member’s browse or search (listing stays scoped)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await seedUserWithWorld('bob@hexly.test', 'correct horse', 'Bob');
      const bob = await signIn('bob@hexly.test', 'correct horse');
      const worldId = (await ada.get('/worlds').expect(200)).body[0].id;

      const opened = await ada
        .post('/entities')
        .send({ name: 'Opened', types: ['core.type.note'], worldId })
        .expect(201);
      setVisibility(opened.body.id, 'open');
      // Bob authors one in his own World, so his browse is non-empty for a real contrast.
      await bob
        .post('/entities')
        .send({ name: 'Bob’s Note', types: ['core.type.note'] })
        .expect(201);

      const browse = await bob.get('/entities').expect(200);
      const names = browse.body.items.map((e: { name: string }) => e.name);
      expect(names).toContain('Bob’s Note');
      expect(names).not.toContain('Opened');
      // Nor by explicit search — reachability by id never promotes to a listing surface.
      const search = await bob.get('/entities').query({ q: 'Opened' }).expect(200);
      expect(search.body.items).toHaveLength(0);
    });
  });

  it('defaults an un-scoped create to the caller’s own World, not one they only contribute to', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const worldA = (await ada.get('/worlds').expect(200)).body[0].id; // Ada's World, the oldest
    const bobId = await seedUser('bob@hexly.test', 'correct horse', 'Bob');
    const worldB = app.get(WorldsService).mintWorld(bobId, 'Bob’s World');
    // Bob owns his own (newer) World B, and merely contributes to Ada's older World A.
    await ada.post(`/worlds/${worldA}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
    const bob = await signIn('bob@hexly.test', 'correct horse');

    // No worldId → defaults to Bob's OWN World (B), never Ada's (A) despite A being older and creatable.
    const res = await bob
      .post('/entities')
      .send({ name: 'Bob’s Note', types: ['core.type.note'] })
      .expect(201);
    expect(res.body.worldId).toBe(worldB);
    expect(res.body.worldId).not.toBe(worldA);
  });

  it('lists the owner’s entities as an envelope of summaries, last page → nextCursor null', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });
    await ada.post('/entities').send({ name: 'Lady A', types: ['core.type.note'] });

    const res = await ada.get('/entities').expect(200);

    // Response is always an envelope (ADR-0025). The World seeds no Entities (ADR-0043).
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((e: { name: string }) => e.name).sort()).toEqual(['Aldermoor', 'Lady A']);
    expect(res.body.items[0]).not.toHaveProperty('document');
    expect(res.body.items[0]).toHaveProperty('types');
    expect(res.body.items[0]).toHaveProperty('tags');
  });

  it('walks every owner entity exactly once via cursor, with limit bounding each page', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const name of names) {
      await ada.post('/entities').send({ name, types: ['core.type.note'] });
    }

    // Walk list two-at-a-time via nextCursor.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await ada
        .get('/entities')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((e: { name: string }) => e.name));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    // All entities seen exactly once (no duplicates or gaps).
    expect(seen.slice().sort()).toEqual(names.slice().sort());
    expect(seen.length).toBe(names.length);
    // 6 entities at 2/page = 3 pages.
    expect(pages).toBe(3);
  });

  it('filters by case-insensitive name (q) and by type, composing the two', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await ada.post('/entities').send({ name: 'Aldermoor Keep', types: ['core.type.hex-map'] });
    await ada.post('/entities').send({ name: 'Aldermoor Town', types: ['core.type.note'] });
    await ada.post('/entities').send({ name: 'The Whisperwood', types: ['core.type.note'] });

    const byName = await ada.get('/entities').query({ q: 'aldermoor' }).expect(200);
    expect(byName.body.items.map((e: { name: string }) => e.name).sort()).toEqual(['Aldermoor Keep', 'Aldermoor Town']);

    const byType = await ada.get('/entities').query({ type: 'core.type.note' }).expect(200);
    expect(byType.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'Aldermoor Town',
      'The Whisperwood',
    ]);

    const both = await ada.get('/entities').query({ q: 'aldermoor', type: 'core.type.note' }).expect(200);
    expect(both.body.items.map((e: { name: string }) => e.name)).toEqual(['Aldermoor Town']);
  });

  it('returns exactly the requested owner-owned summaries when ids is given', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const a = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });
    await ada.post('/entities').send({ name: 'The Whisperwood', types: ['core.type.note'] });
    const c = await ada.post('/entities').send({ name: 'Lady A', types: ['core.type.note'] });

    // ids silently drops unknown ids (picker's display-resolve path).
    const res = await ada
      .get('/entities')
      .query({ ids: [a.body.id, c.body.id, 'no-such-id'] })
      .expect(200);

    expect(res.body.items.map((e: { id: string }) => e.id).sort()).toEqual([a.body.id, c.body.id].sort());
  });

  it('filters the entity list to one World via worldId', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const seeded = await ada
      .post('/entities')
      .send({ name: 'In Seeded World', types: ['core.type.note'] })
      .expect(201);
    const worldA = seeded.body.worldId;

    const worldB = await ada.post('/worlds').send({ name: 'Second' }).expect(201);
    await ada
      .post('/entities')
      .send({
        name: 'In Second World',
        types: ['core.type.note'],
        worldId: worldB.body.id,
      })
      .expect(201);

    const inA = await ada.get('/entities').query({ worldId: worldA }).expect(200);
    expect(inA.body.items.map((e: { name: string }) => e.name).sort()).toEqual(['In Seeded World']);

    const inB = await ada.get('/entities').query({ worldId: worldB.body.id }).expect(200);
    expect(inB.body.items.map((e: { name: string }) => e.name).sort()).toEqual(['In Second World']);
  });

  /**
   * The read the Entity Link picker makes (#394), for the caller who reaches a second World — the
   * case it used to leak. Only *offering* is scoped; resolving an existing link is not.
   */
  describe('the Entity Link picker’s read, for a caller reachable in two Worlds', () => {
    /** Bob owns World B and merely contributes to Ada's World A — both reachable, only one active. */
    async function bobInTwoWorlds() {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const worldA = (await ada.get('/worlds').expect(200)).body[0].id;
      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      const worldB = app.get(WorldsService).mintWorld(bobId, 'Bob’s World');
      await ada.post(`/worlds/${worldA}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const inA = await bob
        .post('/entities')
        .send({ name: 'Ashen Vale', types: ['core.type.note'], worldId: worldA })
        .expect(201);
      await bob
        .post('/entities')
        .send({ name: 'Ashen Ridge', types: ['core.type.note'], worldId: worldB })
        .expect(201);
      return { bob, worldB, inA: inA.body.id };
    }

    it('offers nothing from the other World, though the caller reaches both', async () => {
      const { bob, worldB } = await bobInTwoWorlds();

      // Unscoped, both are his to see — so the scoped read below is scoping, not an access failure.
      const reachable = await bob.get('/entities').query({ q: 'ashen' }).expect(200);
      expect(reachable.body.items.map((e: { name: string }) => e.name).sort()).toEqual(['Ashen Ridge', 'Ashen Vale']);

      const offered = await bob.get('/entities').query({ q: 'ashen', worldId: worldB }).expect(200);
      expect(offered.body.items.map((e: { name: string }) => e.name)).toEqual(['Ashen Ridge']);
    });

    it('still resolves a link whose target lives outside the active World', async () => {
      const { bob, inA } = await bobInTwoWorlds();

      // The picker resolves an existing link by id, unscoped, so scoping the search never turns a
      // link that already crosses Worlds into a dangling one.
      const res = await bob
        .get('/entities')
        .query({ ids: [inA] })
        .expect(200);
      expect(res.body.items.map((e: { name: string }) => e.name)).toEqual(['Ashen Vale']);
    });
  });

  /**
   * The **find versus link** line (#400, ADR-0079): one read, two kinds. A link-target read never
   * returns a **Compendium Entry**, a navigation read does — so a user who half-remembers a monster's
   * name reaches it, and nothing outside a Compendium comes to point at one.
   *
   * Driven through `GET /entities` for both kinds, because the seal is the read's behaviour and
   * nothing else: there is no flag on the row and no rejection at the write.
   */
  describe('the find/link line: a link-target read versus a navigation read (ADR-0079)', () => {
    const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((e) => e.name);

    /**
     * Ada’s own Goblin Warren note beside a pack’s plain Goblin — the ticket’s own example,
     * so "my work before the shelf's" is asserted on the query that motivated it.
     */
    async function shelfAndAuthoredNote() {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = (await ada.get('/worlds').expect(200)).body[0].id;
      const mine = await ada
        .post('/entities')
        .send({ name: 'Goblin Warren', types: ['core.type.note'], worldId: world })
        .expect(201);
      // A long note against a one-word entry, so bm25 — which rewards a short document — would put the
      // pack's Goblin first on its own. That makes the assertion below about the tier and not the fixture.
      await ada
        .put(`/entities/${mine.body.id}`)
        .send({
          document: {
            'core.field.content': tiptapContent({
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'The tunnels run for miles beneath the hills, and the tribe that dug them has held the lower galleries for six generations without once coming up for air.',
                    },
                  ],
                },
              ],
            }),
          },
          version: 1,
          tags: [],
        })
        .expect(200);
      const entry = seedCompendiumEntry('Goblin', 'Guards the sunken larder.');
      return { ada, world, mine: mine.body.id as string, entry };
    }

    it('offers no Compendium Entry to a link-target read, and finds one for a navigation read', async () => {
      const { ada, entry } = await shelfAndAuthoredNote();

      // Navigation (the default): the Command Palette's read reaches both sides of the wall.
      expect(names(await ada.get('/entities').query({ q: 'goblin' }).expect(200))).toContain('Goblin');
      // Link-target: the same query, the same caller, one row short — the entry is unreachable as a target.
      const offered = await ada.get('/entities').query({ q: 'goblin', read: 'link-target' }).expect(200);
      expect(names(offered)).toEqual(['Goblin Warren']);
      // Not an access failure: it is his to read, by id, on the navigation surface it has a page on.
      await ada.get(`/entities/${entry}`).expect(200);
    });

    it('ranks an authored Entity above a Compendium Entry at equal relevance', async () => {
      const { ada } = await shelfAndAuthoredNote();

      // Both match "goblin" on the name field; the tier, not bm25, decides which leads.
      expect(names(await ada.get('/entities').query({ q: 'goblin' }).expect(200))).toEqual(['Goblin Warren', 'Goblin']);
    });

    it('reaches compendium prose by full-text search, so a forgotten name is still findable', async () => {
      const { ada } = await shelfAndAuthoredNote();

      // A phrase from the entry's description, matching nothing the author wrote.
      expect(names(await ada.get('/entities').query({ q: 'larder' }).expect(200))).toEqual(['Goblin']);
    });

    it('drops Compendium Entries from a link-target read’s Facet counts too', async () => {
      const { ada } = await shelfAndAuthoredNote();

      // A rail must never count what its list excludes — the same rule `includeHidden` follows (ADR-0065).
      const navigation = await ada.get('/entities/facets').query({ q: 'goblin' }).expect(200);
      expect(navigation.body.type).toContainEqual({ value: 'core.type.note', count: 2 });
      const linkTarget = await ada.get('/entities/facets').query({ q: 'goblin', read: 'link-target' }).expect(200);
      expect(linkTarget.body.type).toEqual([{ value: 'core.type.note', count: 1 }]);
    });

    it('narrows an unscoped link-target read too, not only a World-scoped one', async () => {
      const { ada } = await shelfAndAuthoredNote();

      // The `@` picker's read carries a World, but the exclusion must not *depend* on it: the seal is
      // the read's kind, so a read that names no Container is still sealed (ADR-0079).
      expect(names(await ada.get('/entities').query({ read: 'link-target' }).expect(200))).not.toContain('Goblin');
    });

    it('saves an Entity whose prose mentions a Compendium Entry, rather than failing the write', async () => {
      const { ada, mine, entry } = await shelfAndAuthoredNote();

      // Enforced by discovery, never at the write choke point: one inline mention in a long Content
      // field must not fail a whole autosave (ADR-0079). The link is minted straight against the id,
      // exactly as a forged one would be.
      const document = {
        'core.field.content': tiptapContent({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'entityLink', attrs: { entityId: entry, label: 'Goblin' } }],
            },
          ],
        }),
      };
      await ada.put(`/entities/${mine}`).send({ document, version: 2, tags: [] }).expect(200);
      // And it renders: an id resolution is a navigation read, so the forged link is a live pill.
      expect(
        names(
          await ada
            .get('/entities')
            .query({ ids: [entry] })
            .expect(200),
        ),
      ).toEqual(['Goblin']);
    });

    it('rejects an unknown read kind rather than silently navigating', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await ada.get('/entities').query({ q: 'goblin', read: 'linktarget' }).expect(400);
    });

    /**
     * The relation surfaces carry no compendium exclusion rule of their own, and still need none: a link
     * forged straight at a Compendium Entry leaves the Container, so the Local Graph draws it the way it
     * draws every such link — as a marked **Foreign node** (ADR-0080), never as one of this World's own.
     */
    it('draws a Compendium Entry as a Foreign node, never as one of the World’s own', async () => {
      const { ada, world, mine, entry } = await shelfAndAuthoredNote();
      const road = await ada
        .post('/entities')
        .send({ name: 'Hollow Road', types: ['core.type.note'], worldId: world })
        .expect(201);
      // One ordinary link beside one forged at the Compendium Entry, so each read is asserted to be
      // *narrow* rather than merely empty.
      const document = {
        'core.field.content': tiptapContent({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'entityLink', attrs: { entityId: road.body.id, label: 'Hollow Road' } },
                { type: 'entityLink', attrs: { entityId: entry, label: 'Goblin' } },
              ],
            },
          ],
        }),
      };
      await ada.put(`/entities/${mine}`).send({ document, version: 2, tags: [] }).expect(200);

      const graph = await ada.get(`/entities/${mine}/graph`).expect(200);
      const nodes = graph.body.nodes as WorldGraphNode[];
      expect(nodes.map((n) => n.name).sort()).toEqual(['Goblin', 'Goblin Warren', 'Hollow Road']);
      // The World's own nodes are still exactly its own Entities; the pack's entry is marked as the
      // Compendium's, which is also what a click on it navigates by.
      expect(
        nodes
          .filter((n) => !n.foreignContainerId)
          .map((n) => n.name)
          .sort(),
      ).toEqual(['Goblin Warren', 'Hollow Road']);
      const compendium = db.select({ id: entities.containerId }).from(entities).where(eq(entities.id, entry)).get();
      expect(nodes.find((n) => n.name === 'Goblin')?.foreignContainerId).toBe(compendium?.id);

      const references = await ada.get(`/entities/${road.body.id}/references`).expect(200);
      expect((references.body.referencedBy as { source: { name: string } }[]).map((r) => r.source.name)).toEqual([
        'Goblin Warren',
      ]);
      expect(references.body.references).toEqual([]);
    });

    /**
     * Install a one-entry pack directly through the Compendium's own write handle — the Importer that
     * fills a real one is exercised in `draw-steel-monsters-import.controller.spec.ts`; what matters
     * here is only that the Entity lives in a Compendium Container.
     */
    function seedCompendiumEntry(name: string, prose: string): string {
      const containerId = app
        .get(CompendiumWrites)
        .install(`test.importer.${name.toLowerCase().replace(/\W+/g, '-')}`, { name: 'Test Bestiary' }, 'rev-1');
      const id = randomUUID();
      app.get(EntitiesService).importEntity({
        // The importer's runner takes an `owner` grant on what it lands, so an unscoped read of Ada's
        // own is genuinely capable of returning the entry — which is what makes the exclusion visible.
        ownerId: adaId,
        containerId,
        id,
        name,
        types: ['core.type.note'],
        tags: [],
        document: {
          'core.field.content': tiptapContent({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: prose }] }],
          }),
        },
      });
      return id;
    }
  });

  it('attaches Rights to list summaries only when the caller opts in (ADR-0039)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.note'] });
    const worldId = created.body.worldId;

    // Opted in: each summary carries the caller's Rights (Owner → all five verbs).
    const withRights = await ada.get(`/entities?worldId=${worldId}&rights=1`).expect(200);
    const mine = withRights.body.items.find((e: { id: string }) => e.id === created.body.id);
    expect(mine.rights).toEqual(['read', 'edit', 'delete', 'set-visibility', 'manage']);

    // Default: no per-row Rights — the suggestion/palette path stays a pure read-filter.
    const plain = await ada.get(`/entities?worldId=${worldId}`).expect(200);
    expect(plain.body.items[0]).not.toHaveProperty('rights');
  });

  it('loads an entity by id with its full body', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });

    const res = await ada.get(`/entities/${created.body.id}`).expect(200);

    // The single-entity fetch carries the caller's Rights (ADR-0039) — the closed verb set
    // they may exercise on it; an Owner holds all five. The create response omits `rights`.
    expect(res.body).toEqual({
      ...created.body,
      rights: ['read', 'edit', 'delete', 'set-visibility', 'manage'],
    });
    expect(res.body.document).toEqual(emptyHexmapBody);
  });

  it('returns 404 for an entity id that does not exist', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada.get('/entities/does-not-exist').expect(404);
  });

  it('saves the body against the current version and bumps the version', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });
    const painted = hexmapBody({ [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } });

    const res = await ada
      .put(`/entities/${created.body.id}`)
      .send({ document: painted, version: created.body.version, tags: [] })
      .expect(200);

    expect(res.body.version).toBe(2);
    expect(res.body.document).toEqual(painted);

    const reloaded = await ada.get(`/entities/${created.body.id}`).expect(200);
    expect(reloaded.body.document).toEqual(painted);
    expect(reloaded.body.version).toBe(2);
  });

  it('persists an entity’s tags through a version-checked save', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Lady A', types: ['core.type.note'] });
    const id = created.body.id;
    const body = { 'core.field.content': emptyRichContent() };

    const res = await ada
      .put(`/entities/${id}`)
      .send({ document: body, version: 1, tags: ['deity', 'ruined'] })
      .expect(200);

    expect(res.body.tags).toEqual(['deity', 'ruined']);
    expect(res.body.version).toBe(2);

    const reloaded = await ada.get(`/entities/${id}`).expect(200);
    expect(reloaded.body.tags).toEqual(['deity', 'ruined']);
  });

  it('normalizes tags on save: trims, lower-cases, drops duplicates, rejects blanks', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Lady A', types: ['core.type.note'] });
    const id = created.body.id;
    const body = { 'core.field.content': emptyRichContent() };

    const res = await ada
      .put(`/entities/${id}`)
      .send({
        document: body,
        version: 1,
        tags: [' Deity ', 'deity', 'RUINED'],
      })
      .expect(200);
    expect(res.body.tags).toEqual(['deity', 'ruined']);

    await ada
      .put(`/entities/${id}`)
      .send({ document: body, version: 2, tags: ['   '] })
      .expect(400);
  });

  it('round-trips an opaque RichContent snapshot through a save untouched', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Lady A', types: ['core.type.note'] });
    // Editor-defined snapshot; domain has no knowledge of it (ADR-0019).
    const snapshot = {
      type: 'doc',
      content: [{ type: 'futureBlock', attrs: { z: [1] } }],
    };
    const body = { 'core.field.content': { format: 'tiptap-v1', snapshot } };

    await ada.put(`/entities/${created.body.id}`).send({ document: body, version: 1, tags: [] }).expect(200);

    const reloaded = await ada.get(`/entities/${created.body.id}`).expect(200);
    expect(reloaded.body.document['core.field.content'].snapshot).toEqual(snapshot);
  });

  it('rejects a save built on a stale version with 409 and keeps the entity intact', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });
    const id = created.body.id;
    const first = hexmapBody({ [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } });

    await ada.put(`/entities/${id}`).send({ document: first, version: 1, tags: [] }).expect(200);

    const stale = hexmapBody({ [coordKey({ q: 9, r: 9 })]: { terrain: 'ocean' } });
    const conflict = await ada.put(`/entities/${id}`).send({ document: stale, version: 1, tags: [] }).expect(409);
    // 409 includes server's current Entity for client re-pull.
    expect(conflict.body.version).toBe(2);
    expect(conflict.body.document).toEqual(first);

    const reloaded = await ada.get(`/entities/${id}`).expect(200);
    expect(reloaded.body.document).toEqual(first);
    expect(reloaded.body.version).toBe(2);
  });

  // The forward-only Field gate (ADR-0048): an active typed edit (a save asserting a `types` set,
  // as the generic Field view or a plugin form does) must fit the shape its types' Fields declare, an
  // unanswered `required` Field being Incomplete rather than a violation (ADR-0074), while the same
  // body arriving via import or already at rest is tolerated untouched.
  describe('the forward-only Field gate on active typed edits', () => {
    // A plugin-style type declaring a required string Field and an optional number Field.
    beforeEach(() => {
      registerType(app.get(TypeFieldRegistry), 'test.type.beast', [
        defineField({ id: 'test.field.name', label: 'Name', dataType: { kind: 'string' }, required: true }),
        defineField({ id: 'test.field.cr', label: 'Challenge Rating', dataType: { kind: 'number' } }),
      ]);
    });

    const bodyWith = (metadata?: Record<string, unknown>) => ({
      'core.field.content': emptyRichContent(),
      ...metadata,
    });

    // Absence is Incomplete, never a refused write (ADR-0074).
    it('accepts a typed edit that omits a required Field, storing the document as sent', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const created = await ada.post('/entities').send({ name: 'Aboleth', types: ['core.type.note'] });

      const res = await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: bodyWith({ 'test.field.cr': 10 }),
          version: 1,
          tags: [],
          types: ['test.type.beast'],
        })
        .expect(200);
      expect(res.body.types).toEqual(['test.type.beast']);
      expect(res.body.document).toEqual({ 'core.field.content': emptyRichContent(), 'test.field.cr': 10 });
    });

    it('accepts a create of a Type whose required Field is absent', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');

      const res = await ada
        .post('/entities')
        .send({ name: 'Aboleth', types: ['test.type.beast'], document: bodyWith({ 'test.field.cr': 10 }) })
        .expect(201);

      expect(res.body.document['test.field.name']).toBeUndefined();
      expect(res.body.document['test.field.cr']).toBe(10);
    });

    // The create door was already exempt (ADR-0048) — like an import it establishes at-rest data — so a
    // shape violation is refused at the first typed save, not at the mint.
    it('takes an ill-typed value on create, and refuses the same value on the typed save', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');

      const created = await ada
        .post('/entities')
        .send({ name: 'Aboleth', types: ['test.type.beast'], document: bodyWith({ 'test.field.cr': 'huge' }) })
        .expect(201);

      const res = await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: bodyWith({ 'test.field.cr': 'huge' }),
          version: created.body.version,
          tags: [],
          types: ['test.type.beast'],
        })
        .expect(400);
      expect(res.body.code).toBe('invalid-fields');
      expect(res.body.data.fields).toContainEqual({ key: 'test.field.cr', code: 'type' });
    });

    it('rejects a typed edit whose Field value mismatches its data-type', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const created = await ada.post('/entities').send({ name: 'Aboleth', types: ['core.type.note'] });

      const res = await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: bodyWith({ 'test.field.name': 'Aboleth', 'test.field.cr': 'huge' }),
          version: 1,
          tags: [],
          types: ['test.type.beast'],
        })
        .expect(400);
      expect(res.body.data.fields).toContainEqual({ key: 'test.field.cr', code: 'type' });
    });

    it('accepts a typed edit that satisfies the type’s Fields, keeping values in the EntityDocument map', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const created = await ada.post('/entities').send({ name: 'Aboleth', types: ['core.type.note'] });

      const res = await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: bodyWith({ 'test.field.name': 'Aboleth', 'test.field.cr': 10 }),
          version: 1,
          tags: [],
          types: ['test.type.beast'],
        })
        .expect(200);
      expect(res.body.types).toEqual(['test.type.beast']);
      expect(res.body.document).toEqual({
        'core.field.content': emptyRichContent(),
        'test.field.name': 'Aboleth',
        'test.field.cr': 10,
      });
    });

    it('accepts a plain body save that omits types — data at rest is never retroactively invalidated', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // A typed Entity carrying EntityDocument that would fail the gate; a plain edit (no `types`) is
      // tolerated, so an unrelated body change never strands the Entity on its malformed Fields.
      const created = await ada.post('/entities').send({ name: 'Aboleth', types: ['test.type.beast'] });

      await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: bodyWith({ 'test.field.cr': 'still wrong' }),
          version: 1,
          tags: [],
        })
        .expect(200);
    });

    it('never validates the same malformed body via import or at rest — the gate is edit-only', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const created = await ada.post('/entities').send({ name: 'Aboleth', types: ['test.type.beast'] });
      const worldId = created.body.worldId;

      // Import: bulk-inserted EntityDocument never faces the gate (ADR-0033), whatever it holds — a typed
      // import (#203) included, and `test.field.name` is required and absent here.
      app.get(EntitiesService).importEntity({
        ownerId: adaId,
        containerId: worldId,
        id: 'imported-beast',
        name: 'Kraken',
        types: ['test.type.beast'],
        tags: [],
        document: bodyWith({ 'test.field.cr': 'wrong' }),
      });
      await ada.get('/entities/imported-beast').expect(200);

      // At rest: corrupt the stored EntityDocument directly, then confirm a read never validates it.
      db.update(entities)
        .set({ document: JSON.stringify(bodyWith({ 'test.field.cr': 'wrong at rest' })) })
        .where(eq(entities.id, created.body.id))
        .run();
      const loaded = await ada.get(`/entities/${created.body.id}`).expect(200);
      expect(loaded.body.document).toEqual({
        'core.field.content': emptyRichContent(),
        'test.field.cr': 'wrong at rest',
      });
    });

    // The stored flag is read as a prompt now, so no migration rewrites it (ADR-0074).
    it('keeps a World Field marked required working, its absence no longer refusing the save', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const worldId = (await ada.get('/worlds').expect(200)).body[0].id;
      await ada
        .post(`/worlds/${worldId}/fields`)
        .send({ ...SIZE_FIELD, required: true })
        .expect(201);
      const created = await ada
        .post('/entities')
        .send({ name: 'Ealdred', types: ['core.type.note'], document: { 'world.field.size': null }, worldId })
        .expect(201);

      await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: { 'core.field.content': emptyRichContent(), 'world.field.size': null },
          version: created.body.version,
          tags: [],
          types: ['core.type.note'],
        })
        .expect(200);

      // The same Field with a value outside its enum is still a shape violation.
      await ada
        .put(`/entities/${created.body.id}`)
        .send({
          document: { 'core.field.content': emptyRichContent(), 'world.field.size': 'Colossal' },
          version: created.body.version + 1,
          tags: [],
          types: ['core.type.note'],
        })
        .expect(400);
    });
  });

  it('renames an entity without disturbing its body or version', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Untitled', types: ['core.type.hex-map'] });
    const id = created.body.id;
    const painted = hexmapBody({ [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } });
    await ada.put(`/entities/${id}`).send({ document: painted, version: 1, tags: [] }).expect(200);

    const res = await ada.patch(`/entities/${id}`).send({ name: 'The Reach of Aldermoor' }).expect(200);

    expect(res.body.name).toBe('The Reach of Aldermoor');
    expect(res.body.version).toBe(2);
    expect(res.body.document).toEqual(painted);
  });

  it('deletes an entity so it can no longer be loaded', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });

    await ada.delete(`/entities/${created.body.id}`).expect(204);

    await ada.get(`/entities/${created.body.id}`).expect(404);
  });

  it('returns 404 when deleting an entity that does not exist', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada.delete('/entities/does-not-exist').expect(404);
  });

  it('deletes any note, with no undeletable Home Entity special-case (ADR-0043)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // A note named after the World is the old Home shape — now an ordinary, deletable Note.
    const note = await ada
      .post('/entities')
      .send({ name: 'Ada', types: ['core.type.note'] })
      .expect(201);

    await ada.delete(`/entities/${note.body.id}`).expect(204);
    await ada.get(`/entities/${note.body.id}`).expect(404);
  });

  it('never lets another user reach an entity they do not own', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });
    const id = created.body.id;

    await seedUserWithWorld('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    // Bob's own World is empty and Ada's Entity never leaks into his list (ADR-0004).
    const bobsList = await bob.get('/entities').expect(200);
    expect(bobsList.body.items.map((e: { name: string }) => e.name)).toEqual([]);
    expect(bobsList.body.items.map((e: { id: string }) => e.id)).not.toContain(id);
    await bob.get(`/entities/${id}`).expect(404);
    await bob.put(`/entities/${id}`).send({ document: emptyHexmapBody, version: 1, tags: [] }).expect(404);
    await bob.patch(`/entities/${id}`).send({ name: 'Hijacked' }).expect(404);
    await bob.delete(`/entities/${id}`).expect(404);

    const reloaded = await ada.get(`/entities/${id}`).expect(200);
    expect(reloaded.body.version).toBe(1);
  });

  it('stays owner-scoped under ids/q/type — another owner’s entity never surfaces', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const adas = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });

    await seedUserWithWorld('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');
    await bob.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });

    const byId = await bob
      .get('/entities')
      .query({ ids: [adas.body.id] })
      .expect(200);
    expect(byId.body.items).toEqual([]);

    const byQ = await bob.get('/entities').query({ q: 'aldermoor', type: 'core.type.hex-map' }).expect(200);
    expect(byQ.body.items).toHaveLength(1);
    expect(byQ.body.items.map((e: { id: string }) => e.id)).not.toContain(adas.body.id);
  });

  it('rejects a malformed cursor or limit with 400, not a 500', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada.get('/entities').query({ cursor: 'not-a-real-cursor!!' }).expect(400);
    await ada.get('/entities').query({ limit: 'lots' }).expect(400);
    await ada.get('/entities').query({ limit: '0' }).expect(400);
    await ada.get('/entities').query({ limit: '-5' }).expect(400);
    await ada.get('/entities').query({ limit: '10' }).expect(200);
  });

  describe('descriptor vocabulary index (#96)', () => {
    // A note body whose RichContent carries an entityLink per descriptor — the server
    // harvests the vocabulary from *this*, not from a separate field (ADR-0023/0035).
    function bodyWithDescriptors(...descriptors: string[]) {
      return {
        'core.field.content': tiptapContent({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: descriptors.map((descriptor, i) => ({
                type: 'entityLink',
                attrs: { entityId: `e${i}`, descriptor },
              })),
            },
          ],
        }),
      };
    }

    async function newNote(agent: Awaited<ReturnType<typeof signIn>>, name = 'Lady A') {
      const res = await agent.post('/entities').send({ name, types: ['core.type.note'] });
      return res.body.id as string;
    }

    it('serves the owner’s DISTINCT descriptors harvested from the saved RichContent, folding case', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const id = await newNote(ada);

      await ada
        .put(`/entities/${id}`)
        .send({
          document: bodyWithDescriptors(' Spouse ', 'spouse', 'Capital Of'),
          version: 1,
          tags: [],
        })
        .expect(200);

      const res = await ada.get('/entities/descriptors').expect(200);
      expect(res.body).toEqual(['capital of', 'spouse']);
    });

    it('unions descriptors across the owner’s entities', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const a = await newNote(ada, 'A');
      const b = await newNote(ada, 'B');

      await ada
        .put(`/entities/${a}`)
        .send({ document: bodyWithDescriptors('spouse'), version: 1, tags: [] })
        .expect(200);
      await ada
        .put(`/entities/${b}`)
        .send({ document: bodyWithDescriptors('rival'), version: 1, tags: [] })
        .expect(200);

      const res = await ada.get('/entities/descriptors').expect(200);
      expect(res.body).toEqual(['rival', 'spouse']);
    });

    it('self-prunes: a later save whose RichContent dropped a link drops it from the vocabulary', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const id = await newNote(ada);

      await ada
        .put(`/entities/${id}`)
        .send({
          document: bodyWithDescriptors('spouse', 'rival'),
          version: 1,
          tags: [],
        })
        .expect(200);
      await ada
        .put(`/entities/${id}`)
        .send({ document: bodyWithDescriptors('spouse'), version: 2, tags: [] })
        .expect(200);

      const res = await ada.get('/entities/descriptors').expect(200);
      expect(res.body).toEqual(['spouse']);
    });

    it('prunes an entity’s descriptors when the entity is deleted (cascade)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const id = await newNote(ada);

      await ada
        .put(`/entities/${id}`)
        .send({ document: bodyWithDescriptors('spouse'), version: 1, tags: [] })
        .expect(200);
      await ada.delete(`/entities/${id}`).expect(204);

      const res = await ada.get('/entities/descriptors').expect(200);
      expect(res.body).toEqual([]);
    });

    it('reflects last-saved state only: a stale-version 409 leaves the index untouched', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const id = await newNote(ada);

      await ada
        .put(`/entities/${id}`)
        .send({ document: bodyWithDescriptors('spouse'), version: 1, tags: [] })
        .expect(200);
      await ada
        .put(`/entities/${id}`)
        .send({ document: bodyWithDescriptors('rival'), version: 1, tags: [] })
        .expect(409);

      const res = await ada.get('/entities/descriptors').expect(200);
      expect(res.body).toEqual(['spouse']);
    });

    it('scopes the vocabulary to the owner', async () => {
      await seedUserWithWorld('bob@hexly.test', 'correct horse', 'Bob');
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const bob = await signIn('bob@hexly.test', 'correct horse');

      const adaNote = await newNote(ada);
      await ada
        .put(`/entities/${adaNote}`)
        .send({ document: bodyWithDescriptors('spouse'), version: 1, tags: [] })
        .expect(200);
      const bobNote = await newNote(bob);
      await bob
        .put(`/entities/${bobNote}`)
        .send({ document: bodyWithDescriptors('rival'), version: 1, tags: [] })
        .expect(200);

      expect((await ada.get('/entities/descriptors').expect(200)).body).toEqual(['spouse']);
      expect((await bob.get('/entities/descriptors').expect(200)).body).toEqual(['rival']);
    });
  });

  describe('tag vocabulary', () => {
    async function saveTags(agent: Awaited<ReturnType<typeof signIn>>, tags: string[], name = 'Lady A') {
      const created = await agent.post('/entities').send({ name, types: ['core.type.note'] });
      await agent
        .put(`/entities/${created.body.id}`)
        .send({ document: { 'core.field.content': emptyRichContent() }, version: 1, tags })
        .expect(200);
    }

    it('serves the owner’s DISTINCT tags, sorted, unioned across entities', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await saveTags(ada, ['ruined', 'deity'], 'A');
      await saveTags(ada, ['deity', 'northern reach'], 'B');

      const res = await ada.get('/entities/tags').expect(200);
      expect(res.body).toEqual(['deity', 'northern reach', 'ruined']);
    });

    it('scopes the vocabulary to the owner', async () => {
      await seedUserWithWorld('bob@hexly.test', 'correct horse', 'Bob');
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const bob = await signIn('bob@hexly.test', 'correct horse');
      await saveTags(ada, ['deity']);
      await saveTags(bob, ['ruined']);

      expect((await ada.get('/entities/tags').expect(200)).body).toEqual(['deity']);
      expect((await bob.get('/entities/tags').expect(200)).body).toEqual(['ruined']);
    });
  });

  describe('full-text search (ADR-0035)', () => {
    // A note whose RichContent prose carries `text`, saved at version 1.
    async function noteWithProse(agent: Awaited<ReturnType<typeof signIn>>, name: string, text: string) {
      const created = await agent.post('/entities').send({ name, types: ['core.type.note'] });
      const document = {
        'core.field.content': tiptapContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        }),
      };
      await agent.put(`/entities/${created.body.id}`).send({ document, version: 1, tags: [] }).expect(200);
      return created.body.id as string;
    }

    const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((e) => e.name).sort();

    it('matches an entity by a word inside its RichContent prose', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await noteWithProse(ada, 'Lady A', 'She rules the sunken citadel beneath the waves.');
      await noteWithProse(ada, 'Lord B', 'He commands the northern watchtowers.');

      const res = await ada.get('/entities').query({ q: 'citadel' }).expect(200);
      expect(names(res)).toEqual(['Lady A']);
    });

    /**
     * A **Field of a Structured Data Type**'s text feeds the same index the prose does (#205), so `core.datatype.hex-grid`
     * makes a Hex Map findable by what is painted on it — under the `q` the Browser already sends.
     */
    it('matches a Hex Map by one of its Hex names, and by one of its Region names', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const created = await ada.post('/entities').send({ name: 'The Reach', types: ['core.type.hex-map'] });
      await noteWithProse(ada, 'Decoy', 'A note that names no place at all.');
      const document = {
        'core.field.content': emptyRichContent(),
        'core.field.grid': {
          hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'grass', name: 'Ashford' } },
          regions: [{ id: 'r1', name: 'The Kingdom of Avalon', color: '#aabbcc', hexes: {} }],
          labels: [],
        },
      };
      await ada.put(`/entities/${created.body.id}`).send({ document, version: 1, tags: [] }).expect(200);

      expect(names(await ada.get('/entities').query({ q: 'Ashford' }).expect(200))).toEqual(['The Reach']);
      expect(names(await ada.get('/entities').query({ q: 'avalon' }).expect(200))).toEqual(['The Reach']);
    });

    it('matches by name, by tag, and by prose — all case-insensitively', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // Distinct match surfaces: one hit per query word, no cross-contamination.
      await ada.post('/entities').send({ name: 'Whisperwood', types: ['core.type.note'] }); // name
      const tagged = await ada.post('/entities').send({ name: 'Keep', types: ['core.type.note'] });
      await ada
        .put(`/entities/${tagged.body.id}`)
        .send({
          document: { 'core.field.content': emptyRichContent() },
          version: 1,
          tags: ['Deity'],
        })
        .expect(200);
      await noteWithProse(ada, 'Chronicle', 'The obelisk hums at midnight.'); // prose

      expect(names(await ada.get('/entities').query({ q: 'WHISPERWOOD' }).expect(200))).toEqual(['Whisperwood']);
      expect(names(await ada.get('/entities').query({ q: 'deity' }).expect(200))).toEqual(['Keep']);
      expect(names(await ada.get('/entities').query({ q: 'OBELISK' }).expect(200))).toEqual(['Chronicle']);
    });

    it('ranks results by bm25 relevance when a query is present', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // 'Dense' packs the term into a short doc; 'Sparse' buries one hit in a long
      // one — bm25 (more occurrences, shorter field) surfaces Dense first.
      await noteWithProse(ada, 'Dense', 'Dragon dragon dragon over the keep.');
      await noteWithProse(ada, 'Sparse', 'A lone dragon drifted past the long and winding northern coastline at dusk.');

      const res = await ada.get('/entities').query({ q: 'dragon' }).expect(200);
      expect(res.body.items.map((e: { name: string }) => e.name)).toEqual(['Dense', 'Sparse']);
    });

    it('ranks a name match above a body that only mentions the term (column weights)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // 'Dragon' matches on its name once; 'Bestiary' says dragon five times in its
      // body. Unweighted bm25 would float Bestiary up on raw frequency — the name
      // weight is what makes the entity *called* Dragon win.
      await ada.post('/entities').send({ name: 'Dragon', types: ['core.type.note'] });
      await noteWithProse(ada, 'Bestiary', 'dragon dragon dragon dragon dragon');

      const res = await ada.get('/entities').query({ q: 'dragon' }).expect(200);
      expect(res.body.items.map((e: { name: string }) => e.name)).toEqual(['Dragon', 'Bestiary']);
    });

    it('falls back to newest-first order when no query is given', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await ada.post('/entities').send({ name: 'First', types: ['core.type.note'] });
      const second = await ada.post('/entities').send({ name: 'Second', types: ['core.type.note'] });
      // Both POSTs can land in the same millisecond, tying updatedAt — then the sort
      // falls to its `id asc` cursor tiebreak (ADR-0025), a random UUID, and the order
      // of First/Second is a coin flip. Bump Second so it's unambiguously newest.
      db.update(entities)
        .set({ updatedAt: Date.now() + 1000 })
        .where(eq(entities.id, second.body.id))
        .run();

      // No q → updatedAt desc, id asc (ADR-0025).
      const res = await ada.get('/entities').expect(200);
      expect(res.body.items.map((e: { name: string }) => e.name)).toEqual(['Second', 'First']);
    });

    it('keeps the index fresh through create, edit, rename, and delete', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const found = async (q: string) => names(await ada.get('/entities').query({ q }).expect(200));

      // Create + first save → findable by its prose (INSERT/UPDATE triggers).
      const id = await noteWithProse(ada, 'Ledger', 'The alpha rune glows.');
      expect(await found('alpha')).toEqual(['Ledger']);

      // Edit RichContent → re-findable under the new text, gone under the old.
      await ada
        .put(`/entities/${id}`)
        .send({
          document: {
            'core.field.content': tiptapContent({
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'The beta rune fades.' }],
                },
              ],
            }),
          },
          version: 2,
          tags: [],
        })
        .expect(200);
      expect(await found('beta')).toEqual(['Ledger']);
      expect(await found('alpha')).toEqual([]);

      // Rename → findable under the new name (name is indexed).
      await ada.patch(`/entities/${id}`).send({ name: 'Gamma' }).expect(200);
      expect(await found('gamma')).toEqual(['Gamma']);

      // Delete → gone from results (DELETE trigger).
      await ada.delete(`/entities/${id}`).expect(204);
      expect(await found('beta')).toEqual([]);
      expect(await found('gamma')).toEqual([]);
    });

    it('does not reindex when a save touches only version/updated_at (guarded trigger)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const found = async (q: string) => names(await ada.get('/entities').query({ q }).expect(200));
      const id = await noteWithProse(ada, 'Vault', 'alpha rune');
      expect(await found('alpha')).toEqual(['Vault']);

      // Desync the FTS index out-of-band: drop the 'alpha' posting, add a 'ghost'
      // one. Now only the index disagrees with the column — the discriminator for
      // whether a reindex runs. (External-content delete needs the original values.)
      const raw = db.$client;
      const row = raw.prepare('SELECT rowid, name, tags, content_text AS ct FROM entities WHERE id = ?').get(id) as {
        rowid: number;
        name: string;
        tags: string;
        ct: string;
      };
      raw
        .prepare(`INSERT INTO entities_fts(entities_fts, rowid, name, tags, content_text) VALUES('delete', ?, ?, ?, ?)`)
        .run(row.rowid, row.name, row.tags, row.ct);
      raw
        .prepare('INSERT INTO entities_fts(rowid, name, tags, content_text) VALUES(?, ?, ?, ?)')
        .run(row.rowid, row.name, row.tags, 'ghost');
      expect(await found('ghost')).toEqual(['Vault']);
      expect(await found('alpha')).toEqual([]);

      // A version/updated_at-only write (name, tags, content_text all unchanged):
      // the guard's WHEN is false, so no reindex — the desync survives untouched.
      raw.prepare('UPDATE entities SET version = version + 1, updated_at = updated_at + 1 WHERE id = ?').run(id);

      // Guard held: the column's 'alpha' never re-entered the index.
      expect(await found('ghost')).toEqual(['Vault']);
      expect(await found('alpha')).toEqual([]);
    });

    it('keeps search scoped to one World when worldId is given', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const seeded = await noteWithProse(ada, 'In A', 'the meridian gate');
      const worldA = (await ada.get(`/entities/${seeded}`)).body.worldId;
      const worldB = await ada.post('/worlds').send({ name: 'Second' }).expect(201);
      const inB = await ada
        .post('/entities')
        .send({ name: 'In B', types: ['core.type.note'], worldId: worldB.body.id })
        .expect(201);
      await ada
        .put(`/entities/${inB.body.id}`)
        .send({
          document: {
            'core.field.content': tiptapContent({
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'the meridian road' }],
                },
              ],
            }),
          },
          version: 1,
          tags: [],
        })
        .expect(200);

      const res = await ada.get('/entities').query({ q: 'meridian', worldId: worldA }).expect(200);
      expect(names(res)).toEqual(['In A']);
    });

    it('paginates completely and without repeats over a filtered result set', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // Identical prose → bm25 ties, so the id tiebreak carries a stable page boundary.
      for (const n of ['N1', 'N2', 'N3', 'N4', 'N5']) {
        await noteWithProse(ada, n, 'the nexus stone');
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: {
          body: { items: { name: string }[]; nextCursor: string | null };
        } = await ada
          .get('/entities')
          .query({ q: 'nexus', limit: 2, ...(cursor ? { cursor } : {}) })
          .expect(200);
        seen.push(...res.body.items.map((e) => e.name));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);

      expect(seen.slice().sort()).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);
      expect(pages).toBe(3); // 5 matches at 2/page.
    });
  });

  describe('faceted filtering (#155)', () => {
    async function note(agent: Awaited<ReturnType<typeof signIn>>, name: string) {
      return (await agent.post('/entities').send({ name, types: ['core.type.note'] })).body.id as string;
    }
    // Tags ride the version-checked save (#72) — set them by saving.
    async function tag(agent: Awaited<ReturnType<typeof signIn>>, id: string, ...tags: string[]) {
      await agent
        .put(`/entities/${id}`)
        .send({ document: { 'core.field.content': emptyRichContent() }, version: 1, tags })
        .expect(200);
    }
    // No sharing UI ships with #155, so flip Visibility straight in the column.
    function share(id: string) {
      db.$client.prepare('UPDATE entities SET visibility = ? WHERE id = ?').run('shared', id);
    }
    const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((e) => e.name).sort();

    it('filters by a single tag', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const temple = await note(ada, 'Temple');
      const tavern = await note(ada, 'Tavern');
      await tag(ada, temple, 'deity');
      await tag(ada, tavern, 'mundane');

      const res = await ada.get('/entities').query({ tag: 'deity' }).expect(200);
      expect(names(res)).toEqual(['Temple']);
    });

    it('filters by visibility', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const open = await note(ada, 'Public Temple');
      await note(ada, 'Secret Vault');
      share(open);

      const res = await ada.get('/entities').query({ visibility: 'shared' }).expect(200);
      expect(names(res)).toEqual(['Public Temple']);
    });

    it('ORs multiple tags within the Tag facet', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const a = await note(ada, 'Temple');
      const b = await note(ada, 'Grove');
      const c = await note(ada, 'Tavern');
      await tag(ada, a, 'deity');
      await tag(ada, b, 'nature');
      await tag(ada, c, 'mundane');

      const res = await ada
        .get('/entities')
        .query({ tag: ['deity', 'nature'] })
        .expect(200);
      expect(names(res)).toEqual(['Grove', 'Temple']);
    });

    it('ANDs across categories and AND-s the whole facet filter with the text query', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // Target: a shared note tagged 'deity' whose name matches the query.
      const target = await note(ada, 'Temple of the Sun');
      await tag(ada, target, 'deity');
      share(target);
      // Decoys, each failing exactly one active constraint.
      const wrongType = (await ada.post('/entities').send({ name: 'Temple Map', types: ['core.type.hex-map'] })).body
        .id;
      await ada
        .put(`/entities/${wrongType}`)
        .send({ document: emptyHexmapBody, version: 1, tags: ['deity'] })
        .expect(200);
      share(wrongType);
      const wrongTag = await note(ada, 'Temple of Coin');
      await tag(ada, wrongTag, 'mundane');
      share(wrongTag);
      const wrongVisibility = await note(ada, 'Temple in the Dark');
      await tag(ada, wrongVisibility, 'deity'); // private, not shared
      const wrongQuery = await note(ada, 'Tavern'); // no 'temple' in name
      await tag(ada, wrongQuery, 'deity');
      share(wrongQuery);

      const res = await ada
        .get('/entities')
        .query({
          q: 'temple',
          type: 'core.type.note',
          tag: 'deity',
          visibility: 'shared',
        })
        .expect(200);
      expect(names(res)).toEqual(['Temple of the Sun']);
    });

    // Facet-count reads: `GET /entities/facets` returns each category's live
    // values with counts against the active filter state (drill-down).
    const byValue = (facet: { value: string; count: number }[]) =>
      [...facet].sort((a, b) => a.value.localeCompare(b.value));

    it('returns each facet’s values with live counts for the World', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const temple = await note(ada, 'Temple');
      await tag(ada, temple, 'deity');
      const grove = await note(ada, 'Grove');
      await tag(ada, grove, 'nature', 'deity');
      const worldId = (await ada.get(`/entities/${grove}`)).body.worldId;
      await ada.post('/entities').send({ name: 'Map', types: ['core.type.hex-map'] });
      share(temple);

      const res = await ada.get('/entities/facets').query({ worldId }).expect(200);

      // Temple + Grove = 2 notes; Map = 1 hexmap.
      expect(byValue(res.body.type)).toEqual([
        { value: 'core.type.hex-map', count: 1 },
        { value: 'core.type.note', count: 2 },
      ]);
      // Temple + Grove carry 'deity'; only Grove carries 'nature'.
      expect(byValue(res.body.tag)).toEqual([
        { value: 'deity', count: 2 },
        { value: 'nature', count: 1 },
      ]);
      // Temple is shared; Grove + Map stay private.
      expect(byValue(res.body.visibility)).toEqual([
        { value: 'private', count: 2 },
        { value: 'shared', count: 1 },
      ]);
    });

    it('drills counts down: a Type selection narrows Tag counts, omits zero, keeps sibling Types', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const temple = await note(ada, 'Temple');
      await tag(ada, temple, 'deity');
      const grove = await note(ada, 'Grove');
      await tag(ada, grove, 'nature');
      const worldId = (await ada.get(`/entities/${grove}`)).body.worldId;
      const battle = (await ada.post('/entities').send({ name: 'Battlemap', types: ['core.type.hex-map'] })).body.id;
      await ada
        .put(`/entities/${battle}`)
        .send({ document: emptyHexmapBody, version: 1, tags: ['combat'] })
        .expect(200);

      const res = await ada.get('/entities/facets').query({ worldId, type: 'core.type.note' }).expect(200);

      // Tag counts drill down to notes only: 'combat' (hexmap-only) drops to zero
      // and is omitted; 'deity'/'nature' remain.
      expect(byValue(res.body.tag)).toEqual([
        { value: 'deity', count: 1 },
        { value: 'nature', count: 1 },
      ]);
      // The Type facet ignores its own active selection, so it still lists the
      // sibling 'hexmap' you could switch to (each narrowed by everything else).
      expect(byValue(res.body.type)).toEqual([
        { value: 'core.type.hex-map', count: 1 },
        { value: 'core.type.note', count: 2 },
      ]);
    });

    it('drills facet counts down by the text query combined with a Type selection', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const keep = await note(ada, 'Aldermoor Keep');
      await tag(ada, keep, 'deity');
      const grove = await note(ada, 'Grove');
      await tag(ada, grove, 'nature');
      const worldId = (await ada.get(`/entities/${grove}`)).body.worldId;
      // A hexmap also matching the query — counted by the Type facet, drilled out of Tag counts.
      await ada.post('/entities').send({ name: 'Aldermoor Map', types: ['core.type.hex-map'] });

      const res = await ada
        .get('/entities/facets')
        .query({ worldId, q: 'aldermoor', type: 'core.type.note' })
        .expect(200);

      // Tag counts narrow to query-matching notes: 'nature' (Grove misses the query) drops out.
      expect(byValue(res.body.tag)).toEqual([{ value: 'deity', count: 1 }]);
      // The Type facet drops its own selection but keeps the query: both Aldermoor entities.
      expect(byValue(res.body.type)).toEqual([
        { value: 'core.type.hex-map', count: 1 },
        { value: 'core.type.note', count: 1 },
      ]);
    });

    // SQLite (no ANALYZE stats) flips the join order when a positive `json_each` EXISTS predicate
    // (a Type selection) rides next to a MATCH-joined `entities_fts`, degrading the match into a
    // probe per World row — seconds on a real World. The rowid-IN subquery pins one evaluation;
    // this locks that plan shape at the engine seam, since a timing assertion would be flaky.
    it('evaluates the text query once per facet count, never as a per-row probe', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const keep = await note(ada, 'Aldermoor Keep');
      const worldId = (await ada.get(`/entities/${keep}`)).body.worldId;

      const captured: string[] = [];
      const client = db.$client;
      const original = client.prepare.bind(client);
      vi.spyOn(client, 'prepare').mockImplementation(((source: string) => {
        captured.push(source);
        return original(source);
      }) as typeof client.prepare);

      await ada.get('/entities/facets').query({ worldId, q: 'alder', type: 'core.type.note' }).expect(200);
      vi.restoreAllMocks();

      const ftsQueries = captured.filter((source) => source.includes('entities_fts'));
      expect(ftsQueries.length).toBeGreaterThan(0);
      for (const source of ftsQueries) {
        const params = Array((source.match(/\?/g) ?? []).length).fill('x');
        const plan = original(`EXPLAIN QUERY PLAN ${source}`).all(...params) as { detail: string }[];
        // An `:=M` FTS index detail is a rowid-constrained MATCH probe inside an outer loop.
        expect(plan.filter((row) => row.detail.includes('entities_fts') && row.detail.includes(':=M'))).toEqual([]);
      }
    });

    it('keeps facet counts owner- and World-scoped', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const adaNote = await note(ada, 'Ada Temple');
      await tag(ada, adaNote, 'deity');
      const worldA = (await ada.get(`/entities/${adaNote}`)).body.worldId;
      // Ada's second World — its tags must not bleed into worldA's counts.
      const worldB = (await ada.post('/worlds').send({ name: 'Second' }).expect(201)).body.id;
      const inB = (await ada.post('/entities').send({ name: 'B Temple', types: ['core.type.note'], worldId: worldB }))
        .body.id;
      await ada
        .put(`/entities/${inB}`)
        .send({
          document: { 'core.field.content': emptyRichContent() },
          version: 1,
          tags: ['otherworld'],
        })
        .expect(200);
      // Another owner's entity in a like-named tag — never counted for Ada.
      await seedUserWithWorld('bob@hexly.test', 'battery staple', 'Bob');
      const bob = await signIn('bob@hexly.test', 'battery staple');
      const bobNote = await note(bob, 'Bob Temple');
      await tag(bob, bobNote, 'deity');

      const res = await ada.get('/entities/facets').query({ worldId: worldA }).expect(200);
      // Only worldA's tags: 'deity' from Ada Temple, count 1 — not Bob's, not worldB's.
      expect(byValue(res.body.tag)).toEqual([{ value: 'deity', count: 1 }]);
    });

    it('paginates completely and without repeats under a facet filter', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      for (const n of ['N1', 'N2', 'N3', 'N4', 'N5']) {
        await tag(ada, await note(ada, n), 'deity');
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: {
          body: { items: { name: string }[]; nextCursor: string | null };
        } = await ada
          .get('/entities')
          .query({ tag: 'deity', limit: 2, ...(cursor ? { cursor } : {}) })
          .expect(200);
        seen.push(...res.body.items.map((e) => e.name));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);

      expect(seen.slice().sort()).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);
      expect(pages).toBe(3); // 5 matches at 2/page.
    });
  });

  /**
   * "Everything except the drafts", said on the wire (ADR-0081, #421): a Facet value is neutral,
   * **included** or **excluded**, and an exclusion **vetoes**. Asserted at the HTTP seam because the
   * whole point is that the params carry it — schema, predicate and drill-down in one pass.
   */
  describe('Facet exclusion, the excluding half of each category (ADR-0081, #421)', () => {
    async function note(agent: Awaited<ReturnType<typeof signIn>>, name: string, worldId?: string) {
      return (await agent.post('/entities').send({ name, types: ['core.type.note'], ...(worldId ? { worldId } : {}) }))
        .body.id as string;
    }
    async function tag(agent: Awaited<ReturnType<typeof signIn>>, id: string, ...tags: string[]) {
      await agent
        .put(`/entities/${id}`)
        .send({ document: { 'core.field.content': emptyRichContent() }, version: 1, tags })
        .expect(200);
    }
    async function hexmap(agent: Awaited<ReturnType<typeof signIn>>, name: string, ...tags: string[]) {
      const id = (await agent.post('/entities').send({ name, types: ['core.type.hex-map'] })).body.id as string;
      await agent.put(`/entities/${id}`).send({ document: emptyHexmapBody, version: 1, tags }).expect(200);
      return id;
    }
    function share(id: string) {
      db.$client.prepare('UPDATE entities SET visibility = ? WHERE id = ?').run('shared', id);
    }
    const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((e) => e.name).sort();
    const byValue = (facet: { value: string; count: number }[]) =>
      [...facet].sort((a, b) => a.value.localeCompare(b.value));

    /** Temple (deity), Grove (nature), Battlemap (a hex-map, tagged combat). Temple alone is shared. */
    async function seedThree(agent: Awaited<ReturnType<typeof signIn>>) {
      const temple = await note(agent, 'Temple');
      await tag(agent, temple, 'deity');
      const grove = await note(agent, 'Grove');
      await tag(agent, grove, 'nature');
      await hexmap(agent, 'Battlemap', 'combat');
      share(temple);
      return { temple, worldId: (await agent.get(`/entities/${grove}`)).body.worldId as string };
    }

    it('excludes a Type, a Tag and a Visibility, singly and repeated', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await seedThree(ada);

      expect(names(await ada.get('/entities').query({ excludeType: 'core.type.hex-map' }).expect(200))).toEqual([
        'Grove',
        'Temple',
      ]);
      expect(names(await ada.get('/entities').query({ excludeTag: 'deity' }).expect(200))).toEqual([
        'Battlemap',
        'Grove',
      ]);
      expect(names(await ada.get('/entities').query({ excludeVisibility: 'shared' }).expect(200))).toEqual([
        'Battlemap',
        'Grove',
      ]);
      // Repeated: excludes accumulate within a category, so each named value is vetoed.
      expect(
        names(
          await ada
            .get('/entities')
            .query({ excludeTag: ['deity', 'combat'] })
            .expect(200),
        ),
      ).toEqual(['Grove']);
    });

    it('carries the same per-value validation as its positive twin (400, not a silent no-filter)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await ada.get('/entities').query({ excludeType: 'spreadsheet' }).expect(400);
      await ada.get('/entities').query({ excludeVisibility: 'public' }).expect(400);
      await ada.get('/entities/facets').query({ excludeType: 'spreadsheet' }).expect(400);
    });

    it('vetoes: naming one value both included and excluded yields nothing', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await seedThree(ada);

      expect(names(await ada.get('/entities').query({ tag: 'deity', excludeTag: 'deity' }).expect(200))).toEqual([]);
      expect(
        names(await ada.get('/entities').query({ type: 'core.type.note', excludeType: 'core.type.note' }).expect(200)),
      ).toEqual([]);
      expect(
        names(await ada.get('/entities').query({ visibility: 'shared', excludeVisibility: 'shared' }).expect(200)),
      ).toEqual([]);
    });

    it('accumulates exclusions across categories, and beside an unrelated include', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await seedThree(ada);

      // Across categories: no hex-map, nothing tagged deity — Grove alone survives both.
      expect(
        names(await ada.get('/entities').query({ excludeType: 'core.type.hex-map', excludeTag: 'deity' }).expect(200)),
      ).toEqual(['Grove']);
      // Beside an include of another category: the include narrows, the exclusion still vetoes.
      expect(
        names(await ada.get('/entities').query({ type: 'core.type.note', excludeTag: 'nature' }).expect(200)),
      ).toEqual(['Temple']);
    });

    it('leaves an Entity carrying no value for the category untouched by that category’s exclusion', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await seedThree(ada);
      await note(ada, 'Loose Leaf'); // never saved with tags — carries none at all

      // Exclusion is a not-exists test, so the Entity with no Tag at all is not hidden by a Tag exclusion.
      expect(names(await ada.get('/entities').query({ excludeTag: 'deity' }).expect(200))).toEqual([
        'Battlemap',
        'Grove',
        'Loose Leaf',
      ]);
    });

    it('counts a category with its own selection dropped in both polarities, every sibling kept', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const { worldId } = await seedThree(ada);

      const res = await ada.get('/entities/facets').query({ worldId, excludeTag: 'deity' }).expect(200);
      // The Tag facet drops its own exclusion before counting, so the excluded value is still listed —
      // and so the exclusion is reversible by clicking it off (ADR-0081).
      expect(byValue(res.body.tag)).toEqual([
        { value: 'combat', count: 1 },
        { value: 'deity', count: 1 },
        { value: 'nature', count: 1 },
      ]);
      // Every sibling category keeps the exclusion: Temple is gone from the Type and Visibility counts.
      expect(byValue(res.body.type)).toEqual([
        { value: 'core.type.hex-map', count: 1 },
        { value: 'core.type.note', count: 1 },
      ]);
      expect(byValue(res.body.visibility)).toEqual([{ value: 'private', count: 2 }]);
    });

    it('drops a Type exclusion when counting Types, and keeps it everywhere else', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const { worldId } = await seedThree(ada);

      const res = await ada.get('/entities/facets').query({ worldId, excludeType: 'core.type.note' }).expect(200);
      expect(byValue(res.body.type)).toEqual([
        { value: 'core.type.hex-map', count: 1 },
        { value: 'core.type.note', count: 2 },
      ]);
      // The Tag facet counts under the Type exclusion: only the hex-map's tag survives.
      expect(byValue(res.body.tag)).toEqual([{ value: 'combat', count: 1 }]);
    });

    it('excludes a Container inside a cross-Container scope, and still lists it on the rail', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const here = await note(ada, 'Home Note');
      const worldA = (await ada.get(`/entities/${here}`)).body.worldId as string;
      const worldB = (await ada.post('/worlds').send({ name: 'Second' }).expect(201)).body.id as string;
      await note(ada, 'Away Note', worldB);

      const scope = { containerId: [worldA, worldB] };
      expect(names(await ada.get('/entities').query(scope).expect(200))).toEqual(['Away Note', 'Home Note']);
      expect(
        names(
          await ada
            .get('/entities')
            .query({ ...scope, excludeContainer: worldB })
            .expect(200),
        ),
      ).toEqual(['Home Note']);

      const facets = await ada
        .get('/entities/facets')
        .query({ ...scope, excludeContainer: worldB })
        .expect(200);
      // Drill-down: the Container facet drops its own exclusion, so the excluded Container is still
      // there to click back on, counted over the whole scope.
      expect((facets.body.container as { value: string; count: number }[]).map((c) => c.value).sort()).toEqual(
        [worldA, worldB].sort(),
      );
      // The sibling categories keep it: only worldA's note is counted.
      expect(byValue(facets.body.type)).toEqual([{ value: 'core.type.note', count: 1 }]);
    });

    it('leaves the envelope, the cursor and every pre-existing param untouched under an exclusion', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      for (const n of ['N1', 'N2', 'N3', 'N4', 'N5']) await tag(ada, await note(ada, n), 'keep');
      await tag(ada, await note(ada, 'Draft'), 'draft');

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: { body: { items: { name: string; id: string }[]; nextCursor: string | null } } = await ada
          .get('/entities')
          .query({ excludeTag: 'draft', limit: 2, ...(cursor ? { cursor } : {}) })
          .expect(200);
        // The envelope is still exactly `{ items, nextCursor }` (ADR-0025).
        expect(Object.keys(res.body).sort()).toEqual(['items', 'nextCursor']);
        seen.push(...res.body.items.map((e) => e.name));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);

      expect(seen.slice().sort()).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);
      expect(pages).toBe(3); // 5 survivors at 2/page — the excluded row never enters the paging.
    });
  });

  /**
   * The hidden-from-default-listing capability (ADR-0065) end to end. Exercised through a *test* type that
   * declares it, never the asset type: the rule is generic, and the asset type is only its first taker.
   */
  describe('hidden-from-default-listing types (ADR-0065)', () => {
    beforeEach(() => {
      app.get(TypeFieldRegistry).register('test.type.hidden', [], 'Hidden', { hiddenFromDefaultListing: true });
    });

    async function hidden(agent: Awaited<ReturnType<typeof signIn>>, name: string) {
      const res = await agent
        .post('/entities')
        .send({ name, types: ['test.type.hidden'] })
        .expect(201);
      return res.body.id as string;
    }
    async function ordinary(agent: Awaited<ReturnType<typeof signIn>>, name: string) {
      const res = await agent
        .post('/entities')
        .send({ name, types: ['core.type.note'] })
        .expect(201);
      return res.body.id as string;
    }
    const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((e) => e.name).sort();
    const order = (res: { body: { items: { name: string }[] } }) => res.body.items.map((e) => e.name);

    it('excludes a hidden type from the default listing, leaving ordinary Entities untouched', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await hidden(ada, 'Sigil art');
      await ordinary(ada, 'Aldermoor');

      expect(names(await ada.get('/entities').expect(200))).toEqual(['Aldermoor']);
    });

    /** The regression this exists for: a name search is part of the listing, so it lifts nothing. */
    it('keeps a hidden type out of a name search — the browser’s search box is still the listing', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await hidden(ada, 'Aldermoor sigil');
      await ordinary(ada, 'Aldermoor Keep');

      expect(names(await ada.get('/entities').query({ q: 'aldermoor' }).expect(200))).toEqual(['Aldermoor Keep']);
    });

    it('surfaces a hidden type in a name search when the caller opts in (includeHidden)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await hidden(ada, 'Aldermoor sigil');
      await ordinary(ada, 'Aldermoor Keep');

      const res = await ada.get('/entities').query({ q: 'aldermoor', includeHidden: '1' }).expect(200);
      expect(names(res)).toEqual(['Aldermoor Keep', 'Aldermoor sigil']);
    });

    /**
     * The ranking tier: 'Aldermoor' is the tighter bm25 match (an exact, shorter name), so relevance alone
     * would float the hidden Entity to the top of the picker — above the Entity it illustrates.
     */
    it('ranks a hidden-typed match below an ordinary one, however much better it matches', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await hidden(ada, 'Aldermoor');
      await ordinary(ada, 'Aldermoor Keep and the long road east');

      const res = await ada.get('/entities').query({ q: 'aldermoor', includeHidden: '1' }).expect(200);
      expect(order(res)).toEqual(['Aldermoor Keep and the long road east', 'Aldermoor']);
    });

    it('surfaces a hidden type once its own type is selected in the type facet', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await hidden(ada, 'Sigil art');
      await ordinary(ada, 'Aldermoor');

      const res = await ada.get('/entities').query({ type: 'test.type.hidden' }).expect(200);
      expect(names(res)).toEqual(['Sigil art']);
    });

    it('resolves a hidden type by id — an id lookup is no listing (pins, the redirect guard)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const id = await hidden(ada, 'Sigil art');

      const res = await ada
        .get('/entities')
        .query({ ids: [id] })
        .expect(200);
      expect(names(res)).toEqual(['Sigil art']);
    });

    it('counts a hidden type in the type facet but in no sibling category, search or not', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const sigil = await hidden(ada, 'Aldermoor sigil');
      await ada
        .put(`/entities/${sigil}`)
        .send({ document: {}, version: 1, tags: ['heraldry'] })
        .expect(200);
      await ordinary(ada, 'Aldermoor Keep');
      const worldId = (await ada.get(`/entities/${sigil}`)).body.worldId;

      // The type facet is the opt-in surface, so it counts the hidden type over the full universe.
      const facets = await ada.get('/entities/facets').query({ worldId }).expect(200);
      const types = facets.body.type as { value: string; count: number }[];
      expect(types.find((t) => t.value === 'test.type.hidden')).toEqual({ value: 'test.type.hidden', count: 1 });
      // Its Tag is not counted: the sibling categories annotate the listing, which excludes it.
      expect(facets.body.tag).toEqual([]);

      // Same under a name search — the exclusion no longer lifts on either side, so the rail still agrees.
      const searched = await ada.get('/entities/facets').query({ worldId, q: 'aldermoor' }).expect(200);
      expect(searched.body.tag).toEqual([]);
    });

    it('lets a rail opt in alongside its list, so counts and results agree (includeHidden)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const sigil = await hidden(ada, 'Aldermoor sigil');
      await ada
        .put(`/entities/${sigil}`)
        .send({ document: {}, version: 1, tags: ['heraldry'] })
        .expect(200);
      const worldId = (await ada.get(`/entities/${sigil}`)).body.worldId;

      const facets = await ada.get('/entities/facets').query({ worldId, includeHidden: '1' }).expect(200);
      expect(facets.body.tag).toEqual([{ value: 'heraldry', count: 1 }]);
    });
  });

  describe('Field facets by presence + filter-by-Field (#188, #231)', () => {
    // A plugin-style type declaring two facetable Fields — an enum and a number — plus a
    // non-facetable one, registered the same way a bundled plugin (or a World-defined type) would.
    beforeEach(() => {
      registerType(app.get(TypeFieldRegistry), 'test.type.beast', [
        defineField({
          id: 'test.field.alignment',
          label: 'Alignment',
          dataType: { kind: 'enum', options: ['lawful-good', 'chaotic-evil'] },
          facetable: true,
        }),
        defineField({
          id: 'test.field.cr',
          label: 'Challenge Rating',
          dataType: { kind: 'number' },
          facetable: true,
        }),
        defineField({
          id: 'test.field.discovered',
          label: 'Discovered',
          dataType: { kind: 'date' },
          facetable: true,
        }),
        defineField({
          id: 'test.field.senses',
          label: 'Senses',
          dataType: { kind: 'list', of: { kind: 'string' } },
          facetable: true,
        }),
        // Declared but not facetable — never surfaces as a Field facet.
        defineField({
          id: 'test.field.secret',
          label: 'Secret',
          dataType: { kind: 'string' },
          facetable: false,
        }),
      ]);
    });

    // Create a beast Entity carrying typed EntityDocument: a typed save (`types: ['test.type.beast']`) is the
    // active edit that both satisfies the forward-only gate and materialises the Field facets.
    async function beast(agent: Awaited<ReturnType<typeof signIn>>, name: string, metadata: Record<string, unknown>) {
      const created = await agent.post('/entities').send({ name, types: ['core.type.note'] });
      await agent
        .put(`/entities/${created.body.id}`)
        .send({
          document: { 'core.field.content': emptyRichContent(), ...metadata },
          version: 1,
          tags: [],
          types: ['test.type.beast'],
        })
        .expect(200);
      return created.body.id as string;
    }

    const byValue = (facet: { value: string; count: number }[]) =>
      [...facet].sort((a, b) => a.value.localeCompare(b.value));
    const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((e) => e.name).sort();

    type FieldFacetBody = {
      key: string;
      label: string;
      dataType: { kind: string };
      values: { value: string; count: number }[];
    };

    it('surfaces a facetable Field by presence in the result set, no active Type filter needed (#231)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const kobold = await beast(ada, 'Kobold', {
        'test.field.alignment': 'lawful-good',
        'test.field.cr': 1,
        'test.field.secret': 'hidden',
      });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      // No active Type filter: Field facets surface by presence, universal facets present as always.
      const res = await ada.get('/entities/facets').query({ worldId }).expect(200);
      const fields = res.body.fields as FieldFacetBody[];
      // Only Fields the result set carries values for surface — `discovered`/`senses` are declared
      // facetable but unset, so they never appear; the non-facetable `secret` never appears either.
      expect(fields.map((f) => f.key).sort()).toEqual(['test.field.alignment', 'test.field.cr']);
      const alignment = fields.find((f) => f.key === 'test.field.alignment')!;
      expect(alignment.label).toBe('Alignment');
      expect(alignment.dataType).toEqual({ kind: 'enum', options: ['lawful-good', 'chaotic-evil'] });
      expect(byValue(alignment.values)).toEqual([
        { value: 'chaotic-evil', count: 1 },
        { value: 'lawful-good', count: 1 },
      ]);
      expect(res.body.type.length).toBeGreaterThan(0);
      expect(res.body).toHaveProperty('tag');
      expect(res.body).toHaveProperty('visibility');
    });

    it('surfaces one Field facet across the whole browse, whatever types its entities hold (#231)', async () => {
      // A second type reusing the same `alignment` Field (ADR-0054): its Entities carry the key too.
      registerType(app.get(TypeFieldRegistry), 'test.type.spirit', [
        defineField({
          id: 'test.field.alignment',
          label: 'Alignment',
          dataType: { kind: 'enum', options: ['lawful-good', 'chaotic-evil'] },
          facetable: true,
        }),
      ]);
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const kobold = await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;
      // A spirit (a different type) carrying the same Field, saved as an active typed edit.
      const spirit = await ada.post('/entities').send({ name: 'Wisp', types: ['core.type.note'] });
      await ada
        .put(`/entities/${spirit.body.id}`)
        .send({
          document: { 'core.field.content': emptyRichContent(), 'test.field.alignment': 'lawful-good' },
          version: 1,
          tags: [],
          types: ['test.type.spirit'],
        })
        .expect(200);

      // No Type filter: the single `alignment` facet counts both types' Entities together.
      const res = await ada.get('/entities/facets').query({ worldId }).expect(200);
      const alignment = (res.body.fields as FieldFacetBody[]).find((f) => f.key === 'test.field.alignment')!;
      expect(alignment).toBeDefined();
      expect(byValue(alignment.values)).toEqual([{ value: 'lawful-good', count: 2 }]);
    });

    it('keeps an actively-filtered Field on the rail even when its selected value matches nothing (drill-down)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const kobold = await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 11 });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      // Filter to a value no Entity carries: like the universal facets, `alignment` drops its own filter
      // when counting, so it stays on the rail listing the value you *could* switch to — not vanishing.
      const res = await ada
        .get('/entities/facets')
        .query({ worldId, field: 'test.field.alignment:eq:chaotic-evil' })
        .expect(200);
      const alignment = (res.body.fields as FieldFacetBody[]).find((f) => f.key === 'test.field.alignment')!;
      expect(alignment).toBeDefined();
      expect(byValue(alignment.values)).toEqual([{ value: 'lawful-good', count: 2 }]);
    });

    it('filters the list by an enum Field value (membership)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });

      const res = await ada
        .get('/entities')
        .query({ type: 'test.type.beast', field: 'test.field.alignment:eq:lawful-good' })
        .expect(200);
      expect(names(res)).toEqual(['Kobold']);
    });

    it('ORs multiple values within one enum Field', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 11 });

      const res = await ada
        .get('/entities')
        .query({
          type: 'test.type.beast',
          field: ['test.field.alignment:eq:chaotic-evil', 'test.field.alignment:eq:lawful-good'],
        })
        .expect(200);
      expect(names(res)).toEqual(['Aboleth', 'Kobold', 'Sphinx']);
    });

    // Field exclusion is a fourth op in this grammar, not a fifth param (ADR-0081, #421).
    it('excludes an enum Field value with `neq`, accumulating across values', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 11 });

      const one = await ada
        .get('/entities')
        .query({ type: 'test.type.beast', field: 'test.field.alignment:neq:lawful-good' })
        .expect(200);
      expect(names(one)).toEqual(['Aboleth']);

      // Exclusions AND with each other, so naming both values leaves nothing carrying either.
      const both = await ada
        .get('/entities')
        .query({
          type: 'test.type.beast',
          field: ['test.field.alignment:neq:lawful-good', 'test.field.alignment:neq:chaotic-evil'],
        })
        .expect(200);
      expect(names(both)).toEqual([]);
    });

    it('lets a `neq` veto an `eq` on the same key, and accumulates across keys', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 11 });

      // The same value included and excluded is a contradiction, and yields nothing.
      const contradiction = await ada
        .get('/entities')
        .query({
          type: 'test.type.beast',
          field: ['test.field.alignment:eq:lawful-good', 'test.field.alignment:neq:lawful-good'],
        })
        .expect(200);
      expect(names(contradiction)).toEqual([]);

      // Across keys: the include narrows, the other key's exclusion vetoes on top of it.
      const across = await ada
        .get('/entities')
        .query({
          type: 'test.type.beast',
          field: ['test.field.alignment:eq:lawful-good', 'test.field.cr:neq:11'],
        })
        .expect(200);
      expect(names(across)).toEqual(['Kobold']);
    });

    it('leaves an Entity carrying no value for the key untouched by that key’s `neq` (absence survives)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 11 });
      // A plain Note: it has never had a Challenge Rating, so no exclusion of one can be about it.
      await ada
        .post('/entities')
        .send({ name: 'Loose Leaf', types: ['core.type.note'] })
        .expect(201);

      // No Type narrowing — that is the caller's to state, and they have not (ADR-0081).
      const res = await ada.get('/entities').query({ field: 'test.field.cr:neq:1' }).expect(200);
      expect(names(res)).toEqual(['Loose Leaf', 'Sphinx']);
    });

    it('drops a Field’s own `neq` when counting it, so the exclusion stays reversible', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const kobold = await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      const res = await ada
        .get('/entities/facets')
        .query({ worldId, field: 'test.field.alignment:neq:lawful-good' })
        .expect(200);
      const fields = res.body.fields as FieldFacetBody[];
      // Its own facet drops both polarities, so the excluded value is still on the rail to click off...
      expect(byValue(fields.find((f) => f.key === 'test.field.alignment')!.values)).toEqual([
        { value: 'chaotic-evil', count: 1 },
        { value: 'lawful-good', count: 1 },
      ]);
      // ...while a sibling Field counts under the exclusion: only the Aboleth's CR survives.
      expect(byValue(fields.find((f) => f.key === 'test.field.cr')!.values)).toEqual([{ value: '10', count: 1 }]);
    });

    it('still drops an unrecognised op rather than rejecting it, so an old build degrades to no-filter', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });

      const res = await ada
        .get('/entities')
        .query({ type: 'test.type.beast', field: 'test.field.alignment:between:lawful-good' })
        .expect(200);
      expect(names(res)).toEqual(['Aboleth', 'Kobold']);
    });

    it('filters the list by a numeric Field range, comparing as a number not a string', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 5 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });

      // cr >= 5: a string compare would drop '10' (< '5' lexically); the numeric `num` keeps it.
      const gte = await ada
        .get('/entities')
        .query({ type: 'test.type.beast', field: 'test.field.cr:gte:5' })
        .expect(200);
      expect(names(gte)).toEqual(['Aboleth', 'Sphinx']);

      // A bounded range ANDs the two bounds.
      const range = await ada
        .get('/entities')
        .query({ type: 'test.type.beast', field: ['test.field.cr:gte:5', 'test.field.cr:lte:9'] })
        .expect(200);
      expect(names(range)).toEqual(['Sphinx']);
    });

    it('filters the list by a strict numeric bound, which excludes the bound itself', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 5 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });

      // cr > 5 drops the Sphinx that `gte` kept, and a string compare would drop the Aboleth's '10'.
      const gt = await ada.get('/entities').query({ type: 'test.type.beast', field: 'test.field.cr:gt:5' }).expect(200);
      expect(names(gt)).toEqual(['Aboleth']);

      const lt = await ada.get('/entities').query({ type: 'test.type.beast', field: 'test.field.cr:lt:5' }).expect(200);
      expect(names(lt)).toEqual(['Kobold']);

      // Strict bounds AND into an open range, as the inclusive ones do.
      const range = await ada
        .get('/entities')
        .query({ type: 'test.type.beast', field: ['test.field.cr:gt:1', 'test.field.cr:lt:10'] })
        .expect(200);
      expect(names(range)).toEqual(['Sphinx']);
    });

    it('filters the list by a strict date bound (lexical ISO compare)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.cr': 1, 'test.field.discovered': '2020-01-01' });
      await beast(ada, 'Sphinx', { 'test.field.cr': 11, 'test.field.discovered': '2023-06-15' });

      const res = await ada
        .get('/entities')
        .query({ type: 'test.type.beast', field: 'test.field.discovered:gt:2020-01-01' })
        .expect(200);
      expect(names(res)).toEqual(['Sphinx']);
    });

    it('filters the list by list-membership on a list Field', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', {
        'test.field.alignment': 'lawful-good',
        'test.field.cr': 1,
        'test.field.senses': ['darkvision'],
      });
      await beast(ada, 'Aboleth', {
        'test.field.alignment': 'chaotic-evil',
        'test.field.cr': 10,
        'test.field.senses': ['darkvision', 'truesight'],
      });
      await beast(ada, 'Sphinx', {
        'test.field.alignment': 'lawful-good',
        'test.field.cr': 11,
        'test.field.senses': ['truesight'],
      });

      // Membership matches any Entity whose list contains the value.
      const res = await ada
        .get('/entities')
        .query({ type: 'test.type.beast', field: 'test.field.senses:eq:truesight' })
        .expect(200);
      expect(names(res)).toEqual(['Aboleth', 'Sphinx']);
    });

    it('filters the list by a date Field range (lexical ISO compare)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', {
        'test.field.alignment': 'lawful-good',
        'test.field.cr': 1,
        'test.field.discovered': '2020-01-01',
      });
      await beast(ada, 'Sphinx', {
        'test.field.alignment': 'lawful-good',
        'test.field.cr': 11,
        'test.field.discovered': '2023-06-15',
      });
      await beast(ada, 'Aboleth', {
        'test.field.alignment': 'chaotic-evil',
        'test.field.cr': 10,
        'test.field.discovered': '2026-12-31',
      });

      const res = await ada
        .get('/entities')
        .query({
          type: 'test.type.beast',
          field: ['test.field.discovered:gte:2022-01-01', 'test.field.discovered:lte:2025-01-01'],
        })
        .expect(200);
      expect(names(res)).toEqual(['Sphinx']);
    });

    it('surfaces the date and list Field facets with their data-type for the rail’s control', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const kobold = await beast(ada, 'Kobold', {
        'test.field.alignment': 'lawful-good',
        'test.field.cr': 1,
        'test.field.discovered': '2020-01-01',
        'test.field.senses': ['darkvision', 'truesight'],
      });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      const res = await ada.get('/entities/facets').query({ worldId, type: 'test.type.beast' }).expect(200);
      const fields = res.body.fields as {
        key: string;
        dataType: { kind: string };
        values: { value: string; count: number }[];
      }[];
      expect(fields.find((f) => f.key === 'test.field.discovered')!.dataType).toEqual({
        kind: 'date',
      });
      // A list Field explodes to one facet value per item.
      expect(byValue(fields.find((f) => f.key === 'test.field.senses')!.values).map((v) => v.value)).toEqual([
        'darkvision',
        'truesight',
      ]);
    });

    it('ANDs a Field filter across different keys and with the universal facets', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await beast(ada, 'Kobold', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 1 });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 11 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });

      const res = await ada
        .get('/entities')
        .query({
          type: 'test.type.beast',
          field: ['test.field.alignment:eq:lawful-good', 'test.field.cr:gte:5'],
        })
        .expect(200);
      expect(names(res)).toEqual(['Sphinx']);
    });

    it('drills Field-facet value counts down against the other active constraints', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const kobold = await beast(ada, 'Kobold', {
        'test.field.alignment': 'lawful-good',
        'test.field.cr': 1,
      });
      await beast(ada, 'Sphinx', { 'test.field.alignment': 'lawful-good', 'test.field.cr': 11 });
      await beast(ada, 'Aboleth', { 'test.field.alignment': 'chaotic-evil', 'test.field.cr': 10 });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      const res = await ada
        .get('/entities/facets')
        .query({ worldId, type: 'test.type.beast', field: 'test.field.cr:gte:5' })
        .expect(200);
      const fields = res.body.fields as {
        key: string;
        values: { value: string; count: number }[];
      }[];
      // The `alignment` facet is narrowed by the active `cr >= 5`: only Sphinx + Aboleth qualify.
      expect(byValue(fields.find((f) => f.key === 'test.field.alignment')!.values)).toEqual([
        { value: 'chaotic-evil', count: 1 },
        { value: 'lawful-good', count: 1 },
      ]);
      // But the `cr` facet ignores its own filter (drill-down), so it still lists every value.
      expect(byValue(fields.find((f) => f.key === 'test.field.cr')!.values)).toEqual([
        { value: '1', count: 1 },
        { value: '10', count: 1 },
        { value: '11', count: 1 },
      ]);
    });

    it('recomputes Field facets on the shared derive path so a re-save keeps them fresh', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const id = await beast(ada, 'Kobold', {
        'test.field.alignment': 'lawful-good',
        'test.field.cr': 1,
      });
      const worldId = (await ada.get(`/entities/${id}`)).body.worldId;

      // Re-save with a changed Field value: the materialised facet follows (self-pruning replace).
      await ada
        .put(`/entities/${id}`)
        .send({
          document: {
            'core.field.content': emptyRichContent(),
            'test.field.alignment': 'chaotic-evil',
            'test.field.cr': 7,
          },
          version: 2,
          tags: [],
          types: ['test.type.beast'],
        })
        .expect(200);

      const res = await ada.get('/entities/facets').query({ worldId, type: 'test.type.beast' }).expect(200);
      const alignment = (res.body.fields as { key: string; values: { value: string }[] }[]).find(
        (f) => f.key === 'test.field.alignment',
      )!;
      expect(alignment.values.map((v) => v.value)).toEqual(['chaotic-evil']);
    });
  });

  describe('Harvested facet dimensions surface as Facets (#235, ADR-0055)', () => {
    // A fixture harvesting Structured Data Type — no D&D dependency, so this ticket verifies on its own.
    // Its `fx_*` dimension keys are fixture-only so they claim keys no bundled plugin Field holds: a
    // dimension surfaces where no scalar Field is behind it. The `fixture.field.disposition` dimension key
    // deliberately collides with a scalar enum Field the type also declares (its id), to prove
    // scalar-wins for the label/control.
    const STAT_BLOCK = defineStructuredDataType({
      id: 'fixture.datatype.stat-block',
      valueSchema: z.object({ size: z.string(), threat: z.number(), disposition: z.string() }).partial(),
      empty: () => ({}),
      facetDimensions: [
        { key: 'fx_size', labelKey: 'fixture.facets.size', dataType: { kind: 'enum', options: ['tiny', 'huge'] } },
        { key: 'fx_threat', labelKey: 'fixture.facets.threat', dataType: { kind: 'number' } },
        // Shares the `fixture.field.disposition` key with the scalar Field below — the scalar wins the label/control.
        { key: 'fixture.field.disposition', labelKey: 'fixture.facets.disposition', dataType: { kind: 'string' } },
      ],
      harvestFacets: (v: { size?: string; threat?: number; disposition?: string }) => {
        const rows: { key: string; value: string; num: number | null }[] = [];
        if (v.size !== undefined) rows.push({ key: 'fx_size', value: v.size, num: null });
        if (v.threat !== undefined) rows.push({ key: 'fx_threat', value: String(v.threat), num: v.threat });
        if (v.disposition !== undefined)
          rows.push({ key: 'fixture.field.disposition', value: v.disposition, num: null });
        return rows;
      },
    });

    beforeEach(() => {
      const registry = app.get(TypeFieldRegistry);
      registry.registerStructuredDataType(STAT_BLOCK);
      // A type carrying the structured `fixture.field.stat` Field plus a scalar `fixture.field.disposition` Field sharing that key.
      registerType(registry, 'fixture.type.creature', [
        defineField({
          id: 'fixture.field.stat',
          label: 'Stat Block',
          dataType: { kind: 'fixture.datatype.stat-block' },
          facetable: false,
        }),
        defineField({
          id: 'fixture.field.disposition',
          label: 'Disposition',
          dataType: { kind: 'enum', options: ['friendly', 'hostile'] },
          facetable: true,
        }),
      ]);
    });

    // Create a creature carrying a stat block (and optionally a scalar `fx_disposition`) via a typed save
    // — the active edit that both passes the forward-only gate and materialises the harvested facets.
    async function creature(
      agent: Awaited<ReturnType<typeof signIn>>,
      name: string,
      stat: { size?: string; threat?: number; disposition?: string },
      extra: Record<string, unknown> = {},
    ) {
      const created = await agent.post('/entities').send({ name, types: ['core.type.note'] });
      await agent
        .put(`/entities/${created.body.id}`)
        .send({
          document: { 'core.field.content': emptyRichContent(), 'fixture.field.stat': stat, ...extra },
          version: 1,
          tags: [],
          types: ['fixture.type.creature'],
        })
        .expect(200);
      return created.body.id as string;
    }

    const byValue = (facet: { value: string; count: number }[]) =>
      [...facet].sort((a, b) => a.value.localeCompare(b.value));

    type FieldFacetBody = {
      key: string;
      label: string;
      labelKey?: string;
      dataType: { kind: string; options?: string[] };
      values: { value: string; count: number }[];
    };

    it('surfaces a present harvested dimension with no scalar Field as its labelKey + control (#235)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const kobold = await creature(ada, 'Kobold', { size: 'tiny', threat: 1 });
      await creature(ada, 'Tarrasque', { size: 'huge', threat: 30 });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      const res = await ada.get('/entities/facets').query({ worldId }).expect(200);
      const fields = res.body.fields as FieldFacetBody[];
      const size = fields.find((f) => f.key === 'fx_size')!;
      // A harvested string dimension with no scalar Field resolves to its declared i18n key + toggle control.
      expect(size.labelKey).toBe('fixture.facets.size');
      expect(size.dataType).toEqual({ kind: 'enum', options: ['tiny', 'huge'] });
      expect(byValue(size.values)).toEqual([
        { value: 'huge', count: 1 },
        { value: 'tiny', count: 1 },
      ]);
    });

    it('resolves a key claimed by both a scalar Field and a dimension to the scalar (scalar wins, #235)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // The scalar `fixture.field.disposition` value and the stat block both feed the `fixture.field.disposition` key.
      const kobold = await creature(
        ada,
        'Kobold',
        { disposition: 'hostile' },
        { 'fixture.field.disposition': 'friendly' },
      );
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      const res = await ada.get('/entities/facets').query({ worldId }).expect(200);
      const disposition = (res.body.fields as FieldFacetBody[]).find((f) => f.key === 'fixture.field.disposition')!;
      // Scalar wins the label/control: its authored label and enum data-type, and no i18n key.
      expect(disposition.label).toBe('Disposition');
      expect(disposition.labelKey).toBeUndefined();
      expect(disposition.dataType).toEqual({ kind: 'enum', options: ['friendly', 'hostile'] });
      // Both sources merge into the one bucket (deliberate key reuse, ADR-0055).
      expect(byValue(disposition.values)).toEqual([
        { value: 'friendly', count: 1 },
        { value: 'hostile', count: 1 },
      ]);
    });

    it('offers a numeric dimension as a range and drills its counts down against siblings (#235)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const kobold = await creature(ada, 'Kobold', { size: 'tiny', threat: 1 });
      await creature(ada, 'Sphinx', { size: 'huge', threat: 11 });
      await creature(ada, 'Tarrasque', { size: 'huge', threat: 30 });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      // The numeric `fx_threat` dimension carries a number control (the rail picks a range from it).
      const facets = await ada.get('/entities/facets').query({ worldId }).expect(200);
      const threat = (facets.body.fields as FieldFacetBody[]).find((f) => f.key === 'fx_threat')!;
      expect(threat.dataType).toEqual({ kind: 'number' });
      expect(threat.labelKey).toBe('fixture.facets.threat');

      // A numeric range filter narrows the list, comparing the harvested `num` (not lexically).
      const listed = await ada.get('/entities').query({ worldId, field: 'fx_threat:gte:5' }).expect(200);
      expect((listed.body.items as { name: string }[]).map((e) => e.name).sort()).toEqual(['Sphinx', 'Tarrasque']);

      // Drill-down: `fx_size` is narrowed by the active `fx_threat >= 5`, while `fx_threat` drops its own filter.
      const drilled = await ada.get('/entities/facets').query({ worldId, field: 'fx_threat:gte:5' }).expect(200);
      const drilledFields = drilled.body.fields as FieldFacetBody[];
      expect(byValue(drilledFields.find((f) => f.key === 'fx_size')!.values)).toEqual([{ value: 'huge', count: 2 }]);
      expect(byValue(drilledFields.find((f) => f.key === 'fx_threat')!.values)).toEqual([
        { value: '1', count: 1 },
        { value: '11', count: 1 },
        { value: '30', count: 1 },
      ]);
    });

    it('surfaces a harvested dimension by presence, dropping it when the browse carries no value (#231, #235)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // A creature whose stat block carries `size` but no `threat`.
      const kobold = await creature(ada, 'Kobold', { size: 'tiny' });
      const worldId = (await ada.get(`/entities/${kobold}`)).body.worldId;

      const res = await ada.get('/entities/facets').query({ worldId }).expect(200);
      const keys = (res.body.fields as FieldFacetBody[]).map((f) => f.key);
      expect(keys).toContain('fx_size');
      // `fx_threat` is a declared dimension but the result set carries no value for it — so it never surfaces.
      expect(keys).not.toContain('fx_threat');
    });
  });

  describe('Entity-Link Fields (#190)', () => {
    // A monster type whose `lair` is a facetable, target-type-constrained Entity Link at a place.
    beforeEach(() => {
      registerType(app.get(TypeFieldRegistry), 'test.type.monster', [
        defineField({
          id: 'test.field.lair',
          label: 'Lair',
          dataType: { kind: 'entityLink', targetTypes: ['world.type.place'] },
          facetable: true,
        }),
      ]);
    });

    const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((e) => e.name).sort();

    /** Create a place (the link target) carrying the constrained type, in the caller's default World. */
    async function place(agent: Awaited<ReturnType<typeof signIn>>, name: string) {
      const created = await agent
        .post('/entities')
        .send({ name, types: ['world.type.place'] })
        .expect(201);
      return created.body.id as string;
    }

    /** Typed-save a monster whose `lair` points at `link` (an `{ entityId, label }` or nothing). */
    async function monster(
      agent: Awaited<ReturnType<typeof signIn>>,
      name: string,
      link: { entityId: string; label: string } | undefined,
    ) {
      const created = await agent
        .post('/entities')
        .send({ name, types: ['core.type.note'] })
        .expect(201);
      const res = await agent.put(`/entities/${created.body.id}`).send({
        document: { 'core.field.content': emptyRichContent(), ...(link ? { 'test.field.lair': link } : {}) },
        version: 1,
        tags: [],
        types: ['test.type.monster'],
      });
      return { id: created.body.id as string, res };
    }

    it('materialises the link as an edge, and filters the list by the Entity-Link Field', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const whisperwood = await place(ada, 'The Whisperwood');
      const other = await place(ada, 'The Sunken Keep');
      await monster(ada, 'Aboleth', { entityId: whisperwood, label: 'The Whisperwood' }).then((m) =>
        expect(m.res.status).toBe(200),
      );
      await monster(ada, 'Kraken', { entityId: other, label: 'The Sunken Keep' });

      // "all monsters whose lair is in the Whisperwood" — an eq filter on the target id.
      const res = await ada
        .get('/entities')
        .query({ type: 'test.type.monster', field: `test.field.lair:eq:${whisperwood}` })
        .expect(200);
      expect(names(res)).toEqual(['Aboleth']);
    });

    it('surfaces the link facet contextually, resolving each target id to its current name', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const whisperwood = await place(ada, 'The Whisperwood');
      const { id } = await monster(ada, 'Aboleth', { entityId: whisperwood, label: 'The Whisperwood' });
      const worldId = (await ada.get(`/entities/${id}`)).body.worldId;

      const res = await ada.get('/entities/facets').query({ worldId, type: 'test.type.monster' }).expect(200);
      const lair = (
        res.body.fields as {
          key: string;
          dataType: { kind: string };
          values: { value: string; label?: string; count: number }[];
        }[]
      ).find((f) => f.key === 'test.field.lair')!;
      expect(lair.dataType.kind).toBe('entityLink');
      // The facet value is the stable target id; the label is the target's live name for the rail.
      expect(lair.values).toEqual([{ value: whisperwood, label: 'The Whisperwood', count: 1 }]);
    });

    it('degrades gracefully: a link to a missing Entity saves inert and never errors the read', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // A constrained link at an id that does not resolve — inert, so the typed save still succeeds.
      const { id, res } = await monster(ada, 'Aboleth', { entityId: 'ghost-place', label: 'A Forgotten Vale' });
      expect(res.status).toBe(200);
      await ada.get(`/entities/${id}`).expect(200);

      // The dangling facet value keeps no label (the target resolves to no row).
      const worldId = (await ada.get(`/entities/${id}`)).body.worldId;
      const facets = await ada.get('/entities/facets').query({ worldId, type: 'test.type.monster' }).expect(200);
      const lair = (facets.body.fields as { key: string; values: { value: string; label?: string }[] }[]).find(
        (f) => f.key === 'test.field.lair',
      )!;
      expect(lair.values).toEqual([{ value: 'ghost-place', count: 1 }]);
    });

    it('enforces the target-type constraint on an active typed edit — a resolvable off-type target is rejected', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // A note is a real, readable Entity, but not a `world.type.place`.
      const note = await ada
        .post('/entities')
        .send({ name: 'Just a Note', types: ['core.type.note'] })
        .expect(201);
      const { res } = await monster(ada, 'Aboleth', { entityId: note.body.id, label: 'Just a Note' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid-fields');
      expect(res.body.data.fields).toContainEqual({ key: 'test.field.lair', code: 'type' });
    });

    // Off-type *and* unreadable: the constraint is checked through the caller's read filter, so the
    // target resolves to no row and the link stays inert rather than 400-ing the save (ADR-0046).
    it('accepts a link at an off-type target the caller cannot read', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const note = await ada
        .post('/entities')
        .send({ name: 'Ada’s Private Note', types: ['core.type.note'] })
        .expect(201);
      const worldId = note.body.worldId;
      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, worldId, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');
      const created = await bob
        .post('/entities')
        .send({ name: 'Aboleth', types: ['core.type.note'], worldId })
        .expect(201);

      const res = await bob.put(`/entities/${created.body.id}`).send({
        document: {
          'core.field.content': emptyRichContent(),
          'test.field.lair': { entityId: note.body.id, label: 'Ada’s Private Note' },
        },
        version: 1,
        tags: [],
        types: ['test.type.monster'],
      });

      expect(res.status).toBe(200);
    });

    it('never leaks a private target’s name through the link facet label (ADR-0046)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // Ada links a shared monster at a lair she keeps private.
      const whisperwood = await place(ada, 'The Whisperwood'); // private by default
      const { id: monsterId } = await monster(ada, 'Aboleth', { entityId: whisperwood, label: 'The Whisperwood' });
      setVisibility(monsterId, 'shared');
      const worldId = (await ada.get(`/entities/${monsterId}`)).body.worldId;

      // Bob, a World member, can read the shared monster but not its private lair.
      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, worldId, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const res = await bob.get('/entities/facets').query({ worldId, type: 'test.type.monster' }).expect(200);
      const lair = (
        res.body.fields as { key: string; values: { value: string; label?: string; count: number }[] }[]
      ).find((f) => f.key === 'test.field.lair')!;
      // Bob sees a link exists (the readable monster), but the private target's name never resolves.
      expect(lair.values).toEqual([{ value: whisperwood, count: 1 }]);
    });
  });

  /**
   * The bundled `dnd.type.monster` plugin. Nothing here registers a type: the plugin declares it in code and
   * {@link TypeFieldRegistry} seeds it at startup.
   */
  describe('the bundled dnd.type.monster plugin type', () => {
    /** Typed-save a monster whose stat block is the given value — an active typed edit, so the gate applies. */
    async function saveMonster(agent: Awaited<ReturnType<typeof signIn>>, statBlock: Record<string, unknown>) {
      const created = await agent
        .post('/entities')
        .send({ name: 'Aboleth', types: ['core.type.note'] })
        .expect(201);
      const res = await agent.put(`/entities/${created.body.id}`).send({
        // The stat block is one grouped value at `stat_block` now (ADR-0055), not thirteen top-level keys.
        document: { 'core.field.content': emptyRichContent(), 'dnd.field.stat-block': statBlock },
        version: 1,
        tags: [],
        types: ['dnd.type.monster'],
      });
      return { id: created.body.id as string, worldId: created.body.worldId as string, res };
    }

    it('resolves the plugin’s stat-block schema for the forward-only gate — a mistyped stat is rejected', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');

      // A CR is a number; the string a stat block *prints* is not the value it stores — the whole block fails.
      const illTyped = await saveMonster(ada, { challenge_rating: '24' });
      expect(illTyped.res.status).toBe(400);
      expect(illTyped.res.body.code).toBe('invalid-fields');
      expect(illTyped.res.body.data.fields).toContainEqual({ key: 'dnd.field.stat-block', code: 'type' });

      // An unknown size is not one of the enum options the block admits.
      const badSize = await saveMonster(ada, { size: 'Colossal' });
      expect(badSize.res.status).toBe(400);

      const ok = await saveMonster(ada, { challenge_rating: 24, size: 'Huge', creature_type: 'dragon' });
      expect(ok.res.status).toBe(200);

      // The block imposes no required stat — a deity borrowing it for its size facet alone is valid (ADR-0055).
      const noCr = await saveMonster(ada, { size: 'Large' });
      expect(noCr.res.status).toBe(200);
    });

    it('facets a monster on the stat block’s harvested dimensions, challenge_rating as a number', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const dragon = await saveMonster(ada, { challenge_rating: 24, size: 'Huge', creature_type: 'dragon' });
      expect(dragon.res.status).toBe(200);

      const facets = await ada
        .get('/entities/facets')
        .query({ worldId: dragon.worldId, type: 'dnd.type.monster' })
        .expect(200);
      const keys = (facets.body.fields as { key: string }[]).map((f) => f.key);
      expect(keys).toEqual(['size', 'creature_type', 'challenge_rating']);

      // The CR is indexed as a *number*, so a range filter compares it as one (`cr >= 20`).
      const ranged = await ada
        .get('/entities')
        .query({ worldId: dragon.worldId, field: 'challenge_rating:gte:20' })
        .expect(200);
      expect(ranged.body.items.map((e: { id: string }) => e.id)).toEqual([dragon.id]);

      const outOfRange = await ada
        .get('/entities')
        .query({ worldId: dragon.worldId, field: 'challenge_rating:gte:25' })
        .expect(200);
      expect(outOfRange.body.items).toEqual([]);
    });

    it('lists the plugin type in a World’s available types, alongside its user-defined ones', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const worldId = (await ada.get('/worlds').expect(200)).body[0].id;

      const listed = await ada.get(`/worlds/${worldId}/types`).expect(200);
      expect(listed.body).toContainEqual(
        expect.objectContaining({ id: 'dnd.type.monster', label: 'Monster', source: 'plugin' }),
      );
    });
  });

  it('refuses every entity route without a session cookie', async () => {
    const server = app.getHttpServer();

    await request(server).get('/entities').expect(401);
    await request(server)
      .post('/entities')
      .send({ name: 'X', types: ['core.type.note'] })
      .expect(401);
    await request(server).get('/entities/any').expect(401);
    await request(server).put('/entities/any').send({ document: emptyHexmapBody, version: 1 }).expect(401);
    await request(server).patch('/entities/any').send({ name: 'X' }).expect(401);
    await request(server).delete('/entities/any').expect(401);
  });

  it('surfaces an out-of-band corrupted tags column as a 500, like a bad type or document', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });
    const id = created.body.id;

    // Corruption must surface 500, not serve malformed data (ADR-0001).
    app
      .get<{ $client: import('better-sqlite3').Database }>(DB)
      .$client.prepare('UPDATE entities SET tags = ? WHERE id = ?')
      .run('"not-an-array"', id);

    await ada.get(`/entities/${id}`).expect(500);
    await ada.get('/entities').expect(500);
  });

  it('rejects malformed bodies with 400, not a server error', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });
    const id = created.body.id;

    await ada
      .post('/entities')
      .send({ name: '', types: ['core.type.note'] })
      .expect(400);
    await ada
      .post('/entities')
      .send({ name: '   ', types: ['core.type.note'] })
      .expect(400);
    await ada
      .post('/entities')
      .send({ name: 'X', types: ['spreadsheet'] })
      .expect(400);
    await ada.put(`/entities/${id}`).send({ document: emptyHexmapBody }).expect(400);
    // A typed save is an active typed edit, so its Fields are gated: an off-palette terrain fails
    // the `core.datatype.hex-grid` value schema like any other ill-typed Field.
    await ada
      .put(`/entities/${id}`)
      .send({
        document: hexmapBody({ '0,0': { terrain: 'lava' } }),
        version: 1,
        tags: [],
        types: ['core.type.hex-map'],
      })
      .expect(400);
    await ada.patch(`/entities/${id}`).send({ name: '' }).expect(400);
  });

  it('tolerates a malformed grid at rest on an untyped save, rather than 500ing on read (ADR-0050)', async () => {
    // Forward-only, applied to the grid like any other Field value: a save carrying no `types` is a
    // plain body edit, so garbage at `grid` stores and reads back as-is. The editor opens it as an
    // empty plane and the first edit overwrites it.
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Aldermoor', types: ['core.type.hex-map'] });
    const id = created.body.id;

    await ada
      .put(`/entities/${id}`)
      .send({
        document: { 'core.field.content': emptyRichContent(), 'core.field.grid': 'not-a-grid' },
        version: 1,
        tags: [],
      })
      .expect(200);

    const reloaded = await ada.get(`/entities/${id}`).expect(200);
    expect(reloaded.body.document).toEqual({
      'core.field.content': emptyRichContent(),
      'core.field.grid': 'not-a-grid',
    });
  });

  it('tolerates a malformed prose value at rest on an untyped save, rather than 500ing on read (ADR-0051)', async () => {
    // Prose is a Structured Data Type like the grid now: a plain body edit (no `types`) stores garbage at
    // `content` as-is, and a read never 500s — the editor opens it as an empty document.
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/entities').send({ name: 'Lady Aldermoor', types: ['core.type.note'] });
    const id = created.body.id;

    await ada
      .put(`/entities/${id}`)
      .send({ document: { 'core.field.content': 'not-a-doc' }, version: 1, tags: [] })
      .expect(200);

    const reloaded = await ada.get(`/entities/${id}`).expect(200);
    expect(reloaded.body.document).toEqual({ 'core.field.content': 'not-a-doc' });
  });

  describe('Entity Visibility & read access (ADR-0037, #160)', () => {
    it('lets a World member read a shared entity they do not own', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const note = await ada.post('/entities').send({ name: 'The Citadel', types: ['core.type.note'] });
      setVisibility(note.body.id, 'shared');

      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, note.body.worldId, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const res = await bob.get(`/entities/${note.body.id}`).expect(200);
      expect(res.body.name).toBe('The Citadel');
      // A plain member of a shared Entity holds read-only Rights (ADR-0039) — the editor
      // gates its writable surface on the absence of `edit`.
      expect(res.body.rights).toEqual(['read']);
    });

    it('grants an entity-level Editor read+edit only — not delete, set-visibility, or manage (ADR-0039)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const note = await ada.post('/entities').send({ name: 'Shared Draft', types: ['core.type.note'] });

      // An outsider (not a World member) handed an Editor grant on this one note (#161).
      // The grant pierces `private`, so the Entity is left at the create default.
      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      db.insert(entityGrants).values({ entityId: note.body.id, userId: bobId, role: 'editor' }).run();
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const res = await bob.get(`/entities/${note.body.id}`).expect(200);
      // The Editor edits substance but never the lifecycle/exposure gate — so the webapp
      // shows no visibility toggle and no delete, closing the old show-then-403.
      expect(res.body.rights).toEqual(['read', 'edit']);
    });

    it('gives a World Owner of a shared Entity the curate verbs but not manage (ADR-0039)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const note = await ada.post('/entities').send({ name: 'Town Lore', types: ['core.type.note'] });
      setVisibility(note.body.id, 'shared');

      // Bob owns the shared Entity; Ada owns the World it lives in.
      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      setOwner(note.body.id, bobId);

      const res = await ada.get(`/entities/${note.body.id}`).expect(200);
      // World Owner curates the shared surface — edit/delete/visibility — but grant/owner
      // management stays with the Entity's Owner, so no `manage`.
      expect(res.body.rights).toEqual(['read', 'edit', 'delete', 'set-visibility']);
    });

    it('denies a World member a private entity they do not own — 404, no existence leak', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const secret = await ada.post('/entities').send({ name: 'Unrevealed Lore', types: ['core.type.note'] });
      // Left private (the create default).

      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, secret.body.worldId, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      await bob.get(`/entities/${secret.body.id}`).expect(404);
    });

    it('denies a World Owner another member’s private entity — private is absolute', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const created = await ada.post('/entities').send({ name: 'Bob’s Diary', types: ['core.type.note'] });

      // Bob is a contributor who owns a private Entity in Ada's World; Ada owns the World.
      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, created.body.worldId, bobId, 'contributor');
      setOwner(created.body.id, bobId);

      // No role pierces private: the World Owner reaches neither read, edit, nor delete.
      await ada.get(`/entities/${created.body.id}`).expect(404);
      await ada.patch(`/entities/${created.body.id}`).send({ name: 'Peeked' }).expect(404);
      await ada.delete(`/entities/${created.body.id}`).expect(404);
    });

    it('scopes the list and facet counts to canRead — shared surface only, no private leak', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const shared = await ada.post('/entities').send({ name: 'Shared Keep', types: ['core.type.note'] });
      await ada.post('/entities').send({ name: 'Private Vault', types: ['core.type.note'] }); // stays private
      setVisibility(shared.body.id, 'shared');
      const worldId = shared.body.worldId;

      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, worldId, bobId, 'viewer');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const list = await bob.get('/entities').query({ worldId }).expect(200);
      const names = list.body.items.map((e: { name: string }) => e.name);
      expect(names).toContain('Shared Keep');
      expect(names).not.toContain('Private Vault');

      // Facet counts scope the same way: `private` never appears in a member's counts.
      const facets = await bob.get('/entities/facets').query({ worldId }).expect(200);
      const visValues = facets.body.visibility.map((f: { value: string }) => f.value);
      expect(visValues).toContain('shared');
      expect(visValues).not.toContain('private');
    });

    it('lets an Owner toggle an Entity’s visibility via PATCH, either direction', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const note = await ada.post('/entities').send({ name: 'Reveal Me', types: ['core.type.note'] });
      expect(note.body.visibility).toBe('private'); // New Entities default private.

      const shown = await ada.patch(`/entities/${note.body.id}`).send({ visibility: 'shared' }).expect(200);
      expect(shown.body.visibility).toBe('shared');

      const hidden = await ada.patch(`/entities/${note.body.id}`).send({ visibility: 'private' }).expect(200);
      expect(hidden.body.visibility).toBe('private');
    });

    it('changes any note’s visibility freely, with no locked-shared Home special-case (ADR-0043)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // A note named after the World is the old Home shape — now an ordinary Note whose
      // visibility flips like any other, in either direction.
      const note = await ada
        .post('/entities')
        .send({ name: 'Ada', types: ['core.type.note'] })
        .expect(201);

      const shared = await ada.patch(`/entities/${note.body.id}`).send({ visibility: 'shared' }).expect(200);
      expect(shared.body.visibility).toBe('shared');
      const hidden = await ada.patch(`/entities/${note.body.id}`).send({ visibility: 'private' }).expect(200);
      expect(hidden.body.visibility).toBe('private');
    });

    it('lets a World Owner edit a shared Entity they don’t own, but denies a plain member (403)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse'); // World Owner
      const hall = await ada.post('/entities').send({ name: 'Shared Hall', types: ['core.type.note'] });
      setVisibility(hall.body.id, 'shared');
      const worldId = hall.body.worldId;

      // Bob is a contributor who owns the shared Entity.
      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, worldId, bobId, 'contributor');
      setOwner(hall.body.id, bobId);

      // Carol is another plain member — a reader of the shared surface, not an editor of it.
      const carolId = await seedUser('carol@hexly.test', 'purple monkey', 'Carol');
      app.get(WorldsService).addMember(adaId, worldId, carolId, 'contributor');
      const carol = await signIn('carol@hexly.test', 'purple monkey');

      const doc = { 'core.field.content': emptyRichContent() };
      // The World Owner curates the shared surface: editing another's shared Entity → 200.
      await ada.put(`/entities/${hall.body.id}`).send({ document: doc, version: 1, tags: [] }).expect(200);

      // A plain member reaches it (shared) but may not write it → 403, not 404.
      await carol.put(`/entities/${hall.body.id}`).send({ document: doc, version: 2, tags: [] }).expect(403);
    });

    it('lets a World Owner rename and re-hide a shared Entity — and then loses all access once it’s private', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse'); // World Owner
      const hall = await ada.post('/entities').send({ name: 'Shared Hall', types: ['core.type.note'] });
      setVisibility(hall.body.id, 'shared');
      const worldId = hall.body.worldId;

      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, worldId, bobId, 'contributor');
      setOwner(hall.body.id, bobId); // Bob owns it; Ada owns the World.

      const carolId = await seedUser('carol@hexly.test', 'purple monkey', 'Carol');
      app.get(WorldsService).addMember(adaId, worldId, carolId, 'contributor');
      const carol = await signIn('carol@hexly.test', 'purple monkey');

      // A plain member can't rename another's shared Entity → 403 (reachable, not permitted).
      await carol.patch(`/entities/${hall.body.id}`).send({ name: 'Hijacked' }).expect(403);

      // The World Owner curates the shared surface: rename → 200.
      const renamed = await ada.patch(`/entities/${hall.body.id}`).send({ name: 'Great Hall' }).expect(200);
      expect(renamed.body.name).toBe('Great Hall');

      // …and re-hide (un-reveal something shared by mistake) → 200.
      const hidden = await ada.patch(`/entities/${hall.body.id}`).send({ visibility: 'private' }).expect(200);
      expect(hidden.body.visibility).toBe('private');

      // The power stops dead at `private`: the World Owner no longer even reaches it → 404.
      await ada.patch(`/entities/${hall.body.id}`).send({ name: 'X' }).expect(404);
      await ada.get(`/entities/${hall.body.id}`).expect(404);
    });

    it('lets a World Owner delete a shared Entity they don’t own; a plain member can’t (403), a private one is unreachable (404)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse'); // World Owner
      const ruin = await ada.post('/entities').send({ name: 'Shared Ruin', types: ['core.type.note'] });
      const cache = await ada.post('/entities').send({ name: 'Private Cache', types: ['core.type.note'] });
      setVisibility(ruin.body.id, 'shared'); // cache stays private
      const worldId = ruin.body.worldId;

      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, worldId, bobId, 'contributor');
      setOwner(ruin.body.id, bobId);
      setOwner(cache.body.id, bobId); // Bob owns both; Ada owns the World.

      const carolId = await seedUser('carol@hexly.test', 'purple monkey', 'Carol');
      app.get(WorldsService).addMember(adaId, worldId, carolId, 'viewer');
      const carol = await signIn('carol@hexly.test', 'purple monkey');

      // A plain member can read the shared Entity but can't delete it → 403.
      await carol.delete(`/entities/${ruin.body.id}`).expect(403);
      // Private is absolute: the World Owner can't delete another's private Entity → 404.
      await ada.delete(`/entities/${cache.body.id}`).expect(404);
      // But the World Owner's nuclear revoke reaches the shared surface → 204.
      await ada.delete(`/entities/${ruin.body.id}`).expect(204);
      await ada.get(`/entities/${ruin.body.id}`).expect(404);
    });

    it('does not report a metadata patch as saved when the write lands 0 rows (concurrent flip)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse'); // World Owner
      const hall = await ada.post('/entities').send({ name: 'Shared Hall', types: ['core.type.note'] });
      setVisibility(hall.body.id, 'shared');
      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, hall.body.worldId, bobId, 'contributor');
      setOwner(hall.body.id, bobId); // Bob owns it; Ada may curate the shared surface.

      const service = app.get(EntitiesService);
      const sharedRow = db.select().from(entities).where(eq(entities.id, hall.body.id)).get()!;
      // Simulate the TOCTOU race: the access context still reports the pre-flip decision
      // (writable), but the row is flipped `private` before the UPDATE runs — so the real
      // writeFilter on the WHERE now matches 0 rows and the write never lands. Keep the real
      // predicates (spread) so only the stale decision is faked, not the atomic re-check.
      const realAccess = entityAccessModule.entityAccess(db, adaId);
      vi.spyOn(entityAccessModule, 'entityAccess').mockReturnValue({
        ...realAccess,
        decide: () => ({
          row: sharedRow,
          isOwner: false,
          canRead: true,
          canWrite: true,
          canEditSubstance: true,
        }),
      });
      setVisibility(hall.body.id, 'private');

      // The lost write must not be faked as a 200 → null (a 404 at the controller), not a detail.
      expect(service.patch(adaId, hall.body.id, { name: 'Ghost Edit' })).toBeNull();
      // And nothing was written: the name is untouched.
      const after = db.select().from(entities).where(eq(entities.id, hall.body.id)).get()!;
      expect(after.name).toBe('Shared Hall');
    });

    it('confines owner-set management to the Entity’s Owners — reachable non-owner 403, non-reader 404', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse'); // World Owner
      const hall = await ada.post('/entities').send({ name: 'Shared Hall', types: ['core.type.note'] });
      setVisibility(hall.body.id, 'shared');
      const worldId = hall.body.worldId;

      const bobId = await seedUser('bob@hexly.test', 'battery staple', 'Bob');
      app.get(WorldsService).addMember(adaId, worldId, bobId, 'contributor');
      setOwner(hall.body.id, bobId); // Bob owns it; Ada owns the World.

      const carolId = await seedUser('carol@hexly.test', 'purple monkey', 'Carol');
      app.get(WorldsService).addMember(adaId, worldId, carolId, 'contributor');

      // Even the World Owner reaches the shared Entity but isn't its Owner: grant/owner
      // management belongs to the Entity's Owners alone (ADR-0037) → 403, not 404.
      await ada.get(`/entities/${hall.body.id}/owners`).expect(403);
      await ada.post(`/entities/${hall.body.id}/owners`).send({ userId: carolId }).expect(403);

      // A non-member can't even reach the Entity → 404, no existence leak.
      await seedUser('dave@hexly.test', 'stormy petrel', 'Dave');
      const dave = await signIn('dave@hexly.test', 'stormy petrel');
      await dave.get(`/entities/${hall.body.id}/owners`).expect(404);

      // The actual Owner manages the set → 200.
      const bob = await signIn('bob@hexly.test', 'battery staple');
      const owners = await bob.post(`/entities/${hall.body.id}/owners`).send({ userId: carolId }).expect(200);
      expect(owners.body).toContain(carolId);
    });
  });
});
