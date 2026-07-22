import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import sharp from 'sharp';
import request from 'supertest';
import { CONTENT_FIELD_ID, tiptapContent } from '@hexly/plugin-content';
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
        types: ['core.type.note'],
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
        types: ['core.type.note'],
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
      .send({ name: 'A', types: ['core.type.note'], worldId: world.body.id })
      .expect(201);
    const b = await ada
      .post('/entities')
      .send({ name: 'B', types: ['core.type.note'], worldId: world.body.id })
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
        .send({ name, types: ['core.type.note'], worldId: world.body.id })
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
      .send({ name: 'A', types: ['core.type.note'], worldId: world.body.id })
      .expect(201);
    const b = await ada
      .post('/entities')
      .send({ name: 'B', types: ['core.type.note'], worldId: world.body.id })
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
        types: ['core.type.note'],
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

    it('uploads a file, minting the wrapper Asset Entity, and lists it in the picker (ADR-0065)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

      // A fresh World carries no Assets.
      expect((await ada.get(`/worlds/${world.body.id}/assets`).expect(200)).body).toEqual([]);

      // The endpoint returns the wrapper Entity: named after the filename stem, carrying core.type.asset,
      // visibility `shared`, its asset-ref pinning the extension in the (stable) capability URL.
      const res = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: 'Portrait',
        types: ['core.type.asset'],
        visibility: 'shared',
      });
      const ref = res.body.document['core.field.asset'];
      expect(ref).toMatchObject({ ext: '.png', mime: 'image/png', size: PNG.length, stats: null });
      expect(ref.hash).toMatch(/^[0-9a-f]{64}$/);

      // The uploader is the sole Owner — reading the Entity back carries full `manage` rights.
      const detail = await ada.get(`/entities/${res.body.id}`).expect(200);
      expect(detail.body.rights).toContain('manage');

      // The picker surfaces the minted Asset as an AssetSummary (url + label metadata).
      expect((await ada.get(`/worlds/${world.body.id}/assets`).expect(200)).body).toEqual([
        {
          url: `/assets/${world.body.id}/${ref.hash}.png`,
          thumbnailUrl: `/assets/${world.body.id}/${ref.hash}.thumb.webp`,
          originalFilename: 'Portrait.png',
          mime: 'image/png',
          size: PNG.length,
        },
      ]);
    });

    it('dedups identical bytes to the existing Asset — no twin, the first name sticks (ADR-0065)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

      const first = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      // Same bytes, different filename: returns the SAME Entity, keeping the first name.
      const again = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'copy.png').expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.name).toBe('Portrait');

      // The picker still lists exactly one Asset.
      expect((await ada.get(`/worlds/${world.body.id}/assets`).expect(200)).body).toHaveLength(1);
    });

    it('dedups a `shared` Asset for another Contributor, echoing the whole wrapper unchanged (ADR-0065)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      addMember(world.body.id, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const first = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      // Ada's Asset keeps the upload default `shared`, so Bob may read it: the dedup returns it whole,
      // the first name intact — ADR-0046 redaction applies only to an unreadable twin.
      const again = await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'copy.png').expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.name).toBe('Portrait');
      expect(again.body.visibility).toBe('shared');
    });

    it("redacts a dedup to another user's `private` Asset — no name/prose/Tags/visibility leak (ADR-0046)", async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      addMember(world.body.id, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      // Ada uploads, curates the wrapper (Tags + prose), then makes it `private` = "only in my picker".
      const first = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      await ada
        .put(`/entities/${first.body.id}`)
        .send({
          document: {
            ...first.body.document,
            [CONTENT_FIELD_ID]: tiptapContent({
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ADA-SECRET-PROSE' }] }],
            }),
          },
          tags: ['ada-secret-tag'],
          version: first.body.version,
        })
        .expect(200);
      await ada.patch(`/entities/${first.body.id}`).send({ visibility: 'private' }).expect(200);

      // Bob uploads identical bytes: mint dedups to Ada's row (no twin), but Bob cannot read it, so the
      // response is redacted — shaped like a fresh mint of his own bytes, echoing none of Ada's curation.
      const again = await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Copy.png').expect(201);
      expect(again.body.id).toBe(first.body.id); // the real handle, but access-checked everywhere else
      expect(again.body.name).toBe('Copy'); // Bob's own filename stem, never Ada's 'Portrait'
      expect(again.body.visibility).toBe('shared'); // the fresh-mint default, never the real 'private'
      expect(again.body.tags).toEqual([]); // Ada's Tags redacted
      const doc = JSON.stringify(again.body.document);
      expect(doc).not.toContain('ADA-SECRET-PROSE'); // no prose leak
      expect(doc).not.toContain('ada-secret'); // no Tag leak
      // The served URL still resolves (same content address) — the Board picker upload flow keeps working.
      expect(again.body.document['core.field.asset'].hash).toBe(first.body.document['core.field.asset'].hash);

      // Bob still cannot enumerate Ada's `private` Asset in his picker — indistinguishable from missing.
      expect((await bob.get(`/worlds/${world.body.id}/assets`).expect(200)).body).toEqual([]);
    });

    it('renaming the Asset never moves the served capability URL (extension pinned at mint, ADR-0065)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const res = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      const url = `/assets/${world.body.id}/${res.body.document['core.field.asset'].hash}.png`;

      await ada.patch(`/entities/${res.body.id}`).send({ name: 'A New Name' }).expect(200);

      const summaries = (await ada.get(`/worlds/${world.body.id}/assets`).expect(200)).body;
      // The URL is byte-identical; only the picker label follows the rename.
      expect(summaries[0].url).toBe(url);
      expect(summaries[0].originalFilename).toBe('A New Name.png');
    });

    it('lets a Contributor mint an Asset (Entity-creation-shaped, not a management power)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      addMember(world.body.id, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const res = await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Map.png').expect(201);
      expect(res.body.name).toBe('Map');
      // A Contributor may also browse the picker list (same contribute standing gates both, board review).
      expect((await bob.get(`/worlds/${world.body.id}/assets`).expect(200)).body).toEqual([
        {
          url: `/assets/${world.body.id}/${res.body.document['core.field.asset'].hash}.png`,
          thumbnailUrl: `/assets/${world.body.id}/${res.body.document['core.field.asset'].hash}.thumb.webp`,
          originalFilename: 'Map.png',
          mime: 'image/png',
          size: PNG.length,
        },
      ]);
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

    describe('Asset Stats & thumbnails at mint (ADR-0065)', () => {
      it('mints an image with populated Asset Stats and a served WebP thumbnail (sharp in-process)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
        // A real tiny image sharp can parse: 12×4 (landscape) solid red.
        const banner = await sharp({
          create: { width: 12, height: 4, channels: 3, background: { r: 200, g: 24, b: 24 } },
        })
          .png()
          .toBuffer();

        const res = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', banner, 'Banner.png').expect(201);
        const ref = res.body.document['core.field.asset'];
        // Dimensions, orientation, and a #rrggbb dominant color land in the asset-ref.
        expect(ref.stats).toEqual({
          width: 12,
          height: 4,
          orientation: 'landscape',
          dominantColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
        });

        // The thumbnail is served on the same unauthenticated static route, as a real WebP.
        const thumb = await ada.get(`/assets/${world.body.id}/${ref.hash}.thumb.webp`).expect(200);
        expect(thumb.headers['content-type']).toContain('image/webp');
      });

      it('succeeds with null stats and no thumbnail when sharp cannot parse the bytes', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

        // PNG is a fake header sharp rejects: the mint still succeeds, just statless (ADR-0065).
        const res = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Broken.png').expect(201);
        const ref = res.body.document['core.field.asset'];
        expect(ref.stats).toBeNull();

        // No thumbnail was minted, so the thumb URL falls back to the original bytes (a PNG, not a WebP).
        const thumb = await ada.get(`/assets/${world.body.id}/${ref.hash}.thumb.webp`).expect(200);
        expect(thumb.headers['content-type']).toContain('image/png');
      });
    });

    describe('usage, delete & heal (ADR-0065, #277)', () => {
      /** Create a Note whose prose embeds the Asset at `src`, so the content-addressed asset edge is harvested. */
      async function noteEmbedding(agent: request.Agent, worldId: string, name: string, src: string): Promise<string> {
        const note = (
          await agent
            .post('/entities')
            .send({ name, types: ['core.type.note'], worldId })
            .expect(201)
        ).body;
        await agent
          .put(`/entities/${note.id}`)
          .send({
            version: note.version,
            tags: [],
            document: {
              'core.field.content': tiptapContent({ type: 'doc', content: [{ type: 'image', attrs: { src } }] }),
            },
          })
          .expect(200);
        return note.id;
      }

      it('resolves a Content prose reference into the Asset’s inbound-link usage', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201))
          .body;
        const src = `/assets/${world.id}/${asset.document['core.field.asset'].hash}.png`;

        // A freshly-minted Asset is unused.
        expect((await ada.get(`/entities/${asset.id}/references`).expect(200)).body.referencedBy).toEqual([]);

        const note = await noteEmbedding(ada, world.id, 'Character Sheet', src);

        // The hash edge the Note harvested resolves to the Asset Entity at read time — usage is an inbound link.
        expect((await ada.get(`/entities/${asset.id}/references`).expect(200)).body.referencedBy).toEqual([
          { descriptor: null, source: { id: note, name: 'Character Sheet', types: ['core.type.note'] } },
        ]);
      });

      it('takes the bytes and thumbnail with the Asset Entity on delete', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        // A real image so a WebP thumbnail is minted beside the bytes.
        const banner = await sharp({
          create: { width: 12, height: 4, channels: 3, background: { r: 200, g: 24, b: 24 } },
        })
          .png()
          .toBuffer();
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', banner, 'Banner.png').expect(201))
          .body;
        const hash = asset.document['core.field.asset'].hash;

        // Both serve before deletion.
        await ada.get(`/assets/${world.id}/${hash}.png`).expect(200);
        await ada.get(`/assets/${world.id}/${hash}.thumb.webp`).expect(200);

        await ada.delete(`/entities/${asset.id}`).expect(204);

        // Bytes and thumbnail are gone from disk — the served route (thumb→original fallback included) 404s both.
        expect(existsSync(join(assetsDir, world.id, `${hash}.png`))).toBe(false);
        expect(existsSync(join(assetsDir, world.id, `${hash}.thumb.webp`))).toBe(false);
        await ada.get(`/assets/${world.id}/${hash}.png`).expect(404);
        await ada.get(`/assets/${world.id}/${hash}.thumb.webp`).expect(404);
      });

      it('heals every dangling reference when identical bytes are re-uploaded (same hash, same URL)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201))
          .body;
        const hash = asset.document['core.field.asset'].hash;
        const src = `/assets/${world.id}/${hash}.png`;
        const note = await noteEmbedding(ada, world.id, 'Character Sheet', src);

        await ada.delete(`/entities/${asset.id}`).expect(204);
        // The Asset Entity is gone: its byte URL 404s and the Note's reference now dangles.
        await ada.get(`/entities/${asset.id}/references`).expect(404);
        await ada.get(src).expect(404);

        // Re-upload the identical bytes: content-addressed, so the same hash → same URL, a fresh wrapper Entity.
        const healed = (
          await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Portrait-again.png').expect(201)
        ).body;
        expect(healed.document['core.field.asset'].hash).toBe(hash);
        expect(healed.id).not.toBe(asset.id);

        // The bytes serve again, and the Note's untouched reference resolves to the new Asset — healed for free.
        await ada.get(src).expect(200);
        expect((await ada.get(`/entities/${healed.id}/references`).expect(200)).body.referencedBy).toEqual([
          { descriptor: null, source: { id: note, name: 'Character Sheet', types: ['core.type.note'] } },
        ]);
      });
    });

    describe('Entity Browser: hidden-by-default type + asset facets (ADR-0065, #278)', () => {
      /** A real landscape image sharp can parse, so the mint writes orientation + a dominant color → hue facet. */
      async function banner(): Promise<Buffer> {
        return sharp({ create: { width: 12, height: 4, channels: 3, background: { r: 200, g: 24, b: 24 } } })
          .png()
          .toBuffer();
      }

      /** The field-facet keys a facets read offers (kind/orientation/hue etc.), for presence assertions. */
      const fieldKeys = (facets: { fields: { key: string }[] }) => facets.fields.map((f) => f.key).sort();

      it('omits Assets from the default listing but includes them once the asset type is selected', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const note = (
          await ada
            .post('/entities')
            .send({ name: 'Lore', types: ['core.type.note'], worldId: world.id })
            .expect(201)
        ).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201))
          .body;

        // Default listing: the authored Note is present, the Asset is absent (hidden by its type, not by name).
        const defaultIds = (await ada.get('/entities').query({ worldId: world.id }).expect(200)).body.items.map(
          (e: { id: string }) => e.id,
        );
        expect(defaultIds).toContain(note.id);
        expect(defaultIds).not.toContain(asset.id);

        // Selecting the asset type in the type facet includes the Asset in results.
        const selectedIds = (
          await ada.get('/entities').query({ worldId: world.id, type: 'core.type.asset' }).expect(200)
        ).body.items.map((e: { id: string }) => e.id);
        expect(selectedIds).toEqual([asset.id]);
      });

      it('attaches a served thumbnail URL to an Asset row when the list opts in, and none to a non-Asset (#282)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const note = (
          await ada
            .post('/entities')
            .send({ name: 'Lore', types: ['core.type.note'], worldId: world.id })
            .expect(201)
        ).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201))
          .body;
        const hash = asset.document['core.field.asset'].hash;

        // The Asset Browser opts in (thumbnails=1) and pins the asset type; each Asset row carries its
        // served thumbnail URL, derived generically off the dedup index (ADR-0065) — safe to use even when
        // no thumbnail was minted, the serving route falls back to the original bytes.
        const assets = (
          await ada.get('/entities').query({ worldId: world.id, type: 'core.type.asset', thumbnails: '1' }).expect(200)
        ).body.items;
        expect(assets).toHaveLength(1);
        expect(assets[0].thumbnailUrl).toBe(`/assets/${world.id}/${hash}.thumb.webp`);

        // An ordinary (non-Asset) row carries no thumbnail URL even under the opt-in — it holds no bytes.
        const notes = (await ada.get('/entities').query({ worldId: world.id, thumbnails: '1' }).expect(200)).body.items;
        expect(notes.find((e: { id: string }) => e.id === note.id).thumbnailUrl).toBeUndefined();
      });

      it('resolves a hidden-type Asset by an explicit id lookup — an id lookup is not a default listing (#278)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201))
          .body;

        // The `/entities/:id` redirect guard (Quick Open, pins, recents) looks up by id with no type
        // selected. The hidden-type exclusion must not swallow that lookup, or the redirect never fires.
        const byId = (await ada.get('/entities').query({ ids: asset.id }).expect(200)).body.items;
        expect(byId.map((e: { id: string }) => e.id)).toEqual([asset.id]);
      });

      it('matches a hidden-type Asset by name — Quick Open treats an Asset like any Entity (#282)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Sigil.png').expect(201)).body;

        // Quick Open searches by name (FTS `q`) with no type selected. A name search is not a default
        // listing, so the hidden-type exclusion lifts and the Asset matches — ADR-0065's "Quick Open ...
        // treats Assets like any Entity".
        const byName = (await ada.get('/entities').query({ worldId: world.id, q: 'Sigil' }).expect(200)).body.items;
        expect(byName.map((e: { id: string }) => e.id)).toContain(asset.id);
      });

      it('lists the asset type in the type facet with a count even when unselected, so it can be opted into', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        await ada
          .post('/entities')
          .send({ name: 'Lore', types: ['core.type.note'], worldId: world.id })
          .expect(201);
        await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);

        // The type facet is the opt-in surface: it counts over the full universe, so the hidden asset type
        // still appears with its true count. The sibling facets, though, exclude the Asset by default —
        // no asset field facets (kind/orientation/hue) surface until the type is selected.
        const base = (await ada.get('/entities/facets').query({ worldId: world.id }).expect(200)).body;
        expect(base.type).toContainEqual({ value: 'core.type.asset', count: 1 });
        expect(base.type).toContainEqual({ value: 'core.type.note', count: 1 });
        expect(fieldKeys(base)).toEqual([]);
      });

      it('counts a name-matched hidden-type Asset in the sibling facets, matching the list a name search returns (#284)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Dragon.png').expect(201)).body;
        // Tag the Asset so the name search also has a Tag facet value to count.
        await ada
          .put(`/entities/${asset.id}`)
          .send({ version: asset.version, tags: ['bestiary'], document: asset.document })
          .expect(200);

        // A name search (`q`) with no type selected lifts the hidden-type exclusion on both seams (ADR-0065).
        const listed = (await ada.get('/entities').query({ worldId: world.id, q: 'Dragon' }).expect(200)).body.items;
        expect(listed.map((e: { id: string }) => e.id)).toContain(asset.id);

        // The Facet rail must not contradict those results: the Asset is counted in visibility and tag.
        const facets = (await ada.get('/entities/facets').query({ worldId: world.id, q: 'Dragon' }).expect(200)).body;
        // The upload default is `shared` (ADR-0065), so it's counted there.
        expect(facets.visibility).toContainEqual({ value: 'shared', count: 1 });
        expect(facets.tag).toContainEqual({ value: 'bestiary', count: 1 });
      });

      it('surfaces kind / orientation / hue / Tag facets with counts once the asset type is selected', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (
          await ada
            .post(`/worlds/${world.id}/assets`)
            .attach('file', await banner(), 'Banner.png')
            .expect(201)
        ).body;
        // Tag the Asset so the Tag facet has a value to offer under the asset type.
        await ada
          .put(`/entities/${asset.id}`)
          .send({ version: asset.version, tags: ['portrait'], document: asset.document })
          .expect(200);

        const facets = (
          await ada.get('/entities/facets').query({ worldId: world.id, type: 'core.type.asset' }).expect(200)
        ).body;
        // The harvested asset dimensions surface by presence, each with a live count.
        expect(fieldKeys(facets)).toEqual(['hue', 'kind', 'orientation']);
        const kind = facets.fields.find((f: { key: string }) => f.key === 'kind');
        expect(kind.values).toContainEqual({ value: 'image', count: 1 });
        const orientation = facets.fields.find((f: { key: string }) => f.key === 'orientation');
        expect(orientation.values).toContainEqual({ value: 'landscape', count: 1 });
        // The Tag facet counts the Asset's tag under the selected type.
        expect(facets.tag).toContainEqual({ value: 'portrait', count: 1 });
      });
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
