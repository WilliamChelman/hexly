import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { coordKey } from '@hexly/domain';
import { DB, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { MapsModule } from './maps.module';

describe('Maps endpoints', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, MapsModule],
    })
      // A throwaway in-memory database per test — real Drizzle, real schema,
      // no shared state between tests (ADR-0002).
      .overrideProvider(DB)
      .useValue(createDb(':memory:'))
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    // Provision Ada, the owner used by every test (ADR-0004). A second user
    // (Bob) is seeded lazily only by the owner-scoping test, so the common case
    // pays for just one argon2 hash here.
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

  it('creates a named map for the owner, starting empty at version 1', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada
      .post('/maps')
      .send({ title: 'The Reach of Aldermoor' })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      ownerId: expect.any(String),
      title: 'The Reach of Aldermoor',
      visibility: 'private',
      version: 1,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      document: { hexes: {}, regions: [], labels: [] },
    });
  });

  it('trims surrounding whitespace off a created map title', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada
      .post('/maps')
      .send({ title: '  The Whisperwood  ' })
      .expect(201);

    // The schema's `.trim()` runs before the title is stored, so the persisted
    // title carries no surrounding whitespace (issues #12, #15).
    expect(res.body.title).toBe('The Whisperwood');
  });

  it('lists the maps the owner created, without their documents', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await ada.post('/maps').send({ title: 'Aldermoor' }).expect(201);
    await ada.post('/maps').send({ title: 'The Whisperwood' }).expect(201);

    const res = await ada.get('/maps').expect(200);

    expect(res.body.map((m: { title: string }) => m.title).sort()).toEqual([
      'Aldermoor',
      'The Whisperwood',
    ]);
    // The list is metadata only — the (potentially large) document is fetched
    // on open, not here.
    expect(res.body[0]).not.toHaveProperty('document');
  });

  it('loads a map by id with its full document', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/maps').send({ title: 'Aldermoor' });

    const res = await ada.get(`/maps/${created.body.id}`).expect(200);

    expect(res.body).toEqual(created.body);
    expect(res.body.document).toEqual({ hexes: {}, regions: [], labels: [] });
  });

  it('returns 404 for a map id that does not exist', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada.get('/maps/does-not-exist').expect(404);
  });

  it('saves the document against the current version and bumps the version', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/maps').send({ title: 'Aldermoor' });
    const painted = { hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } }, regions: [], labels: [] };

    const res = await ada
      .put(`/maps/${created.body.id}`)
      .send({ document: painted, version: created.body.version })
      .expect(200);

    expect(res.body.version).toBe(2);
    expect(res.body.document).toEqual(painted);

    // The painted document survives a reload — it was actually persisted.
    const reloaded = await ada.get(`/maps/${created.body.id}`).expect(200);
    expect(reloaded.body.document).toEqual(painted);
    expect(reloaded.body.version).toBe(2);
  });

  it('rejects a save built on a stale version with 409 and keeps the map intact', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/maps').send({ title: 'Aldermoor' });
    const id = created.body.id;
    const first = { hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } }, regions: [], labels: [] };

    // A first save moves the map from version 1 to version 2.
    await ada.put(`/maps/${id}`).send({ document: first, version: 1 }).expect(200);

    // A second save still built on version 1 is stale — it must be rejected.
    const stale = { hexes: { [coordKey({ q: 9, r: 9 })]: { terrain: 'ocean' } }, regions: [], labels: [] };
    await ada.put(`/maps/${id}`).send({ document: stale, version: 1 }).expect(409);

    // The stale write left no trace — the map still holds the first save.
    const reloaded = await ada.get(`/maps/${id}`).expect(200);
    expect(reloaded.body.document).toEqual(first);
    expect(reloaded.body.version).toBe(2);
  });

  it('renames a map without disturbing its document or version', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/maps').send({ title: 'Untitled map' });
    const id = created.body.id;
    const painted = { hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } }, regions: [], labels: [] };
    await ada.put(`/maps/${id}`).send({ document: painted, version: 1 }).expect(200);

    const res = await ada
      .patch(`/maps/${id}`)
      .send({ title: 'The Reach of Aldermoor' })
      .expect(200);

    expect(res.body.title).toBe('The Reach of Aldermoor');
    // Rename is metadata only: the document and its version are untouched, so an
    // in-progress edit's base version is not invalidated by a rename.
    expect(res.body.version).toBe(2);
    expect(res.body.document).toEqual(painted);

    const reloaded = await ada.get(`/maps/${id}`).expect(200);
    expect(reloaded.body.title).toBe('The Reach of Aldermoor');
    expect(reloaded.body.version).toBe(2);
  });

  it('deletes a map so it can no longer be loaded', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/maps').send({ title: 'Aldermoor' });

    await ada.delete(`/maps/${created.body.id}`).expect(204);

    await ada.get(`/maps/${created.body.id}`).expect(404);
  });

  it('returns 404 when deleting a map that does not exist', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    await ada.delete('/maps/does-not-exist').expect(404);
  });

  it("never lets another user reach a map they do not own", async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/maps').send({ title: 'Aldermoor' });
    const id = created.body.id;

    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    // Bob's list never includes Ada's map...
    const bobsList = await bob.get('/maps').expect(200);
    expect(bobsList.body).toEqual([]);

    // ...and every by-id route is a 404 for him, indistinguishable from a map
    // that does not exist — ownership never leaks (ADR-0004).
    await bob.get(`/maps/${id}`).expect(404);
    await bob
      .put(`/maps/${id}`)
      .send({ document: { hexes: {} }, version: 1 })
      .expect(404);
    await bob.patch(`/maps/${id}`).send({ title: 'Hijacked' }).expect(404);
    await bob.delete(`/maps/${id}`).expect(404);

    // Ada's map is untouched by Bob's probing.
    const reloaded = await ada.get(`/maps/${id}`).expect(200);
    expect(reloaded.body.version).toBe(1);
  });

  it('refuses every map route without a session cookie', async () => {
    const server = app.getHttpServer();

    await request(server).get('/maps').expect(401);
    await request(server).post('/maps').send({ title: 'X' }).expect(401);
    await request(server).get('/maps/any').expect(401);
    await request(server)
      .put('/maps/any')
      .send({ document: { hexes: {} }, version: 1 })
      .expect(401);
    await request(server).patch('/maps/any').send({ title: 'X' }).expect(401);
    await request(server).delete('/maps/any').expect(401);
  });

  it('rejects malformed bodies with 400, not a server error', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/maps').send({ title: 'Aldermoor' });

    // An empty title fails the shared create schema.
    await ada.post('/maps').send({ title: '' }).expect(400);

    // A whitespace-only title trims to "" and is likewise rejected (issues #12,
    // #15) — the server never stores a blank title.
    await ada.post('/maps').send({ title: '   ' }).expect(400);

    // A save with no base version fails the shared save schema (without it the
    // optimistic-concurrency check is meaningless).
    await ada
      .put(`/maps/${created.body.id}`)
      .send({ document: { hexes: {} } })
      .expect(400);

    // A document with an unknown terrain is rejected before it is ever stored.
    await ada
      .put(`/maps/${created.body.id}`)
      .send({ document: { hexes: { '0,0': { terrain: 'lava' } } }, version: 1 })
      .expect(400);

    // An empty rename title fails the shared rename schema.
    await ada.patch(`/maps/${created.body.id}`).send({ title: '' }).expect(400);
  });
});
