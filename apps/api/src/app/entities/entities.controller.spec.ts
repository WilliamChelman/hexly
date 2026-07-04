import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { coordKey, emptyContent, tiptapContent } from '@hexly/domain';
import { DB, Db, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from './entities.module';
import { EntitiesService } from './entities.service';
import { ConfigModule } from '../config/config.module';
import { WorldsModule } from '../worlds/worlds.module';
import { WorldsService } from '../worlds/worlds.service';

// Empty hexmap body shape (what create mints; what editor round-trips).
const emptyHexmapBody = {
  type: 'hexmap',
  content: emptyContent(),
  hexes: {},
  regions: [],
  labels: [],
};

describe('Entities endpoints', () => {
  let app: INestApplication;
  let db: Db;

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
    await app.init();

    await seedUserWithWorld('ada@hexly.test', 'correct horse', 'Ada');
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * Seed a user and give them a World — the precondition for creating Entities
   * (ADR-0024). Seeding alone no longer mints a World; the future World-creation
   * UI does, which this stands in for. `mintWorldWithHome` also creates the
   * World's Home note, so it surfaces in the owner's Entity list.
   */
  async function seedUserWithWorld(email: string, password: string, name: string) {
    const userId = await app.get(AuthService).seedUser(email, password, name);
    app.get(WorldsService).mintWorldWithHome(userId, name);
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
      .send({ name: 'The Reach of Aldermoor', type: 'hexmap' })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      ownerId: expect.any(String),
      worldId: expect.any(String),
      name: 'The Reach of Aldermoor',
      type: 'hexmap',
      tags: [],
      visibility: 'private',
      version: 1,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      document: emptyHexmapBody,
      isHome: false,
    });
  });

  it('creates a note as Content-only, with no hex-grid payload', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada
      .post('/entities')
      .send({ name: 'Lady Aldermoor', type: 'note' })
      .expect(201);

    expect(res.body.type).toBe('note');
    expect(res.body.document).toEqual({ type: 'note', content: emptyContent() });
  });

  it('trims surrounding whitespace off a created entity name', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada
      .post('/entities')
      .send({ name: '  The Whisperwood  ', type: 'note' })
      .expect(201);

    expect(res.body.name).toBe('The Whisperwood');
  });

  it('lists the owner’s entities as an envelope of summaries, last page → nextCursor null', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await ada.post('/entities').send({ name: 'Aldermoor', type: 'hexmap' });
    await ada.post('/entities').send({ name: 'Lady A', type: 'note' });

    const res = await ada.get('/entities').expect(200);

    // Response is always an envelope (ADR-0025). 'Ada' is the auto-created Home note (ADR-0024).
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'Ada',
      'Aldermoor',
      'Lady A',
    ]);
    expect(res.body.items[0]).not.toHaveProperty('document');
    expect(res.body.items[0]).toHaveProperty('type');
    expect(res.body.items[0]).toHaveProperty('tags');
  });

  it('walks every owner entity exactly once via cursor, with limit bounding each page', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    // 'Ada' is the Home note auto-created with Ada's World (ADR-0024); it lists too.
    const names = ['Ada', 'A', 'B', 'C', 'D', 'E'];
    for (const name of names.slice(1)) {
      await ada.post('/entities').send({ name, type: 'note' });
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
    await ada.post('/entities').send({ name: 'Aldermoor Keep', type: 'hexmap' });
    await ada.post('/entities').send({ name: 'Aldermoor Town', type: 'note' });
    await ada.post('/entities').send({ name: 'The Whisperwood', type: 'note' });

    const byName = await ada.get('/entities').query({ q: 'aldermoor' }).expect(200);
    expect(byName.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'Aldermoor Keep',
      'Aldermoor Town',
    ]);

    const byType = await ada.get('/entities').query({ type: 'note' }).expect(200);
    expect(byType.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'Ada',
      'Aldermoor Town',
      'The Whisperwood',
    ]);

    const both = await ada
      .get('/entities')
      .query({ q: 'aldermoor', type: 'note' })
      .expect(200);
    expect(both.body.items.map((e: { name: string }) => e.name)).toEqual([
      'Aldermoor Town',
    ]);
  });

  it('returns exactly the requested owner-owned summaries when ids is given', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const a = await ada.post('/entities').send({ name: 'Aldermoor', type: 'hexmap' });
    await ada.post('/entities').send({ name: 'The Whisperwood', type: 'note' });
    const c = await ada.post('/entities').send({ name: 'Lady A', type: 'note' });

    // ids silently drops unknown ids (picker's display-resolve path).
    const res = await ada
      .get('/entities')
      .query({ ids: [a.body.id, c.body.id, 'no-such-id'] })
      .expect(200);

    expect(res.body.items.map((e: { id: string }) => e.id).sort()).toEqual(
      [a.body.id, c.body.id].sort(),
    );
  });

  it('filters the entity list to one World via worldId', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const seeded = await ada
      .post('/entities')
      .send({ name: 'In Seeded World', type: 'note' })
      .expect(201);
    const worldA = seeded.body.worldId;

    const worldB = await ada.post('/worlds').send({ name: 'Second' }).expect(201);
    await ada
      .post('/entities')
      .send({ name: 'In Second World', type: 'note', worldId: worldB.body.id })
      .expect(201);

    const inA = await ada.get('/entities').query({ worldId: worldA }).expect(200);
    expect(inA.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'Ada',
      'In Seeded World',
    ]);

    const inB = await ada
      .get('/entities')
      .query({ worldId: worldB.body.id })
      .expect(200);
    expect(inB.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'In Second World',
      'Second',
    ]);
  });

  it('loads an entity by id with its full body', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });

    const res = await ada.get(`/entities/${created.body.id}`).expect(200);

    expect(res.body).toEqual(created.body);
    expect(res.body.document).toEqual(emptyHexmapBody);
  });

  it('returns 404 for an entity id that does not exist', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada.get('/entities/does-not-exist').expect(404);
  });

  it('saves the body against the current version and bumps the version', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });
    const painted = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    };

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
    const created = await ada
      .post('/entities')
      .send({ name: 'Lady A', type: 'note' });
    const id = created.body.id;
    const body = { type: 'note', content: emptyContent() };

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
    const created = await ada
      .post('/entities')
      .send({ name: 'Lady A', type: 'note' });
    const id = created.body.id;
    const body = { type: 'note', content: emptyContent() };

    const res = await ada
      .put(`/entities/${id}`)
      .send({ document: body, version: 1, tags: [' Deity ', 'deity', 'RUINED'] })
      .expect(200);
    expect(res.body.tags).toEqual(['deity', 'ruined']);

    await ada
      .put(`/entities/${id}`)
      .send({ document: body, version: 2, tags: ['   '] })
      .expect(400);
  });

  it('round-trips an opaque Content snapshot through a save untouched', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Lady A', type: 'note' });
    // Editor-defined snapshot; domain has no knowledge of it (ADR-0019).
    const snapshot = { type: 'doc', content: [{ type: 'futureBlock', attrs: { z: [1] } }] };
    const body = { type: 'note', content: { format: 'tiptap-v1', snapshot } };

    await ada
      .put(`/entities/${created.body.id}`)
      .send({ document: body, version: 1, tags: [] })
      .expect(200);

    const reloaded = await ada.get(`/entities/${created.body.id}`).expect(200);
    expect(reloaded.body.document.content.snapshot).toEqual(snapshot);
  });

  it('rejects a save built on a stale version with 409 and keeps the entity intact', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });
    const id = created.body.id;
    const first = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    };

    await ada.put(`/entities/${id}`).send({ document: first, version: 1, tags: [] }).expect(200);

    const stale = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 9, r: 9 })]: { terrain: 'ocean' } },
    };
    const conflict = await ada
      .put(`/entities/${id}`)
      .send({ document: stale, version: 1, tags: [] })
      .expect(409);
    // 409 includes server's current Entity for client re-pull.
    expect(conflict.body.version).toBe(2);
    expect(conflict.body.document).toEqual(first);

    const reloaded = await ada.get(`/entities/${id}`).expect(200);
    expect(reloaded.body.document).toEqual(first);
    expect(reloaded.body.version).toBe(2);
  });

  it('renames an entity without disturbing its body or version', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Untitled', type: 'hexmap' });
    const id = created.body.id;
    const painted = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    };
    await ada.put(`/entities/${id}`).send({ document: painted, version: 1, tags: [] }).expect(200);

    const res = await ada
      .patch(`/entities/${id}`)
      .send({ name: 'The Reach of Aldermoor' })
      .expect(200);

    expect(res.body.name).toBe('The Reach of Aldermoor');
    expect(res.body.version).toBe(2);
    expect(res.body.document).toEqual(painted);
  });

  it('deletes an entity so it can no longer be loaded', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });

    await ada.delete(`/entities/${created.body.id}`).expect(204);

    await ada.get(`/entities/${created.body.id}`).expect(404);
  });

  it('returns 404 when deleting an entity that does not exist', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada.delete('/entities/does-not-exist').expect(404);
  });

  it('refuses to delete a World’s Home Entity with 409', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    // Home note can't be deleted (minted with World, ADR-0024).
    const list = await ada.get('/entities').expect(200);
    const home = list.body.items.find((e: { name: string }) => e.name === 'Ada');

    await ada.delete(`/entities/${home.id}`).expect(409);
    await ada.get(`/entities/${home.id}`).expect(200);
  });

  it('never lets another user reach an entity they do not own', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });
    const id = created.body.id;

    await seedUserWithWorld('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    // Bob sees only his Home note (ADR-0024); ownership never leaks (ADR-0004).
    const bobsList = await bob.get('/entities').expect(200);
    expect(bobsList.body.items.map((e: { name: string }) => e.name)).toEqual(['Bob']);
    expect(bobsList.body.items.map((e: { id: string }) => e.id)).not.toContain(id);
    await bob.get(`/entities/${id}`).expect(404);
    await bob
      .put(`/entities/${id}`)
      .send({ document: emptyHexmapBody, version: 1, tags: [] })
      .expect(404);
    await bob.patch(`/entities/${id}`).send({ name: 'Hijacked' }).expect(404);
    await bob.delete(`/entities/${id}`).expect(404);

    const reloaded = await ada.get(`/entities/${id}`).expect(200);
    expect(reloaded.body.version).toBe(1);
  });

  it('stays owner-scoped under ids/q/type — another owner’s entity never surfaces', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const adas = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });

    await seedUserWithWorld('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');
    await bob.post('/entities').send({ name: 'Aldermoor', type: 'hexmap' });

    const byId = await bob.get('/entities').query({ ids: [adas.body.id] }).expect(200);
    expect(byId.body.items).toEqual([]);

    const byQ = await bob.get('/entities').query({ q: 'aldermoor', type: 'hexmap' }).expect(200);
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
    // A note body whose Content carries an entityLink per descriptor — the server
    // harvests the vocabulary from *this*, not from a payload field (ADR-0023/0035).
    function bodyWithDescriptors(...descriptors: string[]) {
      return {
        type: 'note',
        content: tiptapContent({
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

    async function newNote(
      agent: Awaited<ReturnType<typeof signIn>>,
      name = 'Lady A',
    ) {
      const res = await agent.post('/entities').send({ name, type: 'note' });
      return res.body.id as string;
    }

    it('serves the owner’s DISTINCT descriptors harvested from the saved Content, folding case', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const id = await newNote(ada);

      await ada
        .put(`/entities/${id}`)
        .send({ document: bodyWithDescriptors(' Spouse ', 'spouse', 'Capital Of'), version: 1, tags: [] })
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

    it('self-prunes: a later save whose Content dropped a link drops it from the vocabulary', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const id = await newNote(ada);

      await ada
        .put(`/entities/${id}`)
        .send({ document: bodyWithDescriptors('spouse', 'rival'), version: 1, tags: [] })
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

      expect((await ada.get('/entities/descriptors').expect(200)).body).toEqual([
        'spouse',
      ]);
      expect((await bob.get('/entities/descriptors').expect(200)).body).toEqual([
        'rival',
      ]);
    });
  });

  describe('full-text search (ADR-0035)', () => {
    // A note whose Content prose carries `text`, saved at version 1.
    async function noteWithProse(
      agent: Awaited<ReturnType<typeof signIn>>,
      name: string,
      text: string,
    ) {
      const created = await agent.post('/entities').send({ name, type: 'note' });
      const document = {
        type: 'note',
        content: tiptapContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        }),
      };
      await agent
        .put(`/entities/${created.body.id}`)
        .send({ document, version: 1, tags: [] })
        .expect(200);
      return created.body.id as string;
    }

    const names = (res: { body: { items: { name: string }[] } }) =>
      res.body.items.map((e) => e.name).sort();

    it('matches an entity by a word inside its Content prose', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await noteWithProse(ada, 'Lady A', 'She rules the sunken citadel beneath the waves.');
      await noteWithProse(ada, 'Lord B', 'He commands the northern watchtowers.');

      const res = await ada.get('/entities').query({ q: 'citadel' }).expect(200);
      expect(names(res)).toEqual(['Lady A']);
    });

    it('matches by name, by tag, and by prose — all case-insensitively', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // Distinct match surfaces: one hit per query word, no cross-contamination.
      await ada.post('/entities').send({ name: 'Whisperwood', type: 'note' }); // name
      const tagged = await ada.post('/entities').send({ name: 'Keep', type: 'note' });
      await ada
        .put(`/entities/${tagged.body.id}`)
        .send({ document: { type: 'note', content: emptyContent() }, version: 1, tags: ['Deity'] })
        .expect(200);
      await noteWithProse(ada, 'Chronicle', 'The obelisk hums at midnight.'); // prose

      expect(names(await ada.get('/entities').query({ q: 'WHISPERWOOD' }).expect(200)))
        .toEqual(['Whisperwood']);
      expect(names(await ada.get('/entities').query({ q: 'deity' }).expect(200)))
        .toEqual(['Keep']);
      expect(names(await ada.get('/entities').query({ q: 'OBELISK' }).expect(200)))
        .toEqual(['Chronicle']);
    });

    it('ranks results by bm25 relevance when a query is present', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // 'Dense' packs the term into a short doc; 'Sparse' buries one hit in a long
      // one — bm25 (more occurrences, shorter field) surfaces Dense first.
      await noteWithProse(ada, 'Dense', 'Dragon dragon dragon over the keep.');
      await noteWithProse(
        ada,
        'Sparse',
        'A lone dragon drifted past the long and winding northern coastline at dusk.',
      );

      const res = await ada.get('/entities').query({ q: 'dragon' }).expect(200);
      expect(res.body.items.map((e: { name: string }) => e.name)).toEqual([
        'Dense',
        'Sparse',
      ]);
    });

    it('ranks a name match above a body that only mentions the term (column weights)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // 'Dragon' matches on its name once; 'Bestiary' says dragon five times in its
      // body. Unweighted bm25 would float Bestiary up on raw frequency — the name
      // weight is what makes the entity *called* Dragon win.
      await ada.post('/entities').send({ name: 'Dragon', type: 'note' });
      await noteWithProse(ada, 'Bestiary', 'dragon dragon dragon dragon dragon');

      const res = await ada.get('/entities').query({ q: 'dragon' }).expect(200);
      expect(res.body.items.map((e: { name: string }) => e.name)).toEqual([
        'Dragon',
        'Bestiary',
      ]);
    });

    it('falls back to newest-first order when no query is given', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      await ada.post('/entities').send({ name: 'First', type: 'note' });
      await ada.post('/entities').send({ name: 'Second', type: 'note' });

      // No q → updatedAt desc, id asc (ADR-0025). 'Ada' (Home) was created first.
      const res = await ada.get('/entities').expect(200);
      expect(res.body.items.map((e: { name: string }) => e.name)).toEqual([
        'Second',
        'First',
        'Ada',
      ]);
    });

    it('keeps the index fresh through create, edit, rename, and delete', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const found = async (q: string) =>
        names(await ada.get('/entities').query({ q }).expect(200));

      // Create + first save → findable by its prose (INSERT/UPDATE triggers).
      const id = await noteWithProse(ada, 'Ledger', 'The alpha rune glows.');
      expect(await found('alpha')).toEqual(['Ledger']);

      // Edit Content → re-findable under the new text, gone under the old.
      await ada
        .put(`/entities/${id}`)
        .send({
          document: {
            type: 'note',
            content: tiptapContent({
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The beta rune fades.' }] }],
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
      const found = async (q: string) =>
        names(await ada.get('/entities').query({ q }).expect(200));
      const id = await noteWithProse(ada, 'Vault', 'alpha rune');
      expect(await found('alpha')).toEqual(['Vault']);

      // Desync the FTS index out-of-band: drop the 'alpha' posting, add a 'ghost'
      // one. Now only the index disagrees with the column — the discriminator for
      // whether a reindex runs. (External-content delete needs the original values.)
      const raw = db.$client;
      const row = raw
        .prepare('SELECT rowid, name, tags, content_text AS ct FROM entities WHERE id = ?')
        .get(id) as { rowid: number; name: string; tags: string; ct: string };
      raw
        .prepare(
          `INSERT INTO entities_fts(entities_fts, rowid, name, tags, content_text) VALUES('delete', ?, ?, ?, ?)`,
        )
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
        .send({ name: 'In B', type: 'note', worldId: worldB.body.id })
        .expect(201);
      await ada
        .put(`/entities/${inB.body.id}`)
        .send({
          document: {
            type: 'note',
            content: tiptapContent({
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the meridian road' }] }],
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
        const res: { body: { items: { name: string }[]; nextCursor: string | null } } = await ada
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

    it('backfills pre-existing rows at boot so an old vault becomes searchable', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      // Anchor gives us a real owner/World to hang the legacy row off of.
      const anchor = (await ada.post('/entities').send({ name: 'Anchor', type: 'note' })).body;

      // A row as it looked before this column existed: content_text NULL, so the
      // INSERT trigger indexed only name/tags — its prose is not yet searchable.
      const document = JSON.stringify({
        type: 'note',
        content: tiptapContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the buried obelisk' }] }],
        }),
      });
      const now = Date.now();
      db.$client
        .prepare(
          `INSERT INTO entities (id, owner_id, world_id, is_home, name, type, tags, visibility, version, document, content_text, created_at, updated_at)
           VALUES (?, ?, ?, 0, 'Legacy', 'note', '[]', 'private', 1, ?, NULL, ?, ?)`,
        )
        .run('legacy-1', anchor.ownerId, anchor.worldId, document, now, now);

      expect(names(await ada.get('/entities').query({ q: 'obelisk' }).expect(200))).toEqual([]);

      // Boot backfill runs the extractor over the NULL row and reindexes it.
      app.get(EntitiesService).onApplicationBootstrap();

      expect(names(await ada.get('/entities').query({ q: 'obelisk' }).expect(200))).toEqual(['Legacy']);
    });
  });

  it('refuses every entity route without a session cookie', async () => {
    const server = app.getHttpServer();

    await request(server).get('/entities').expect(401);
    await request(server).post('/entities').send({ name: 'X', type: 'note' }).expect(401);
    await request(server).get('/entities/any').expect(401);
    await request(server)
      .put('/entities/any')
      .send({ document: emptyHexmapBody, version: 1 })
      .expect(401);
    await request(server).patch('/entities/any').send({ name: 'X' }).expect(401);
    await request(server).delete('/entities/any').expect(401);
  });

  it('surfaces an out-of-band corrupted tags column as a 500, like a bad type or document', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });
    const id = created.body.id;

    // Corruption must surface 500, not serve malformed data (ADR-0001).
    app.get<{ $client: import('better-sqlite3').Database }>(DB).$client
      .prepare('UPDATE entities SET tags = ? WHERE id = ?')
      .run('"not-an-array"', id);

    await ada.get(`/entities/${id}`).expect(500);
    await ada.get('/entities').expect(500);
  });

  it('rejects malformed bodies with 400, not a server error', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });
    const id = created.body.id;

    await ada.post('/entities').send({ name: '', type: 'note' }).expect(400);
    await ada.post('/entities').send({ name: '   ', type: 'note' }).expect(400);
    await ada.post('/entities').send({ name: 'X', type: 'spreadsheet' }).expect(400);
    await ada.put(`/entities/${id}`).send({ document: emptyHexmapBody }).expect(400);
    await ada
      .put(`/entities/${id}`)
      .send({
        document: { ...emptyHexmapBody, hexes: { '0,0': { terrain: 'lava' } } },
        version: 1,
      })
      .expect(400);
    await ada.patch(`/entities/${id}`).send({ name: '' }).expect(400);
  });
});
