import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { ASSETS_DIR } from '../assets/assets.service';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';
import { WorldsModule } from './worlds.module';

describe('Worlds endpoints', () => {
  let app: INestApplication;
  let db: Db;
  let adaId: string;
  let assetsDir: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    // A throwaway Assets root, so the upload endpoint's bytes never litter the repo (the default
    // resolves beside `hexly.db`, i.e. under the source tree for a `:memory:` DB).
    assetsDir = mkdtempSync(join(tmpdir(), 'hexly-worlds-assets-'));
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(ASSETS_DIR)
      .useValue(assetsDir)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    adaId = await app.get(AuthService).seedUser('ada@hexly.test', 'correct horse', 'Ada', {
      roles: ['create-worlds'],
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(assetsDir, { recursive: true, force: true });
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
      // A fresh World carries no Owner-curated pins (ADR-0043, #168).
      pinnedEntityIds: [],
      // The live-follow freshness key (ADR-0045); a fresh World is at sequence 1.
      seq: 1,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(res.body).not.toHaveProperty('homeEntityId');
  });

  it('forbids creating a World without the World Creation capability (ADR-0040)', async () => {
    // A user provisioned without World Creation — the in-app default — is gated.
    await app.get(AuthService).seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob', {
      roles: [],
    });
    const bob = await signIn('bob@hexly.test', 'hunter2 stationery');

    await bob.post('/worlds').send({ name: 'Nope' }).expect(403);
  });

  it('lets a Superadmin create a World even without the capability (repair, ADR-0040)', async () => {
    await app.get(AuthService).seedUser('root@hexly.test', 'repair the realm', 'Root', {
      isSuperadmin: true,
      roles: [],
    });
    const root = await signIn('root@hexly.test', 'repair the realm');

    await root.post('/worlds').send({ name: 'Recovered' }).expect(201);
  });

  it('lists the worlds the caller owns, as summaries', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    await ada.post('/worlds').send({ name: 'Whisperwood' }).expect(201);

    const res = await ada.get('/worlds').expect(200);

    expect(res.body.map((w: { name: string }) => w.name).sort()).toEqual(['Aldermoor', 'Whisperwood']);
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
    await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob', {
      roles: ['create-worlds'],
    });
    const bob = await signIn('bob@hexly.test', 'battery staple');

    const shared = await bob.post('/worlds').send({ name: 'Shared' }).expect(201);
    await bob.post('/worlds').send({ name: 'Private' }).expect(201);
    db.$client
      .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'contributor')`)
      .run(shared.body.id, adaId);

    const res = await ada.get('/worlds').expect(200);
    expect(res.body.map((w: { name: string }) => w.name).sort()).toEqual(['Shared']);
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
    expect(adaList.body.find((w: { id: string }) => w.id === world.body.id).rights).toEqual(['read', 'manage']);

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
      .send({
        name: 'Lady Mara',
        types: ['core.note'],
        worldId: created.body.id,
      })
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

    const res = await ada.patch(`/worlds/${created.body.id}`).send({ name: 'The Reach of Aldermoor' }).expect(200);
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

    await bob.patch(`/worlds/${created.body.id}`).send({ name: 'Hijacked' }).expect(403);

    const reloaded = await ada.get(`/worlds/${created.body.id}`).expect(200);
    expect(reloaded.body.name).toBe('Aldermoor');
  });

  it('deletes a World for its Owner, taking its Entities with it', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const created = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    const note = await ada
      .post('/entities')
      .send({
        name: 'Lady Mara',
        types: ['core.note'],
        worldId: created.body.id,
      })
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

  it('lets an Owner set the World’s Pinned Entities via PATCH, reflected on the Detail (#168)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    // A fresh World has no pins.
    expect(world.body.pinnedEntityIds).toEqual([]);

    const a = await ada
      .post('/entities')
      .send({ name: 'A', types: ['core.note'], worldId: world.body.id })
      .expect(201);
    const b = await ada
      .post('/entities')
      .send({ name: 'B', types: ['core.note'], worldId: world.body.id })
      .expect(201);

    const res = await ada
      .patch(`/worlds/${world.body.id}`)
      .send({ pinnedEntityIds: [a.body.id, b.body.id] })
      .expect(200);
    expect(res.body.pinnedEntityIds).toEqual([a.body.id, b.body.id]);

    const reloaded = await ada.get(`/worlds/${world.body.id}`).expect(200);
    expect(reloaded.body.pinnedEntityIds).toEqual([a.body.id, b.body.id]);
  });

  it('reorders and removes pins via the replacement array, preserving order (#168)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      const e = await ada
        .post('/entities')
        .send({ name, types: ['core.note'], worldId: world.body.id })
        .expect(201);
      ids.push(e.body.id);
    }
    await ada.patch(`/worlds/${world.body.id}`).send({ pinnedEntityIds: ids }).expect(200);

    // Reorder wholesale: reverse the set.
    const reversed = [...ids].reverse();
    const res = await ada.patch(`/worlds/${world.body.id}`).send({ pinnedEntityIds: reversed }).expect(200);
    expect(res.body.pinnedEntityIds).toEqual(reversed);

    // Remove the middle by omitting it from the array.
    const withoutB = reversed.filter((id) => id !== ids[1]);
    const removed = await ada.patch(`/worlds/${world.body.id}`).send({ pinnedEntityIds: withoutB }).expect(200);
    expect(removed.body.pinnedEntityIds).toEqual(withoutB);

    // A name-only PATCH leaves the pins untouched (independent fields).
    const renamed = await ada.patch(`/worlds/${world.body.id}`).send({ name: 'Renamed' }).expect(200);
    expect(renamed.body.name).toBe('Renamed');
    expect(renamed.body.pinnedEntityIds).toEqual(withoutB);
  });

  it('dedupes pinned ids at the boundary so the Dashboard never gets duplicate cards (#168)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    const a = await ada
      .post('/entities')
      .send({ name: 'A', types: ['core.note'], worldId: world.body.id })
      .expect(201);
    const b = await ada
      .post('/entities')
      .send({ name: 'B', types: ['core.note'], worldId: world.body.id })
      .expect(201);

    // A duplicate id (reachable directly via the API) collapses to one, first-wins order.
    const res = await ada
      .patch(`/worlds/${world.body.id}`)
      .send({ pinnedEntityIds: [a.body.id, b.body.id, a.body.id] })
      .expect(200);
    expect(res.body.pinnedEntityIds).toEqual([a.body.id, b.body.id]);
  });

  it('shares one pin set: a member reads the same pins the Owner curated (#168)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    const note = await ada
      .post('/entities')
      .send({
        name: 'Shared lore',
        types: ['core.note'],
        worldId: world.body.id,
      })
      .expect(201);
    await ada
      .patch(`/worlds/${world.body.id}`)
      .send({ pinnedEntityIds: [note.body.id] })
      .expect(200);

    const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    db.$client
      .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'viewer')`)
      .run(world.body.id, bobId);
    const bob = await signIn('bob@hexly.test', 'battery staple');

    // The pin set is a World property — the same list for everyone (ADR-0043).
    expect((await bob.get(`/worlds/${world.body.id}`).expect(200)).body.pinnedEntityIds).toEqual([note.body.id]);
  });

  it('refuses a Contributor or Viewer setting pins with 403 (#168)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    db.$client
      .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'contributor')`)
      .run(world.body.id, bobId);
    const bob = await signIn('bob@hexly.test', 'battery staple');

    await bob
      .patch(`/worlds/${world.body.id}`)
      .send({ pinnedEntityIds: ['x'] })
      .expect(403);
    // The pins stayed empty — a refused PATCH writes nothing.
    expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body.pinnedEntityIds).toEqual([]);
  });

  describe('World Assets (#269, ADR-0034)', () => {
    /** A tiny valid-enough PNG; only its bytes' identity matters for the content address. */
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    /** Add `userId` to `worldId` with the given member role (Owners come from world creation). */
    function addMember(worldId: string, userId: string, role: 'contributor' | 'viewer') {
      db.$client
        .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, ?)`)
        .run(worldId, userId, role);
    }

    it('uploads a file, minting an Asset the author can reference, and lists it', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

      // A fresh World carries no Assets.
      expect((await ada.get(`/worlds/${world.body.id}/assets`).expect(200)).body).toEqual([]);

      const res = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      expect(res.body).toEqual({
        url: expect.stringMatching(new RegExp(`^/assets/${world.body.id}/[0-9a-f]{64}\\.png$`)),
        originalFilename: 'Portrait.png',
        mime: 'image/png',
        size: PNG.length,
      });
      // The picker now surfaces the minted Asset.
      expect((await ada.get(`/worlds/${world.body.id}/assets`).expect(200)).body).toEqual([res.body]);
    });

    it('lets a Contributor mint an Asset (Entity-creation-shaped, not a management power)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      addMember(world.body.id, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const res = await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Map.png').expect(201);
      expect(res.body.originalFilename).toBe('Map.png');
      // A Contributor may also browse the picker list (same contribute standing gates both, board review).
      expect((await bob.get(`/worlds/${world.body.id}/assets`).expect(200)).body).toEqual([res.body]);
    });

    it('refuses a Viewer listing or minting Assets with 403 (reachable, but no contribute standing)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      addMember(world.body.id, bobId, 'viewer');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      // The picker is an editing surface and a listed URL is fetchable via the guard-less serving
      // route, so a Viewer can neither enumerate nor mint (board review) — both are contributor-gated.
      await bob.get(`/worlds/${world.body.id}/assets`).expect(403);
      await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Nope.png').expect(403);
    });

    it('404s an unreachable World on both list and upload (existence never leaks, ADR-0004)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      await bob.get(`/worlds/${world.body.id}/assets`).expect(404);
      await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(404);
    });

    it('400s an upload with no file part', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

      await ada.post(`/worlds/${world.body.id}/assets`).expect(400);
    });
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
