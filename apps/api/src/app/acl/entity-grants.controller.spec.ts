import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DB, Db, createDb } from '../db/db';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';
import { WorldsModule } from '../worlds/worlds.module';

/**
 * Entity-level grants (ADR-0037, #161): surgical per-Entity sharing on top of the
 * World model. An Owner hands a named Instance user an Editor or Viewer grant on one
 * Entity — World membership is not a precondition, and the grant pierces `private`
 * (per-user visibility). These specs assert the externally observable authorization
 * lifecycle across seeded users: who reads/writes what after a grant or a revoke.
 */
describe('Entity grants', () => {
  let app: INestApplication;
  let db: Db;
  let adaId: string;
  let bobId: string;
  let carolId: string;

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

    adaId = await seed('ada@hexly.test', 'Ada');
    bobId = await seed('bob@hexly.test', 'Bob');
    carolId = await seed('carol@hexly.test', 'Carol');
  });

  afterEach(async () => {
    await app.close();
  });

  async function seed(email: string, name: string): Promise<string> {
    return app.get(AuthService).seedUser(email, 'correct horse', name, { roles: ['create-worlds'] });
  }

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password: 'correct horse' }).expect(200);
    return agent;
  }

  type Agent = Awaited<ReturnType<typeof signIn>>;

  async function makeWorld(owner: Agent): Promise<string> {
    return (await owner.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body.id;
  }

  async function makeEntity(owner: Agent, worldId: string): Promise<string> {
    return (
      await owner
        .post('/entities')
        .send({ name: 'Lady Mara', types: ['core.note'], worldId })
        .expect(201)
    ).body.id;
  }

  /** Re-save an Entity through the autosave surface (PUT) — the substance path. */
  async function resave(agent: Agent, id: string, expectStatus: number) {
    const current = (await agent.get(`/entities/${id}`).expect(200)).body;
    return agent
      .put(`/entities/${id}`)
      .send({
        document: current.document,
        version: current.version,
        tags: ['edited'],
      })
      .expect(expectStatus);
  }

  it('bounds an Editor to substance — edits Content/name/Tags, blocked from delete/visibility/grants', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world); // Private, Ada-owned.

    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'editor' }).expect(200);

    // The editor opens the Entity writable — Rights carry `edit` but not the lifecycle
    // verbs (delete/set-visibility) or `manage` (ADR-0039).
    expect((await bob.get(`/entities/${entity}`).expect(200)).body.rights).toEqual(['read', 'edit']);
    await resave(bob, entity, 200);
    // Name is substance too — an Editor may rename.
    await bob.patch(`/entities/${entity}`).send({ name: 'Renamed' }).expect(200);

    // But exposure and lifecycle stay with the Owner — every one is a 403, not a 404.
    await bob.patch(`/entities/${entity}`).send({ visibility: 'shared' }).expect(403);
    await bob.delete(`/entities/${entity}`).expect(403);
    // Grant management is Owner-only — an Editor can't see or hand out grants.
    await bob.get(`/entities/${entity}/grants`).expect(403);
    await bob.post(`/entities/${entity}/grants`).send({ userId: carolId, role: 'viewer' }).expect(403);
    await bob.delete(`/entities/${entity}/grants/${carolId}`).expect(403);
    // Nor the ownership set.
    await bob.post(`/entities/${entity}/owners`).send({ userId: carolId }).expect(403);
  });

  it('ends a grantee’s access the instant the grant is revoked', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world);

    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'viewer' }).expect(200);
    await bob.get(`/entities/${entity}`).expect(200);

    // Revoke returns the now-empty grant set; Bob loses the Entity entirely (back to 404).
    expect((await ada.delete(`/entities/${entity}/grants/${bobId}`).expect(200)).body).toEqual([]);
    await bob.get(`/entities/${entity}`).expect(404);
  });

  it('upserts a grant’s role on re-grant, and lists the set to an Owner', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world);

    // Bob starts a Viewer (read-only), then is promoted to Editor — one row, role updated.
    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'viewer' }).expect(200);
    await resave(bob, entity, 403); // Viewer can't write substance.

    const promoted = await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'editor' }).expect(200);
    expect(promoted.body).toEqual([{ userId: bobId, role: 'editor' }]);
    await resave(bob, entity, 200); // Now an Editor, the save lands.

    expect((await ada.get(`/entities/${entity}/grants`).expect(200)).body).toEqual([{ userId: bobId, role: 'editor' }]);
  });

  it('never strips an Owner through the grant surface — grant is owner-wins, revoke spares the owner row', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world);
    // Bob is a co-Owner (full control), so every call below still runs as an Owner.
    await ada.post(`/entities/${entity}/owners`).send({ userId: bobId }).expect(200);

    // Granting a current Owner viewer must NOT demote them: owner wins, and the grant surface
    // (editor/viewer only) never lists them. Bob keeps write + management.
    expect(
      (await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'viewer' }).expect(200)).body,
    ).toEqual([]);
    await resave(bob, entity, 200);

    // Revoking through the grant endpoint must NOT delete Bob's owner row — he stays an Owner.
    expect((await ada.delete(`/entities/${entity}/grants/${bobId}`).expect(200)).body).toEqual([]);
    expect((await ada.get(`/entities/${entity}/owners`).expect(200)).body).toContain(bobId);
    await resave(bob, entity, 200);
  });

  it('recomputes a World Owner’s own Rights on the visibility PATCH that revokes their access', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world); // Ada-owned, born private.
    // Share the Entity, and make Bob a co-Owner of the *World* (not the Entity).
    await ada.patch(`/entities/${entity}`).send({ visibility: 'shared' }).expect(200);
    await ada.post(`/worlds/${world}/owners`).send({ userId: bobId }).expect(200);

    // As a World Owner of a shared Entity, Bob writes it — Rights carry edit + the lifecycle
    // verbs, but not `manage` (he owns the World, not the Entity).
    expect((await bob.get(`/entities/${entity}`).expect(200)).body.rights).toEqual([
      'read',
      'edit',
      'delete',
      'set-visibility',
    ]);

    // Bob flips it private. The write lands, but it revokes his OWN standing (his access ran
    // through shared-and-world-owner) — the PATCH must ship the recomputed (now empty) Rights,
    // not let the client keep the stale writable set and autosave into a 403 wall.
    const patched = await bob.patch(`/entities/${entity}`).send({ visibility: 'private' }).expect(200);
    expect(patched.body.rights).toEqual([]);
    // The loss is real: the Entity is now invisible to him.
    await bob.get(`/entities/${entity}`).expect(404);
  });

  it('surfaces a grantee’s World in their Index via derived reachability, without membership', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world);

    // Bob is not a member of Ada's World — it's invisible to him.
    await bob.get(`/worlds/${world}`).expect(404);
    expect((await bob.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).not.toContain(world);

    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'viewer' }).expect(200);

    // The grant makes the containing World reachable so Bob can navigate to what he was given.
    await bob.get(`/worlds/${world}`).expect(200);
    expect((await bob.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).toContain(world);

    // Reachable, yet not a member — he can't manage the World's members (403, not 200).
    await bob.get(`/worlds/${world}/members`).expect(403);
  });

  it('rejects an Editor’s stale save as a 409 — the Entity version guards co-editing', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world);
    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'editor' }).expect(200);

    // Bob reads the current version, then Ada's concurrent save advances it.
    const stale = (await bob.get(`/entities/${entity}`).expect(200)).body;
    await ada
      .put(`/entities/${entity}`)
      .send({ document: stale.document, version: stale.version, tags: ['ada'] })
      .expect(200);

    // Bob's save at the now-stale version is a 409, not a silent clobber (ADR-0004/0019).
    await bob
      .put(`/entities/${entity}`)
      .send({ document: stale.document, version: stale.version, tags: ['bob'] })
      .expect(409);
  });

  it('answers 404 (never 403) when a user who can’t reach the Entity manages grants', async () => {
    const ada = await signIn('ada@hexly.test');
    const carol = await signIn('carol@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world); // Private — invisible to Carol.

    // No existence leak: an unreachable Entity is a 404 on every grant route.
    await carol.get(`/entities/${entity}/grants`).expect(404);
    await carol.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'viewer' }).expect(404);
    await carol.delete(`/entities/${entity}/grants/${bobId}`).expect(404);
  });

  it('rejects a bad grant role or a non-Instance target (400)', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world);

    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'owner' }).expect(400);
    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'archmage' }).expect(400);
    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId }).expect(400);
    await ada.post(`/entities/${entity}/grants`).send({ userId: 'ghost', role: 'viewer' }).expect(400);
  });

  it('refuses every grant route without a session cookie (401)', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world);
    const anon = request(app.getHttpServer());

    await anon.get(`/entities/${entity}/grants`).expect(401);
    await anon.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'viewer' }).expect(401);
    await anon.delete(`/entities/${entity}/grants/${bobId}`).expect(401);
  });

  it('lets a Viewer grant pierce a private Entity — that user alone can read it', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const carol = await signIn('carol@hexly.test');
    const world = await makeWorld(ada);
    const entity = await makeEntity(ada, world); // Born `private`.

    // Before the grant, an outsider can't even tell it exists.
    await bob.get(`/entities/${entity}`).expect(404);

    await ada.post(`/entities/${entity}/grants`).send({ userId: bobId, role: 'viewer' }).expect(200);

    // Bob now reads the private Entity; Carol (ungranted) still gets nothing.
    await bob.get(`/entities/${entity}`).expect(200);
    await carol.get(`/entities/${entity}`).expect(404);
  });
});
