import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { WorldsModule } from './worlds.module';

describe('Worlds endpoints', () => {
  let app: INestApplication;
  let db: Db;
  let adaId: string;

  beforeEach(async () => {
    // Real Drizzle, real schema, isolated per-test (ADR-0002).
    db = createDb(':memory:');
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    adaId = await app
      .get(AuthService)
      .seedUser('ada@hexly.test', 'correct horse', 'Ada');
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

  it('creates a World and its Home Entity atomically, returning both', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      name: 'Aldermoor',
      ownerId: expect.any(String),
      homeEntityId: expect.any(String),
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });

    // The Home Entity exists, belongs to the new World, and is a note.
    const home = await ada.get(`/entities/${res.body.homeEntityId}`).expect(200);
    expect(home.body.worldId).toBe(res.body.id);
    expect(home.body.type).toBe('note');
  });

  it('lists the worlds the caller owns, as summaries', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    await ada.post('/worlds').send({ name: 'Whisperwood' }).expect(201);

    const res = await ada.get('/worlds').expect(200);

    expect(res.body.map((w: { name: string }) => w.name).sort()).toEqual([
      'Aldermoor',
      'Whisperwood',
    ]);
    // A summary carries no homeEntityId — that's a Detail concern.
    expect(res.body[0]).not.toHaveProperty('homeEntityId');
    expect(res.body[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      ownerId: expect.any(String),
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });

  it('includes worlds the caller is a member of, and excludes the rest', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    // Bob owns two worlds; he makes Ada a contributor on one.
    const shared = await bob.post('/worlds').send({ name: 'Shared' }).expect(201);
    await bob.post('/worlds').send({ name: 'Private' }).expect(201);
    db.$client
      .prepare(
        `INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'contributor')`,
      )
      .run(shared.body.id, adaId);

    const res = await ada.get('/worlds').expect(200);
    expect(res.body.map((w: { name: string }) => w.name).sort()).toEqual([
      'Shared',
    ]);
  });

  it('gets one reachable World as a Detail, with its Home Entity id', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    const res = await ada.get(`/worlds/${created.body.id}`).expect(200);
    expect(res.body).toEqual(created.body);
  });

  it('returns 404 for a World the caller cannot reach', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    // 404, not 403 — a World the caller has no part in never leaks (ADR-0004).
    await bob.get(`/worlds/${created.body.id}`).expect(404);
    await bob.get('/worlds/does-not-exist').expect(404);
  });

  it('renames a World for its Owner', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    const res = await ada
      .patch(`/worlds/${created.body.id}`)
      .send({ name: 'The Reach of Aldermoor' })
      .expect(200);
    expect(res.body.name).toBe('The Reach of Aldermoor');
    expect(res.body.id).toBe(created.body.id);

    const reloaded = await ada.get(`/worlds/${created.body.id}`).expect(200);
    expect(reloaded.body.name).toBe('The Reach of Aldermoor');
  });

  it('rejects a rename by a non-Owner with 403, leaving the World untouched', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    await bob
      .patch(`/worlds/${created.body.id}`)
      .send({ name: 'Hijacked' })
      .expect(403);

    const reloaded = await ada.get(`/worlds/${created.body.id}`).expect(200);
    expect(reloaded.body.name).toBe('Aldermoor');
  });

  it('deletes a World for its Owner, taking its Entities with it', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    const homeId = created.body.homeEntityId;

    await ada.delete(`/worlds/${created.body.id}`).expect(204);

    await ada.get(`/worlds/${created.body.id}`).expect(404);
    // The Home Entity goes with the World — the container is gone.
    await ada.get(`/entities/${homeId}`).expect(404);
  });

  it('rejects a delete by a non-Owner with 403, and 404s an unknown World', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    await bob.delete(`/worlds/${created.body.id}`).expect(403);
    await ada.delete('/worlds/does-not-exist').expect(404);

    // Still there after the rejected delete.
    await ada.get(`/worlds/${created.body.id}`).expect(200);
  });

  it('refuses every World route without a session cookie', async () => {
    const server = app.getHttpServer();

    await request(server).get('/worlds').expect(401);
    await request(server).post('/worlds').send({ name: 'X' }).expect(401);
    await request(server).get('/worlds/any').expect(401);
    await request(server).patch('/worlds/any').send({ name: 'X' }).expect(401);
    await request(server).delete('/worlds/any').expect(401);
  });
});
