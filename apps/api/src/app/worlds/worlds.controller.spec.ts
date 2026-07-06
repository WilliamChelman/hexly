import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';
import { WorldsModule } from './worlds.module';

describe('Worlds endpoints', () => {
  let app: INestApplication;
  let db: Db;
  let adaId: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    adaId = await app
      .get(AuthService)
      .seedUser('ada@hexly.test', 'correct horse', 'Ada', { canCreateWorlds: true });
  });

  afterEach(async () => {
    await app.close();
  });

  async function signIn(email: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  }

  it('creates an empty World, returning its Detail (no seeded Entities, ADR-0043)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');

    const res = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      name: 'Aldermoor',
      // Ownership is a symmetric set (ADR-0037): the creator is its sole Owner.
      owners: [expect.any(String)],
      rights: ['read', 'manage'],
      // No Home Entity is minted — the landing is a derived Dashboard (ADR-0043).
      entityCount: 0,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(res.body).not.toHaveProperty('homeEntityId');
  });

  it('forbids creating a World without the World Creation capability (ADR-0040)', async () => {
    // A user provisioned without World Creation — the in-app default — is gated.
    await app
      .get(AuthService)
      .seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob', {
        canCreateWorlds: false,
      });
    const bob = await signIn('bob@hexly.test', 'hunter2 stationery');

    await bob.post('/worlds').send({ name: 'Nope' }).expect(403);
  });

  it('lets a Superadmin create a World even without the capability (repair, ADR-0040)', async () => {
    await app
      .get(AuthService)
      .seedUser('root@hexly.test', 'repair the realm', 'Root', {
        isSuperadmin: true,
        canCreateWorlds: false,
      });
    const root = await signIn('root@hexly.test', 'repair the realm');

    await root.post('/worlds').send({ name: 'Recovered' }).expect(201);
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
    // Summary carries no homeEntityId (Detail concern).
    expect(res.body[0]).not.toHaveProperty('homeEntityId');
    expect(res.body[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      owners: [expect.any(String)],
      rights: ['read', 'manage'],
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });

  it('includes worlds the caller is a member of, and excludes the rest', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob', { canCreateWorlds: true });
    const bob = await signIn('bob@hexly.test', 'battery staple');

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

  it('gets one reachable World as a Detail', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    const res = await ada.get(`/worlds/${created.body.id}`).expect(200);
    expect(res.body).toEqual(created.body);
  });

  it('carries the caller’s Rights: manage for an Owner, read-only for a member (ADR-0039)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    // Owner holds read + manage on both Detail and summary.
    expect(world.body.rights).toEqual(['read', 'manage']);
    const adaList = await ada.get('/worlds').expect(200);
    expect(adaList.body.find((w: { id: string }) => w.id === world.body.id).rights).toEqual([
      'read',
      'manage',
    ]);

    // A plain member reaches the World read-only — no manage.
    const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    db.$client
      .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'contributor')`)
      .run(world.body.id, bobId);
    const bob = await signIn('bob@hexly.test', 'battery staple');
    expect((await bob.get(`/worlds/${world.body.id}`).expect(200)).body.rights).toEqual(['read']);
    expect((await bob.get('/worlds').expect(200)).body[0].rights).toEqual(['read']);
  });

  it('reports the count of Entities a delete would destroy on the Detail', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    // A fresh World seeds no Entities (ADR-0043).
    expect((await ada.get(`/worlds/${created.body.id}`).expect(200)).body.entityCount).toBe(0);
    await ada
      .post('/entities')
      .send({ name: 'Lady Mara', type: 'note', worldId: created.body.id })
      .expect(201);
    expect((await ada.get(`/worlds/${created.body.id}`).expect(200)).body.entityCount).toBe(1);
  });

  it('returns 404 for a World the caller cannot reach', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    // 404, not 403 (ownership never leaks, ADR-0004).
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
    const note = await ada
      .post('/entities')
      .send({ name: 'Lady Mara', type: 'note', worldId: created.body.id })
      .expect(201);

    await ada.delete(`/worlds/${created.body.id}`).expect(204);

    await ada.get(`/worlds/${created.body.id}`).expect(404);
    // The World's Entities cascade with it.
    await ada.get(`/entities/${note.body.id}`).expect(404);
  });

  it('rejects a delete by a non-Owner with 403, and 404s an unknown World', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    const bob = await signIn('bob@hexly.test', 'battery staple');

    await bob.delete(`/worlds/${created.body.id}`).expect(403);
    await ada.delete('/worlds/does-not-exist').expect(404);

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
