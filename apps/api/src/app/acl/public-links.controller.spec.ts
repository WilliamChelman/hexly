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
import { PublicLinksModule } from './public-links.module';

/**
 * Public Links (ADR-0037, #162): the unauthenticated read surface. An Owner mints a
 * token-scoped, revocable link; a reader with no account follows it to a strictly
 * read-only view. A per-entity link pierces `private` (an anonymous Viewer grant); a
 * World link serves only that World's `shared` Entities. These specs assert the
 * externally observable lifecycle across the guarded mint/revoke routes and the
 * unauthenticated token routes.
 */
describe('Public links', () => {
  let app: INestApplication;
  let db: Db;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule, PublicLinksModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    await seed('ada@hexly.test', 'Ada');
    await seed('bob@hexly.test', 'Bob');
  });

  afterEach(async () => {
    await app.close();
  });

  async function seed(email: string, name: string): Promise<string> {
    return app.get(AuthService).seedUser(email, 'correct horse', name);
  }

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password: 'correct horse' }).expect(200);
    return agent;
  }

  type Agent = Awaited<ReturnType<typeof signIn>>;

  /** The unauthenticated reader — no session cookie. */
  function anon() {
    return request(app.getHttpServer());
  }

  async function makeWorld(owner: Agent): Promise<string> {
    return (await owner.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body.id;
  }

  async function makeEntity(owner: Agent, worldId: string, name = 'Lady Mara'): Promise<string> {
    return (
      await owner.post('/entities').send({ name, type: 'note', worldId }).expect(201)
    ).body.id;
  }

  async function share(owner: Agent, id: string) {
    await owner.patch(`/entities/${id}`).send({ visibility: 'shared' }).expect(200);
  }

  it('mints a per-entity Public Link, returning a token', async () => {
    const ada = await signIn('ada@hexly.test');
    const worldId = await makeWorld(ada);
    const entityId = await makeEntity(ada, worldId);

    const res = await ada.post(`/entities/${entityId}/link`).expect(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('re-minting returns the same token (one active link per Entity)', async () => {
    const ada = await signIn('ada@hexly.test');
    const entityId = await makeEntity(ada, await makeWorld(ada));

    const first = (await ada.post(`/entities/${entityId}/link`).expect(200)).body.token;
    const second = (await ada.post(`/entities/${entityId}/link`).expect(200)).body.token;
    expect(second).toBe(first);
  });

  it('GET link is null before mint, the token after', async () => {
    const ada = await signIn('ada@hexly.test');
    const entityId = await makeEntity(ada, await makeWorld(ada));

    // No active link yet: an empty 200 body (Angular's HttpClient reads this as null).
    expect((await ada.get(`/entities/${entityId}/link`).expect(200)).body.token).toBeUndefined();
    const token = (await ada.post(`/entities/${entityId}/link`).expect(200)).body.token;
    expect((await ada.get(`/entities/${entityId}/link`).expect(200)).body).toEqual({ token });
  });

  it('an entity link serves that one (private) Entity read-only to an anonymous reader', async () => {
    const ada = await signIn('ada@hexly.test');
    const entityId = await makeEntity(ada, await makeWorld(ada)); // private by default
    const token = (await ada.post(`/entities/${entityId}/link`).expect(200)).body.token;

    const res = await anon().get(`/public/entities/${token}`).expect(200);
    expect(res.body.id).toBe(entityId);
    // The link is an anonymous Viewer grant: it pierces `private` yet stays read-only.
    expect(res.body.visibility).toBe('private');
    expect(res.body.canWrite).toBe(false);
  });

  it('revoking an entity link makes its token stop resolving immediately', async () => {
    const ada = await signIn('ada@hexly.test');
    const entityId = await makeEntity(ada, await makeWorld(ada));
    const token = (await ada.post(`/entities/${entityId}/link`).expect(200)).body.token;

    await anon().get(`/public/entities/${token}`).expect(200);
    await ada.delete(`/entities/${entityId}/link`).expect(204);
    await anon().get(`/public/entities/${token}`).expect(404);
  });

  it('the entity token route rejects every write verb', async () => {
    const ada = await signIn('ada@hexly.test');
    const entityId = await makeEntity(ada, await makeWorld(ada));
    const token = (await ada.post(`/entities/${entityId}/link`).expect(200)).body.token;

    // Only GET is routed under /public, so any write verb hits no handler at all.
    await anon().post(`/public/entities/${token}`).expect(404);
    await anon().put(`/public/entities/${token}`).send({}).expect(404);
    await anon().patch(`/public/entities/${token}`).send({}).expect(404);
    await anon().delete(`/public/entities/${token}`).expect(404);
  });

  it('a bad token is a 404, indistinguishable from a revoked one', async () => {
    await anon().get('/public/entities/nope').expect(404);
    await anon().get('/public/worlds/nope').expect(404);
  });

  it('a non-owner cannot mint an entity link, and can never see it exists', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const worldId = await makeWorld(ada);
    const privateId = await makeEntity(ada, worldId);
    // Bob is a Contributor who can reach a shared Entity but isn't its Owner → 403.
    await ada.post(`/worlds/${worldId}/members`).send({ userId: (await bobUser(bob)), role: 'contributor' }).expect(200);
    const sharedId = await makeEntity(ada, worldId, 'Town');
    await share(ada, sharedId);

    // Unreachable private Entity: no existence leak → 404.
    await bob.post(`/entities/${privateId}/link`).expect(404);
    // Reachable-but-not-owner: 403.
    await bob.post(`/entities/${sharedId}/link`).expect(403);
  });

  /** Bob's own user id (for membership adds), read from his session. */
  async function bobUser(bob: Agent): Promise<string> {
    return (await bob.get('/auth/me').expect(200)).body.id;
  }

  it('a World Owner mints a World Public Link, returning a token', async () => {
    const ada = await signIn('ada@hexly.test');
    const worldId = await makeWorld(ada);
    const res = await ada.post(`/worlds/${worldId}/link`).expect(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('a World link serves only that World\'s shared Entities, read-only', async () => {
    const ada = await signIn('ada@hexly.test');
    const worldId = await makeWorld(ada);
    const sharedId = await makeEntity(ada, worldId, 'Town');
    await share(ada, sharedId);
    const secretId = await makeEntity(ada, worldId, 'Secret'); // stays private
    const token = (await ada.post(`/worlds/${worldId}/link`).expect(200)).body.token;

    const view = (await anon().get(`/public/worlds/${token}`).expect(200)).body;
    expect(view.worldName).toBe('Aldermoor');
    const ids = view.entities.map((e: { id: string }) => e.id);
    expect(ids).toContain(sharedId);
    // The Home Entity (name = World name) is always shared, so it lands in the listing.
    expect(view.entities.map((e: { name: string }) => e.name)).toContain('Aldermoor');
    expect(ids).not.toContain(secretId); // private never appears

    // The shared Entity opens read-only through the token; the private one is a 404.
    const opened = (await anon().get(`/public/worlds/${token}/entities/${sharedId}`).expect(200)).body;
    expect(opened.canWrite).toBe(false);
    await anon().get(`/public/worlds/${token}/entities/${secretId}`).expect(404);
  });

  it('revoking a World link makes its token stop resolving immediately', async () => {
    const ada = await signIn('ada@hexly.test');
    const worldId = await makeWorld(ada);
    const token = (await ada.post(`/worlds/${worldId}/link`).expect(200)).body.token;

    await anon().get(`/public/worlds/${token}`).expect(200);
    await ada.delete(`/worlds/${worldId}/link`).expect(204);
    await anon().get(`/public/worlds/${token}`).expect(404);
  });

  it('a non-owner cannot mint a World link (403 reachable, 404 unreachable)', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const owned = await makeWorld(ada);
    // Bob is a Viewer of ada's World: reachable, but not an Owner → 403.
    await ada.post(`/worlds/${owned}/members`).send({ userId: await bobUser(bob), role: 'viewer' }).expect(200);
    await bob.post(`/worlds/${owned}/link`).expect(403);

    // A World Bob can't reach at all → 404, no existence leak.
    const stranger = await makeWorld(ada);
    // Remove any incidental reach: bob has none to `stranger`.
    await bob.post(`/worlds/${stranger}/link`).expect(404);
  });
});
