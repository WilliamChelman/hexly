import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import sharp from 'sharp';
import request from 'supertest';
import { CONTENT_FIELD_ID, tiptapContent } from '@hexly/plugin-content';
import { updateWorldRequestSchema } from '@hexly/domain';
import { DB, Db, createDb } from '../db/db';
import { ASSETS_DIR } from '../assets/assets.service';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { EntityWrites } from '../entities/entity-writes';
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
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);

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
      // A new World is a campaign unless said otherwise (ADR-0080).
      kind: 'campaign',
      rights: ['read', 'create-entity', 'manage'],
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
      // Campaign-or-Shelf rides the Summary so the World Index can group by it (ADR-0080).
      kind: 'campaign',
      rights: ['read', 'create-entity', 'manage'],
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

  it('carries the caller’s Rights: manage for an Owner, create-entity for a Contributor (ADR-0039)', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

    // Owner holds the full set on both Detail and summary.
    expect(world.body.rights).toEqual(['read', 'create-entity', 'manage']);
    const adaList = await ada.get('/worlds').expect(200);
    expect(adaList.body.find((w: { id: string }) => w.id === world.body.id).rights).toEqual([
      'read',
      'create-entity',
      'manage',
    ]);

    // A Contributor may author Entities but not manage the World — the `owner ∨ contributor` rule
    // the Entity-creation filter enforces, made client-readable (ADR-0073).
    const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
    db.$client
      .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'contributor')`)
      .run(world.body.id, bobId);
    const bob = await signIn('bob@hexly.test', 'battery staple');
    expect((await bob.get(`/worlds/${world.body.id}`).expect(200)).body.rights).toEqual(['read', 'create-entity']);
    expect((await bob.get('/worlds').expect(200)).body[0].rights).toEqual(['read', 'create-entity']);

    // A World Viewer reaches it read-only.
    const camId = await app.get(AuthService).seedUser('cam@hexly.test', 'stapler battery', 'Cam');
    db.$client
      .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'viewer')`)
      .run(world.body.id, camId);
    const cam = await signIn('cam@hexly.test', 'stapler battery');
    expect((await cam.get(`/worlds/${world.body.id}`).expect(200)).body.rights).toEqual(['read']);
    expect((await cam.get('/worlds').expect(200)).body[0].rights).toEqual(['read']);
  });

  // The Editor of one Entity is not a Contributor in its World: they reach the World (ADR-0037's
  // grant residue) but hold no `create-entity`, which is what makes the Create rows absent rather
  // than present-and-failing (ADR-0073, #345).
  it('withholds create-entity from an Entity Editor with no member row, and the write agrees', async () => {
    const ada = await signIn('ada@hexly.test', 'correct horse');
    const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
    const note = await ada
      .post('/entities')
      .send({ name: 'Lady Mara', types: ['core.type.note'], worldId: world.body.id })
      .expect(201);

    const evaId = await app.get(AuthService).seedUser('eva@hexly.test', 'quiet lantern', 'Eva');
    await ada.post(`/entities/${note.body.id}/grants`).send({ userId: evaId, role: 'editor' }).expect(200);

    const eva = await signIn('eva@hexly.test', 'quiet lantern');
    expect((await eva.get(`/worlds/${world.body.id}`).expect(200)).body.rights).toEqual(['read']);
    expect((await eva.get('/worlds').expect(200)).body[0].rights).toEqual(['read']);

    // The Right is the same rule the write enforces — the create resolves its target World through
    // `canCreateEntityFilter`, so a caller without the standing finds no writable World (404).
    await eva
      .post('/entities')
      .send({ name: 'Zorblax', types: ['core.type.note'], worldId: world.body.id })
      .expect(404);
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

  describe('the Shelf label (ADR-0080, #409)', () => {
    it('lets an Owner label a World a Shelf, and the label persists', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'The Art Shelf' }).expect(201);
      // A new World is a campaign unless said otherwise.
      expect(world.body.kind).toBe('campaign');

      const patched = await ada.patch(`/worlds/${world.body.id}`).send({ kind: 'shelf' }).expect(200);
      expect(patched.body.kind).toBe('shelf');

      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body.kind).toBe('shelf');
      // And back again — the label is a curation, not a one-way door.
      await ada.patch(`/worlds/${world.body.id}`).send({ kind: 'campaign' }).expect(200);
      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body.kind).toBe('campaign');
    });

    it('refuses a Contributor labelling a World with 403, and a value that is neither with 400', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      db.$client
        .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'contributor')`)
        .run(world.body.id, bobId);
      const bob = await signIn('bob@hexly.test', 'battery staple');

      await bob.patch(`/worlds/${world.body.id}`).send({ kind: 'shelf' }).expect(403);
      await ada.patch(`/worlds/${world.body.id}`).send({ kind: 'bestiary' }).expect(400);

      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body.kind).toBe('campaign');
    });

    /**
     * The whole point of the label, and the thing to guard (ADR-0080): a Shelf is a World in every
     * respect but the World Index's grouping. If a read ever starts answering differently because a
     * World is a Shelf, this is where it shows.
     */
    it('withholds nothing from a Shelf: it lists, reads, keeps members, a Public Link and a Graph', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const shelf = await ada.post('/worlds').send({ name: 'The Art Shelf' }).expect(201);
      const campaign = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      await ada.patch(`/worlds/${shelf.body.id}`).send({ kind: 'shelf' }).expect(200);
      await ada
        .post('/entities')
        .send({ name: 'A tavern sketch', types: ['core.type.note'], worldId: shelf.body.id })
        .expect(201);

      // The listing carries it, beside the campaign — grouping is the client's, not the query's.
      const listed = await ada.get('/worlds').expect(200);
      expect(listed.body.map((w: { id: string }) => w.id).sort()).toEqual([campaign.body.id, shelf.body.id].sort());

      // Collaboration, sharing and the derived views are all still the Shelf's.
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      await ada.post(`/worlds/${shelf.body.id}/members`).send({ userId: bobId, role: 'viewer' }).expect(200);
      expect((await ada.get(`/worlds/${shelf.body.id}/members`).expect(200)).body).toEqual([
        { userId: bobId, role: 'viewer' },
      ]);
      expect((await ada.post(`/worlds/${shelf.body.id}/link`).expect(200)).body.token).toEqual(expect.any(String));
      expect((await ada.get(`/worlds/${shelf.body.id}/graph`).expect(200)).body.nodes).toHaveLength(1);
      // And its Entities answer the same World-scoped read a campaign's do.
      const entities = await ada.get(`/entities?worldId=${shelf.body.id}`).expect(200);
      expect(entities.body.items).toHaveLength(1);
    });
  });

  describe('World Theme (ADR-0076)', () => {
    /** One ColorScheme's eight anchors and three knobs (spec §1), as an Owner would send them. */
    const PALETTE = {
      page: '#f1e5c7',
      ink: '#2e2412',
      inkQuiet: '#6f5a36',
      accent: '#9a6a16',
      danger: '#a4402e',
      success: '#4a6f2f',
      canvas: '#efe2bf',
      soot: '#3c2c16',
      polarity: 1,
      lineAlpha: 0.371,
      veil: 0.12,
    };
    const THEME = { version: 2, light: PALETTE, dark: { ...PALETTE, polarity: -1 } };

    /** Add `userId` to `worldId` with the given member role (Owners come from world creation). */
    function addMember(worldId: string, userId: string, role: 'contributor' | 'viewer') {
      db.$client
        .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, ?)`)
        .run(worldId, userId, role);
    }

    it('round-trips a Theme through PATCH and the World read, as colours', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      // A World that never had a Theme reads back without one.
      expect(world.body).not.toHaveProperty('theme');

      const res = await ada.patch(`/worlds/${world.body.id}`).send({ theme: THEME }).expect(200);

      // Stored canonicalised: a colour goes in as hex and comes back as a colour (ADR-0076).
      expect(res.body.theme.light.accent).toMatch(/^oklch\(/);
      expect(res.body.theme.dark.polarity).toBe(-1);
      const reloaded = await ada.get(`/worlds/${world.body.id}`).expect(200);
      expect(reloaded.body.theme).toEqual(res.body.theme);
    });

    it('clears the Theme when it is set empty', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      await ada.patch(`/worlds/${world.body.id}`).send({ theme: THEME }).expect(200);

      const cleared = await ada.patch(`/worlds/${world.body.id}`).send({ theme: null }).expect(200);

      expect(cleared.body).not.toHaveProperty('theme');
      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body).not.toHaveProperty('theme');
      // A name-only PATCH leaves the Theme untouched (independent fields).
      await ada.patch(`/worlds/${world.body.id}`).send({ theme: THEME }).expect(200);
      const renamed = await ada.patch(`/worlds/${world.body.id}`).send({ name: 'Renamed' }).expect(200);
      expect(renamed.body.theme.light.accent).toMatch(/^oklch\(/);
    });

    it.each([
      ['a `url()` — the exfiltration a Public Link would carry', 'url(https://evil.example/p.png)'],
      ['a garbage string', 'not-a-colour'],
      ['a declaration smuggled into the value', 'red; background: url(//evil.example/p.png)'],
      // A 400, not the 500 a parser that throws inside `safeParse` would produce.
      ['a malformed function the colour parser throws on', 'f(1x)'],
    ])('refuses %s as a colour, storing nothing', async (_label, value) => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

      await ada
        .patch(`/worlds/${world.body.id}`)
        .send({ theme: { ...THEME, light: { ...PALETTE, accent: value } } })
        .expect(400);

      // Refused, not sanitised into something that stores.
      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body).not.toHaveProperty('theme');
    });

    it('refuses an override that is not a value of the token it keys', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const withOverride = (name: string, value: string) =>
        ada.patch(`/worlds/${world.body.id}`).send({ theme: { ...THEME, overrides: { light: { [name]: value } } } });

      // A colour token handed a length; a token nobody declares; one deliberately out of the contract.
      await withOverride('--color-ink', '6px').expect(400);
      await withOverride('--color-nope', '#ff0000').expect(400);
      await withOverride('--text-base', '2rem').expect(400);
      // And the one it does declare, canonicalised.
      const res = await withOverride('--color-ink', '#2e2412').expect(200);
      expect(res.body.theme.overrides.light['--color-ink']).toMatch(/^oklch\(/);
    });

    it('refuses an unknown `version` rather than applying the part it understands', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

      await ada
        .patch(`/worlds/${world.body.id}`)
        .send({ theme: { ...THEME, version: 3 } })
        .expect(400);
      // And the shape this build's version replaced (ADR-0077): an older client's Theme is refused
      // outright rather than half-applied, which is what the version field is carried for.
      await ada
        .patch(`/worlds/${world.body.id}`)
        .send({ theme: { version: 1, solar: PALETTE, astral: { ...PALETTE, polarity: -1 } } })
        .expect(400);
      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body).not.toHaveProperty('theme');
    });

    it('bumps the World’s freshness key, so a live-following reader re-applies (ADR-0045)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

      const res = await ada.patch(`/worlds/${world.body.id}`).send({ theme: THEME }).expect(200);

      expect(res.body.seq).toBeGreaterThan(world.body.seq);
    });

    it('refuses a Contributor and a Viewer, and changes nothing about the Entities', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const note = await ada
        .post('/entities')
        .send({ name: 'Shared lore', types: ['core.type.note'], worldId: world.body.id })
        .expect(201);
      await ada.patch(`/entities/${note.body.id}`).send({ visibility: 'shared' }).expect(200);

      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      addMember(world.body.id, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');
      const cassId = await app.get(AuthService).seedUser('cass@hexly.test', 'quiet library', 'Cass');
      addMember(world.body.id, cassId, 'viewer');
      const cass = await signIn('cass@hexly.test', 'quiet library');

      // Theming is a World management power (ADR-0024): reachable-but-not-Owner is a 403.
      await bob.patch(`/worlds/${world.body.id}`).send({ theme: THEME }).expect(403);
      await cass.patch(`/worlds/${world.body.id}`).send({ theme: THEME }).expect(403);
      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body).not.toHaveProperty('theme');

      // The Owner's own edit moves presentation and nothing else.
      await ada.patch(`/worlds/${world.body.id}`).send({ theme: THEME }).expect(200);
      const read = await cass.get(`/entities/${note.body.id}`).expect(200);
      expect(read.body.name).toBe('Shared lore');
      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body.entityCount).toBe(1);
    });

    /**
     * The Theme parser is untrusted-input work (ADR-0076), so it sits *behind* the Owner check rather
     * than in front of it: reached first, it is CPU any signed-in user could spend against any World id.
     * Refusing on authorisation grounds is the observable form of that ordering — parsed first, this
     * same body answers 400, because the parse fails before the gate is ever consulted.
     */
    it('refuses a non-Owner’s hostile Theme without parsing it', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      await app.get(AuthService).seedUser('mal@hexly.test', 'no relation here', 'Mal');
      const mal = await signIn('mal@hexly.test', 'no relation here');
      // Thousands of unknown override keys, inside express's 100 kB body limit: every one is schema
      // work, and every one is invalid — so a 403 here cannot be the parser's answer.
      const overrides = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`--color-x${i}`, 'zz']));
      const hostile = { theme: { ...THEME, overrides: { light: overrides } } };
      const safeParse = vi.spyOn(updateWorldRequestSchema, 'safeParse');

      try {
        await mal.patch(`/worlds/${world.body.id}`).send(hostile).expect(403);

        expect(safeParse).not.toHaveBeenCalled();
        // An Owner sending the same nonsense still gets the validation answer, not a 403 or a 500.
        await ada.patch(`/worlds/${world.body.id}`).send(hostile).expect(400);
        expect(safeParse).toHaveBeenCalled();
      } finally {
        safeParse.mockRestore();
      }
      expect((await ada.get(`/worlds/${world.body.id}`).expect(200)).body).not.toHaveProperty('theme');
    });

    /**
     * The copy sources (#376): which Worlds' Themes an Owner may copy *into* this one. A duplicate and
     * not a link (ADR-0076), so this route only hands over values — what makes the copy a write is the
     * PATCH that follows, and nothing here bypasses it.
     */
    describe('copying a Theme from another World (#376)', () => {
      it('offers the caller’s other themed Worlds, and neither this one nor an unthemed one', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const target = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
        const source = await ada.post('/worlds').send({ name: 'Whisperwood' }).expect(201);
        await ada.patch(`/worlds/${source.body.id}`).send({ theme: THEME }).expect(200);
        // A World of Ada's carrying no Theme has nothing to copy, so it is not on offer (#376).
        await ada.post('/worlds').send({ name: 'Unthemed' }).expect(201);
        await ada.patch(`/worlds/${target.body.id}`).send({ theme: THEME }).expect(200);

        const res = await ada.get(`/worlds/${target.body.id}/theme-sources`).expect(200);

        // The target itself is excluded: "another World" is the server's answer, not the picker's.
        expect(res.body).toEqual([
          { id: source.body.id, name: 'Whisperwood', theme: expect.objectContaining({ version: 2 }) },
        ]);
        // The values come over whole, so the copy the client stages is the source World's own Theme.
        expect(res.body[0].theme).toEqual((await ada.get(`/worlds/${source.body.id}`).expect(200)).body.theme);
      });

      it('withholds a themed World the caller only reads — ownership is the server’s to decide', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const adasWorld = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
        await ada.patch(`/worlds/${adasWorld.body.id}`).send({ theme: THEME }).expect(200);

        const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob', {
          roles: ['create-worlds'],
        });
        // Bob reaches Ada's themed World as a Contributor, and owns a themed World of his own.
        addMember(adasWorld.body.id, bobId, 'contributor');
        const bob = await signIn('bob@hexly.test', 'battery staple');
        const bobsTarget = await bob.post('/worlds').send({ name: 'Bob’s target' }).expect(201);
        const bobsSource = await bob.post('/worlds').send({ name: 'Bob’s source' }).expect(201);
        await bob.patch(`/worlds/${bobsSource.body.id}`).send({ theme: THEME }).expect(200);

        const res = await bob.get(`/worlds/${bobsTarget.body.id}/theme-sources`).expect(200);

        // A World he merely reads is not a source, however visible its Theme is on the read path.
        expect(res.body.map((w: { id: string }) => w.id)).toEqual([bobsSource.body.id]);
      });

      it('refuses a Contributor and a Viewer of the World being themed, and 404s an unreachable one', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

        const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
        addMember(world.body.id, bobId, 'contributor');
        const cassId = await app.get(AuthService).seedUser('cass@hexly.test', 'quiet library', 'Cass');
        addMember(world.body.id, cassId, 'viewer');
        const danId = await app.get(AuthService).seedUser('dan@hexly.test', 'no relation here', 'Dan');
        expect(danId).toBeTruthy();

        // Asking what may be copied *in* is part of theming, so it answers to the same Owner gate.
        await (await signIn('bob@hexly.test', 'battery staple'))
          .get(`/worlds/${world.body.id}/theme-sources`)
          .expect(403);
        await (await signIn('cass@hexly.test', 'quiet library'))
          .get(`/worlds/${world.body.id}/theme-sources`)
          .expect(403);
        // Unreachable is indistinguishable from nonexistent (ADR-0004).
        await (await signIn('dan@hexly.test', 'no relation here'))
          .get(`/worlds/${world.body.id}/theme-sources`)
          .expect(404);
      });
    });
  });

  describe('World Assets (#269, ADR-0034)', () => {
    /** A tiny valid-enough PNG; only its bytes' identity matters for the content address. */
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    /**
     * What the asset pickers see (#416): the one **link-target read**, preset to the asset type (which is
     * also what lifts the hidden-from-default-listing exclusion, ADR-0065) with `thumbnails=1` for the tile
     * and the capability URL it places. There is no picker listing of its own to ask any more.
     */
    const PICKER_READ = 'type=core.type.asset&thumbnails=1&read=link-target';

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
      expect((await ada.get(`/entities?worldId=${world.body.id}&${PICKER_READ}`).expect(200)).body.items).toEqual([]);

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

      // The pickers surface the minted Asset through the one read: the tile to draw and the capability
      // URL to place, both keyed off the Asset's own Container (ADR-0080).
      const listed = (await ada.get(`/entities?worldId=${world.body.id}&${PICKER_READ}`).expect(200)).body.items;
      expect(listed).toEqual([
        expect.objectContaining({
          id: res.body.id,
          name: 'Portrait',
          assetUrl: `/assets/${world.body.id}/${ref.hash}.png`,
          thumbnailUrl: `/assets/${world.body.id}/${ref.hash}.thumb.webp`,
        }),
      ]);
      // The image-kind preset the Board Image picker AND-s on top reaches it too (ADR-0065).
      expect(
        (await ada.get(`/entities?worldId=${world.body.id}&${PICKER_READ}&field=kind:eq:image`).expect(200)).body.items,
      ).toHaveLength(1);
    });

    it('rejects a raw API write stripping the Asset’s System-managed type, so its bytes stay reachable (ADR-0068)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const minted = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);

      // A hand-crafted PUT — the strip a compliant UI never offers, so only a raw API call reaches it —
      // that drops `core.type.asset` while keeping the asset-ref value, so it is the type set, not the
      // document, that changes. The write choke point refuses it (403).
      await ada
        .put(`/entities/${minted.body.id}`)
        .send({ types: ['core.type.note'], document: minted.body.document, tags: [], version: minted.body.version })
        .expect(403);

      // The Asset still carries its type — its bytes never became unreachable by delete / unaccounted by Reindex.
      const after = await ada.get(`/entities/${minted.body.id}`).expect(200);
      expect(after.body.types).toEqual(['core.type.asset']);
    });

    it('dedups identical bytes to the existing Asset — no twin, the first name sticks (ADR-0065)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);

      const first = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      // Same bytes, different filename: returns the SAME Entity, keeping the first name.
      const again = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'copy.png').expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.name).toBe('Portrait');

      // The picker still offers exactly one Asset.
      expect((await ada.get(`/entities?worldId=${world.body.id}&${PICKER_READ}`).expect(200)).body.items).toHaveLength(
        1,
      );
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
      // The picker read is reader-scoped like every other Entity read, so this holds with no gate of its own.
      expect((await bob.get(`/entities?worldId=${world.body.id}&${PICKER_READ}`).expect(200)).body.items).toEqual([]);
    });

    it('renaming the Asset never moves the served capability URL (extension pinned at mint, ADR-0065)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const res = await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      const url = `/assets/${world.body.id}/${res.body.document['core.field.asset'].hash}.png`;

      await ada.patch(`/entities/${res.body.id}`).send({ name: 'A New Name' }).expect(200);

      const offered = (await ada.get(`/entities?worldId=${world.body.id}&${PICKER_READ}`).expect(200)).body.items;
      // The URL is byte-identical; only the picker label follows the rename.
      expect(offered[0].assetUrl).toBe(url);
      expect(offered[0].name).toBe('A New Name');
    });

    it('lets a Contributor mint an Asset (Entity-creation-shaped, not a management power)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      addMember(world.body.id, bobId, 'contributor');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      const res = await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Map.png').expect(201);
      expect(res.body.name).toBe('Map');
      // And the picker offers what he minted, with the URL an Image element would place.
      expect((await bob.get(`/entities?worldId=${world.body.id}&${PICKER_READ}`).expect(200)).body.items).toEqual([
        expect.objectContaining({
          name: 'Map',
          assetUrl: `/assets/${world.body.id}/${res.body.document['core.field.asset'].hash}.png`,
        }),
      ]);
    });

    it('refuses a Viewer minting an Asset with 403 (reachable, but no contribute standing)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      addMember(world.body.id, bobId, 'viewer');
      const bob = await signIn('bob@hexly.test', 'battery staple');
      await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);

      // Minting is contributor-gated: authoring an Asset is Entity-creation-shaped.
      await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Nope.png').expect(403);

      // And the picker asks the same standing: the byte route is guard-less (ADR-0034), so a listed
      // capability URL *is* the bytes, and a Viewer enumerates no art through the link-target read.
      expect((await bob.get(`/entities?worldId=${world.body.id}&${PICKER_READ}`).expect(200)).body.items).toEqual([]);

      // What a Viewer keeps is the **Asset Browser** — a container-scoped browse of what this World
      // holds, tiles and all — minus the full-resolution URL, which rides the same standing.
      const browsed = (
        await bob
          .get('/entities')
          .query({ worldId: world.body.id, type: 'core.type.asset', thumbnails: '1' })
          .expect(200)
      ).body.items;
      expect(browsed).toHaveLength(1);
      expect(browsed[0].thumbnailUrl).toBeDefined();
      expect(browsed[0].assetUrl).toBeUndefined();
    });

    it('404s an unreachable World on upload, and its Assets reach no picker (existence never leaks, ADR-0004)', async () => {
      const ada = await signIn('ada@hexly.test', 'correct horse');
      const world = await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201);
      await ada.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201);
      await app.get(AuthService).seedUser('bob@hexly.test', 'battery staple', 'Bob');
      const bob = await signIn('bob@hexly.test', 'battery staple');

      await bob.post(`/worlds/${world.body.id}/assets`).attach('file', PNG, 'Portrait.png').expect(404);
      // The picker read is reader-scoped, so a World Bob cannot reach offers him nothing to point at.
      expect((await bob.get(`/entities?worldId=${world.body.id}&${PICKER_READ}`).expect(200)).body.items).toEqual([]);
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
        // A prose image is a capability-URL reference, so the edge is decor by construction (ADR-0069) — the
        // usage surface counts it regardless and marks it.
        expect((await ada.get(`/entities/${asset.id}/references`).expect(200)).body.referencedBy).toEqual([
          { descriptor: null, decor: true, source: { id: note, name: 'Character Sheet', types: ['core.type.note'] } },
        ]);
      });

      /**
       * The outbound direction of the same prose image: the "stored but surface-less" special case retired
       * (ADR-0069), so the Note's own References now resolve the hash edge to the Asset wrapper Entity — a
       * decor edge the relation surface hides by default and the reveal restores.
       */
      it('surfaces a prose image as an outbound decor reference resolved to its Asset Entity', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Portrait.png').expect(201))
          .body;
        const src = `/assets/${world.id}/${asset.document['core.field.asset'].hash}.png`;
        const note = await noteEmbedding(ada, world.id, 'Character Sheet', src);

        const { references } = (await ada.get(`/entities/${note}/references`).expect(200)).body;
        expect(references).toEqual([
          {
            targetId: asset.document['core.field.asset'].hash,
            descriptor: null,
            decor: true,
            // Linked to the Asset's Entity id, not the opaque hash the edge stores.
            target: expect.objectContaining({ id: asset.id, name: asset.name }),
          },
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
          { descriptor: null, decor: true, source: { id: note, name: 'Character Sheet', types: ['core.type.note'] } },
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

      it('matches a hidden-type Asset by name only for a caller that asks — a browse search does not (#282)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Sigil.png').expect(201)).body;

        // The Entity Browser's search box is part of the listing the capability keeps Assets out of, so a
        // bare name search leaves the exclusion standing — it no longer lifts on `q` alone.
        const browsed = (await ada.get('/entities').query({ worldId: world.id, q: 'Sigil' }).expect(200)).body.items;
        expect(browsed.map((e: { id: string }) => e.id)).not.toContain(asset.id);

        // Quick Open is no browse: it opts in (`includeHidden`), and there an Asset matches by name like any
        // Entity — ADR-0065's "Quick Open ... treats Assets like any Entity", now asked for explicitly.
        const picked = (
          await ada.get('/entities').query({ worldId: world.id, q: 'Sigil', includeHidden: '1' }).expect(200)
        ).body.items;
        expect(picked.map((e: { id: string }) => e.id)).toContain(asset.id);
      });

      /**
       * The ranking half of the opt-in: an Asset shares the name of the Entity it illustrates and its short
       * name is the tighter bm25 match, so relevance alone would head the palette with it (ADR-0065).
       */
      it('ranks a name-matched Asset below the ordinary Entities it shares a name with', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Sigil.png').expect(201);
        const note = (
          await ada
            .post('/entities')
            .send({ name: 'Sigil of the Drowned Court', types: ['core.type.note'], worldId: world.id })
            .expect(201)
        ).body;

        const items = (
          await ada.get('/entities').query({ worldId: world.id, q: 'Sigil', includeHidden: '1' }).expect(200)
        ).body.items;
        // The mint names the Asset off the file stem, so it is the exact-match, shortest-name row.
        expect(items.map((e: { name: string }) => e.name)).toEqual(['Sigil of the Drowned Court', 'Sigil']);
        expect(items[0].id).toBe(note.id);
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

      it('keeps the rail and the list agreeing about a name-matched Asset, opted in or not (#284)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const asset = (await ada.post(`/worlds/${world.id}/assets`).attach('file', PNG, 'Dragon.png').expect(201)).body;
        // Tag the Asset so the name search also has a Tag facet value to count.
        await ada
          .put(`/entities/${asset.id}`)
          .send({ version: asset.version, tags: ['bestiary'], document: asset.document })
          .expect(200);

        // A browse search excludes the Asset, so the sibling facets annotating it must not count it —
        // both seams read the exclusion off the same signals, so neither can drift from the other.
        const listed = (await ada.get('/entities').query({ worldId: world.id, q: 'Dragon' }).expect(200)).body.items;
        expect(listed.map((e: { id: string }) => e.id)).not.toContain(asset.id);
        const facets = (await ada.get('/entities/facets').query({ worldId: world.id, q: 'Dragon' }).expect(200)).body;
        expect(facets.tag).toEqual([]);

        // Opted in, both sides include it — the Asset lists, and the rail counts it in visibility and tag.
        const opted = (
          await ada.get('/entities').query({ worldId: world.id, q: 'Dragon', includeHidden: '1' }).expect(200)
        ).body.items;
        expect(opted.map((e: { id: string }) => e.id)).toContain(asset.id);
        const optedFacets = (
          await ada.get('/entities/facets').query({ worldId: world.id, q: 'Dragon', includeHidden: '1' }).expect(200)
        ).body;
        // The upload default is `shared` (ADR-0065), so it's counted there.
        expect(optedFacets.visibility).toContainEqual({ value: 'shared', count: 1 });
        expect(optedFacets.tag).toContainEqual({ value: 'bestiary', count: 1 });
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

    describe('Thumbnail Field (core.field.thumbnail, ADR-0066)', () => {
      /** A second PNG whose bytes differ from {@link PNG}, so it content-addresses to a distinct hash. */
      const PNG2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);

      /** The served thumbnail URL an Asset's own bytes resolve to (ADR-0065) — the derivation's target. */
      const thumbUrl = (worldId: string, hash: string) => `/assets/${worldId}/${hash}.thumb.webp`;

      /** Upload an Asset and return its wrapper Entity plus its content-addressed hash. */
      async function uploadAsset(ada: request.Agent, worldId: string, file: Buffer, filename: string) {
        const asset = (await ada.post(`/worlds/${worldId}/assets`).attach('file', file, filename).expect(201)).body;
        return { asset, hash: asset.document['core.field.asset'].hash as string };
      }

      /** Create a Note designating `targetId` as its thumbnail (attach-on-demand, ADR-0057). */
      async function noteWithThumbnail(ada: request.Agent, worldId: string, name: string, targetId: string) {
        return (
          await ada
            .post('/entities')
            .send({
              name,
              types: ['core.type.note'],
              worldId,
              document: { 'core.field.thumbnail': { entityId: targetId, label: name } },
            })
            .expect(201)
        ).body;
      }

      const listWithThumbs = async (ada: request.Agent, query: Record<string, string>) =>
        (
          await ada
            .get('/entities')
            .query({ thumbnails: '1', ...query })
            .expect(200)
        ).body.items as { id: string; thumbnailUrl?: string }[];

      it('resolves a designation to the target Asset’s served URL under thumbnails=1, and emits none without the flag', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const { asset: portrait, hash } = await uploadAsset(ada, world.id, PNG, 'Portrait.png');
        const deity = await noteWithThumbnail(ada, world.id, 'Vashenka', portrait.id);

        const listed = await listWithThumbs(ada, { worldId: world.id });
        expect(listed.find((e) => e.id === deity.id)?.thumbnailUrl).toBe(thumbUrl(world.id, hash));

        // A list that never asked for thumbnails pays no cost and emits no field (ADR-0066).
        const plain = (await ada.get('/entities').query({ worldId: world.id }).expect(200)).body.items;
        expect(plain.find((e: { id: string }) => e.id === deity.id).thumbnailUrl).toBeUndefined();
      });

      it('lets the Thumbnail Field beat the Entity’s own bytes; a bare Asset still emits its own (precedence)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const { asset: cover, hash: coverHash } = await uploadAsset(ada, world.id, PNG, 'Cover.png');
        const { asset: chosen, hash: chosenHash } = await uploadAsset(ada, world.id, PNG2, 'Chosen.png');
        expect(chosenHash).not.toBe(coverHash);

        // Attach the Thumbnail Field to the `cover` Asset, designating the `chosen` image.
        await ada
          .put(`/entities/${cover.id}`)
          .send({
            document: { ...cover.document, 'core.field.thumbnail': { entityId: chosen.id, label: 'Chosen' } },
            version: cover.version,
            tags: [],
          })
          .expect(200);

        const assets = await listWithThumbs(ada, { worldId: world.id, type: 'core.type.asset' });
        // The Asset carrying the field emits the field's URL (the designation beats its own bytes)...
        expect(assets.find((e) => e.id === cover.id)?.thumbnailUrl).toBe(thumbUrl(world.id, chosenHash));
        // ...while the bare Asset still emits its own bytes' URL, so the Asset Browser is unchanged.
        expect(assets.find((e) => e.id === chosen.id)?.thumbnailUrl).toBe(thumbUrl(world.id, chosenHash));
      });

      it('pierces the target Asset’s visibility — a private target emits on a shared referrer for a viewer without Asset access', async () => {
        const bobId = await app.get(AuthService).seedUser('bob@hexly.test', 'hunter2 stationery', 'Bob', { roles: [] });
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const { asset: portrait, hash } = await uploadAsset(ada, world.id, PNG, 'Portrait.png');
        // Hide the Asset Entity: Visibility governs *finding* it, not the capability-served bytes.
        await ada.patch(`/entities/${portrait.id}`).send({ visibility: 'private' }).expect(200);
        const deity = await noteWithThumbnail(ada, world.id, 'Vashenka', portrait.id);
        await ada.patch(`/entities/${deity.id}`).send({ visibility: 'shared' }).expect(200);
        addMember(world.id, bobId, 'viewer');

        const bob = await signIn('bob@hexly.test', 'hunter2 stationery');
        // The viewer cannot even find the private Asset...
        await bob.get(`/entities/${portrait.id}`).expect(404);
        // ...yet the shared referrer's card still carries the thumbnail (the emitted URL is capability-served).
        const listed = await listWithThumbs(bob, { worldId: world.id });
        expect(listed.find((e) => e.id === deity.id)?.thumbnailUrl).toBe(thumbUrl(world.id, hash));
      });

      it('surfaces the referrer by name in the Asset’s usage, and drops the thumbnail from later lists on delete (cascade)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const { asset: portrait, hash } = await uploadAsset(ada, world.id, PNG, 'Portrait.png');
        const deity = await noteWithThumbnail(ada, world.id, 'Vashenka', portrait.id);

        // The thumbnail link surfaces as an ordinary *named* inbound reference on the Asset (usage), the
        // referrer row now carrying its own resolved thumbnail (its designation, the same image; #290).
        expect((await ada.get(`/entities/${portrait.id}/references`).expect(200)).body.referencedBy).toEqual([
          {
            descriptor: null,
            // A Thumbnail designation is decor by construction (ADR-0069); usage counts it, marked.
            decor: true,
            source: {
              id: deity.id,
              name: 'Vashenka',
              types: ['core.type.note'],
              thumbnailUrl: thumbUrl(world.id, hash),
            },
          },
        ]);

        // Deleting the Asset drops its dedup-index row, so the designation degrades to nothing — no cleanup.
        await ada.delete(`/entities/${portrait.id}`).expect(204);
        const listed = await listWithThumbs(ada, { worldId: world.id });
        expect(listed.find((e) => e.id === deity.id)?.thumbnailUrl).toBeUndefined();
      });

      it('populates thumbnailUrl on inbound and outbound linked reference rows (#290)', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const { asset: portrait, hash } = await uploadAsset(ada, world.id, PNG, 'Portrait.png');
        // The designation both resolves deity's own thumbnail (field precedence) and mints the edge
        // deity → portrait, so one scenario exercises both reference directions.
        const deity = await noteWithThumbnail(ada, world.id, 'Vashenka', portrait.id);

        // Outbound: deity's References list portrait, carrying its own-bytes thumbnail (ADR-0065).
        const outbound = (await ada.get(`/entities/${deity.id}/references`).expect(200)).body.references;
        expect(outbound).toHaveLength(1);
        expect(outbound[0]).toMatchObject({
          targetId: portrait.id,
          target: { id: portrait.id, thumbnailUrl: thumbUrl(world.id, hash) },
        });

        // Inbound: portrait's usage names deity, carrying deity's field-resolved thumbnail (the same image).
        const inbound = (await ada.get(`/entities/${portrait.id}/references`).expect(200)).body.referencedBy;
        expect(inbound).toEqual([
          {
            descriptor: null,
            decor: true,
            source: {
              id: deity.id,
              name: 'Vashenka',
              types: ['core.type.note'],
              thumbnailUrl: thumbUrl(world.id, hash),
            },
          },
        ]);

        // A linked row whose target resolves no thumbnail is unchanged — no `thumbnailUrl` key at all:
        // designate a plain Note (an edge is minted, but it is not an image Asset, so nothing resolves).
        const ledger = (
          await ada
            .post('/entities')
            .send({ name: 'Ledger', types: ['core.type.note'], worldId: world.id })
            .expect(201)
        ).body;
        const scribe = await noteWithThumbnail(ada, world.id, 'Ink', ledger.id);
        const plain = (await ada.get(`/entities/${scribe.id}/references`).expect(200)).body.references;
        expect(plain).toEqual([
          {
            targetId: ledger.id,
            descriptor: null,
            // A Thumbnail Field mints a decor edge whatever it designates (ADR-0069).
            decor: true,
            target: { id: ledger.id, name: 'Ledger', types: ['core.type.note'] },
          },
        ]);
      });

      it('rebuilds the designation on Reindex for a row written before the column existed', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;
        const { asset: portrait, hash } = await uploadAsset(ada, world.id, PNG, 'Portrait.png');
        const deity = await noteWithThumbnail(ada, world.id, 'Vashenka', portrait.id);

        // Simulate a pre-column row: blank the derived column the way an old document would have left it.
        db.$client.prepare('UPDATE entities SET thumbnail_entity_id = NULL WHERE id = ?').run(deity.id);
        expect(
          (await listWithThumbs(ada, { worldId: world.id })).find((e) => e.id === deity.id)?.thumbnailUrl,
        ).toBeUndefined();

        // Reindex rebuilds the derivation from the stored document (ADR-0046).
        app.get(EntityWrites).reindexChunk(null, 100);
        expect((await listWithThumbs(ada, { worldId: world.id })).find((e) => e.id === deity.id)?.thumbnailUrl).toBe(
          thumbUrl(world.id, hash),
        );
      });

      it('emits nothing for a non-image, dangling, or ill-typed designation, and never errors', async () => {
        const ada = await signIn('ada@hexly.test', 'correct horse');
        const world = (await ada.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body;

        // A dangling designation: the target Entity does not exist (a valid document, ADR-0066).
        const dangling = await noteWithThumbnail(ada, world.id, 'Orphan', 'no-such-entity');
        // A non-image designation: the target is a real Asset, but a PDF, not an image.
        const { asset: manual } = await uploadAsset(ada, world.id, PNG, 'Manual.pdf');
        const nonImage = await noteWithThumbnail(ada, world.id, 'Rulebook', manual.id);

        const listed = await listWithThumbs(ada, { worldId: world.id });
        expect(listed.find((e) => e.id === dangling.id)?.thumbnailUrl).toBeUndefined();
        expect(listed.find((e) => e.id === nonImage.id)?.thumbnailUrl).toBeUndefined();

        // An ill-typed value at rest (a bare string) is tolerated: Reindex never throws and the list still 200s.
        db.$client
          .prepare('UPDATE entities SET document = ? WHERE id = ?')
          .run(JSON.stringify({ 'core.field.thumbnail': 'garbage' }), dangling.id);
        expect(() => app.get(EntityWrites).reindexChunk(null, 100)).not.toThrow();
        const again = await listWithThumbs(ada, { worldId: world.id });
        expect(again.find((e) => e.id === dangling.id)?.thumbnailUrl).toBeUndefined();
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
