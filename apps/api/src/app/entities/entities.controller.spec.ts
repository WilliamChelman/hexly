import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { coordKey, emptyContent } from '@hexly/domain';
import { DB, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from './entities.module';

/** An empty hexmap body — the shape create mints and the editor round-trips. */
const emptyHexmapBody = {
  type: 'hexmap',
  content: emptyContent(),
  hexes: {},
  regions: [],
  labels: [],
};

describe('Entities endpoints', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, EntitiesModule],
    })
      // Real Drizzle, real schema, isolated per-test (ADR-0002).
      .overrideProvider(DB)
      .useValue(createDb(':memory:'))
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada');
  });

  afterEach(async () => {
    await app.close();
  });

  /** Log a seeded user in and return an agent that carries their session. */
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
      name: 'The Reach of Aldermoor',
      type: 'hexmap',
      tags: [],
      visibility: 'private',
      version: 1,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      document: emptyHexmapBody,
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

    // The response is always the envelope — never a bare array (ADR-0025).
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'Aldermoor',
      'Lady A',
    ]);
    expect(res.body.items[0]).not.toHaveProperty('document');
    expect(res.body.items[0]).toHaveProperty('type');
    expect(res.body.items[0]).toHaveProperty('tags');
  });

  it('walks every owner entity exactly once via cursor, with limit bounding each page', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const names = ['A', 'B', 'C', 'D', 'E'];
    for (const name of names) {
      await ada.post('/entities').send({ name, type: 'note' });
    }

    // Walk the whole list two-at-a-time, following nextCursor to the end.
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

    // Every entity surfaced exactly once — no duplicates, no gaps.
    expect(seen.slice().sort()).toEqual(names.slice().sort());
    expect(seen.length).toBe(names.length);
    // 5 entities at 2 per page = 3 pages (2 + 2 + 1), last page's cursor is null.
    expect(pages).toBe(3);
  });

  it('filters by case-insensitive name (q) and by type, composing the two', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await ada.post('/entities').send({ name: 'Aldermoor Keep', type: 'hexmap' });
    await ada.post('/entities').send({ name: 'Aldermoor Town', type: 'note' });
    await ada.post('/entities').send({ name: 'The Whisperwood', type: 'note' });

    // q matches a substring of the name, case-insensitively.
    const byName = await ada.get('/entities').query({ q: 'aldermoor' }).expect(200);
    expect(byName.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'Aldermoor Keep',
      'Aldermoor Town',
    ]);

    // type filters by Entity Type.
    const byType = await ada.get('/entities').query({ type: 'note' }).expect(200);
    expect(byType.body.items.map((e: { name: string }) => e.name).sort()).toEqual([
      'Aldermoor Town',
      'The Whisperwood',
    ]);

    // The two compose — only the note named like "aldermoor".
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

    // ids selects the given set through the same envelope — and silently drops
    // an unknown id rather than erroring (the picker's display-resolve path).
    const res = await ada
      .get('/entities')
      .query({ ids: [a.body.id, c.body.id, 'no-such-id'] })
      .expect(200);

    expect(res.body.items.map((e: { id: string }) => e.id).sort()).toEqual(
      [a.body.id, c.body.id].sort(),
    );
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

    // Case and surrounding whitespace fold together; duplicates collapse (#88).
    const res = await ada
      .put(`/entities/${id}`)
      .send({ document: body, version: 1, tags: [' Deity ', 'deity', 'RUINED'] })
      .expect(200);
    expect(res.body.tags).toEqual(['deity', 'ruined']);

    // A whitespace-only tag is rejected, not stored as a blank chip (#88).
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
    // An editor-defined snapshot the domain has no knowledge of (ADR-0019).
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
    // The 409 carries the server's current Entity so the client can re-pull.
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

  it('never lets another user reach an entity they do not own', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada
      .post('/entities')
      .send({ name: 'Aldermoor', type: 'hexmap' });
    const id = created.body.id;

    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    const bobsList = await bob.get('/entities').expect(200);
    expect(bobsList.body).toEqual({ items: [], nextCursor: null });

    // 404, not 403 — ownership never leaks (ADR-0004).
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

    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');
    await bob.post('/entities').send({ name: 'Aldermoor', type: 'hexmap' });

    // ids can't reach across owners — asking for Ada's id as Bob resolves to nothing.
    const byId = await bob.get('/entities').query({ ids: [adas.body.id] }).expect(200);
    expect(byId.body.items).toEqual([]);

    // q/type only ever match Bob's own rows, never Ada's same-named hexmap.
    const byQ = await bob.get('/entities').query({ q: 'aldermoor', type: 'hexmap' }).expect(200);
    expect(byQ.body.items).toHaveLength(1);
    expect(byQ.body.items.map((e: { id: string }) => e.id)).not.toContain(adas.body.id);
  });

  it('rejects a malformed cursor or limit with 400, not a 500', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    // A cursor that doesn't decode to a valid offset is a client error (ADR-0001).
    await ada.get('/entities').query({ cursor: 'not-a-real-cursor!!' }).expect(400);
    // Non-numeric, zero, and negative limits are all malformed.
    await ada.get('/entities').query({ limit: 'lots' }).expect(400);
    await ada.get('/entities').query({ limit: '0' }).expect(400);
    await ada.get('/entities').query({ limit: '-5' }).expect(400);

    // A sane cursor/limit still works — the guard rejects only the malformed.
    await ada.get('/entities').query({ limit: '10' }).expect(200);
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

    // Out-of-band corruption: read path must surface 500, not serve malformed data (ADR-0001).
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
    // A whitespace-only name trims to "" and is likewise rejected.
    await ada.post('/entities').send({ name: '   ', type: 'note' }).expect(400);
    // An unknown type is rejected before anything is stored.
    await ada.post('/entities').send({ name: 'X', type: 'spreadsheet' }).expect(400);
    await ada.put(`/entities/${id}`).send({ document: emptyHexmapBody }).expect(400);
    // A hexmap body with an unknown terrain is rejected before it is ever stored.
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
