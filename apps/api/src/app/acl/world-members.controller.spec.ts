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
 * World membership & roles (ADR-0037, #159): a World Owner curates who is in their
 * World by picking existing Instance users as Contributors or World Viewers, changes
 * a member's role, or removes them; a member may leave. Access is derived on every
 * read — these specs assert the externally observable lifecycle (who reaches the
 * World after add/remove/set-role/leave), never the predicate internals.
 */
describe('World members', () => {
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

  it('lets an Owner add a Contributor, who then reaches the World', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const id = await makeWorld(ada);

    await bob.get(`/worlds/${id}`).expect(404);

    const members = await ada
      .post(`/worlds/${id}/members`)
      .send({ userId: bobId, role: 'contributor' })
      .expect(200);
    expect(members.body).toEqual([{ userId: bobId, role: 'contributor' }]);

    // The World now appears in Bob's reachable World list and reads as a Detail.
    await bob.get(`/worlds/${id}`).expect(200);
    expect((await bob.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).toContain(id);
  });

  it('lists the member set to an Owner via GET /members, excluding Owners', async () => {
    const ada = await signIn('ada@hexly.test');
    const id = await makeWorld(ada);
    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
    await ada.post(`/worlds/${id}/members`).send({ userId: carolId, role: 'viewer' }).expect(200);

    const members = await ada.get(`/worlds/${id}/members`).expect(200);
    // Ordered by user id (stable); Ada the Owner is not a member row here.
    expect(members.body).toEqual(
      [
        { userId: bobId, role: 'contributor' },
        { userId: carolId, role: 'viewer' },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    );
  });

  it('lets an Owner change a member between Contributor and World Viewer', async () => {
    const ada = await signIn('ada@hexly.test');
    const id = await makeWorld(ada);
    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);

    // Promote the spectator: contributor → viewer → contributor.
    expect((await ada.patch(`/worlds/${id}/members/${bobId}`).send({ role: 'viewer' }).expect(200)).body).toEqual([
      { userId: bobId, role: 'viewer' },
    ]);
    expect((await ada.patch(`/worlds/${id}/members/${bobId}`).send({ role: 'contributor' }).expect(200)).body).toEqual([
      { userId: bobId, role: 'contributor' },
    ]);
  });

  it('lets an Owner remove a member, who owns nothing — the World drops out of their Index', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const id = await makeWorld(ada);
    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'viewer' }).expect(200);
    await bob.get(`/worlds/${id}`).expect(200);

    // Removal returns the now-empty member set; Bob owns nothing here, so he loses reach.
    expect((await ada.delete(`/worlds/${id}/members/${bobId}`).expect(200)).body).toEqual([]);

    await bob.get(`/worlds/${id}`).expect(404);
    expect((await bob.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).not.toContain(id);
  });

  it('lets a member leave a World voluntarily (self-service), dropping out of their Index', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const id = await makeWorld(ada);
    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
    await bob.get(`/worlds/${id}`).expect(200);

    // Bob removes his own membership row — no Owner needed.
    await bob.delete(`/worlds/${id}/members/${bobId}`).expect(200);

    await bob.get(`/worlds/${id}`).expect(404);
  });

  it('keeps a departed member minimally reachable while they still own an Entity in the World', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const id = await makeWorld(ada);
    const entityId = await makeEntity(ada, id);
    // Bob joins as a Contributor and comes to own an Entity in the World (co-ownership
    // stands in for the contributor authoring one — the write path lands next slice).
    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
    await ada.post(`/entities/${entityId}/owners`).send({ userId: bobId }).expect(200);

    // Bob leaves; his membership row is gone but his Entity ownership is not.
    await bob.delete(`/worlds/${id}/members/${bobId}`).expect(200);

    // Derived reachability: the World stays in Bob's Index and reads as a Detail,
    // because he still owns an Entity inside it (ADR-0037 ex-member residue).
    await bob.get(`/worlds/${id}`).expect(200);
    expect((await bob.get('/worlds').expect(200)).body.map((w: { id: string }) => w.id)).toContain(id);
    await bob.get(`/entities/${entityId}`).expect(200);

    // But leaving stripped his membership: he is reachable, yet not an Owner, so
    // member management stays closed to him (reachable-but-forbidden → 403).
    await bob.get(`/worlds/${id}/members`).expect(403);
  });

  it('rejects a non-Owner member managing members with 403, but lets them leave', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const id = await makeWorld(ada);
    // Bob is a Contributor (reachable, not an Owner); Carol is another member.
    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
    await ada.post(`/worlds/${id}/members`).send({ userId: carolId, role: 'viewer' }).expect(200);

    await bob.get(`/worlds/${id}/members`).expect(403);
    await bob.post(`/worlds/${id}/members`).send({ userId: carolId, role: 'viewer' }).expect(403);
    await bob.patch(`/worlds/${id}/members/${carolId}`).send({ role: 'contributor' }).expect(403);
    await bob.delete(`/worlds/${id}/members/${carolId}`).expect(403);

    // Self-service leave is not owner-gated — Bob may remove himself.
    await bob.delete(`/worlds/${id}/members/${bobId}`).expect(200);
  });

  it('answers 404 (never 403) when a non-member tries to manage members', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const id = await makeWorld(ada);

    await bob.get(`/worlds/${id}/members`).expect(404);
    await bob.post(`/worlds/${id}/members`).send({ userId: carolId, role: 'viewer' }).expect(404);
    await bob.patch(`/worlds/${id}/members/${carolId}`).send({ role: 'viewer' }).expect(404);
    await bob.delete(`/worlds/${id}/members/${carolId}`).expect(404);
  });

  it('refuses every member route without a session cookie (401)', async () => {
    const ada = await signIn('ada@hexly.test');
    const id = await makeWorld(ada);
    const anon = request(app.getHttpServer());

    await anon.get(`/worlds/${id}/members`).expect(401);
    await anon.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'viewer' }).expect(401);
    await anon.patch(`/worlds/${id}/members/${bobId}`).send({ role: 'viewer' }).expect(401);
    await anon.delete(`/worlds/${id}/members/${bobId}`).expect(401);
  });

  it('rejects a role other than contributor or viewer (400) — owner is not assignable here', async () => {
    const ada = await signIn('ada@hexly.test');
    const id = await makeWorld(ada);

    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'owner' }).expect(400);
    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'archmage' }).expect(400);
    await ada.post(`/worlds/${id}/members`).send({ userId: bobId }).expect(400);

    await ada.post(`/worlds/${id}/members`).send({ userId: bobId, role: 'viewer' }).expect(200);
    await ada.patch(`/worlds/${id}/members/${bobId}`).send({ role: 'owner' }).expect(400);
  });

  it('rejects adding a target that is not an Instance user (400)', async () => {
    const ada = await signIn('ada@hexly.test');
    const id = await makeWorld(ada);

    await ada.post(`/worlds/${id}/members`).send({ userId: 'ghost', role: 'viewer' }).expect(400);
  });

  it('never demotes an Owner through the member endpoints — the ownership set is untouched', async () => {
    const ada = await signIn('ada@hexly.test');
    const id = await makeWorld(ada);

    // A crafted add/set-role targeting the sole Owner must not strip her ownership
    // (that would orphan the World). Both are no-ops on the owner row.
    await ada.post(`/worlds/${id}/members`).send({ userId: adaId, role: 'contributor' }).expect(200);
    expect((await ada.get(`/worlds/${id}/owners`).expect(200)).body).toEqual([adaId]);

    await ada.patch(`/worlds/${id}/members/${adaId}`).send({ role: 'viewer' }).expect(404);
    expect((await ada.get(`/worlds/${id}/owners`).expect(200)).body).toEqual([adaId]);
  });

  it('never strips a co-Owner through the member DELETE route — ownership stays intact', async () => {
    const ada = await signIn('ada@hexly.test');
    const id = await makeWorld(ada);
    // Bob is a second Owner (managed through the ownership-set surface).
    await ada.post(`/worlds/${id}/owners`).send({ userId: bobId }).expect(200);

    // A crafted member-DELETE targeting a co-Owner must not demote him: an Owner is
    // not a removable member row here, so it's a 404 and the owner set is untouched.
    await ada.delete(`/worlds/${id}/members/${bobId}`).expect(404);
    expect((await ada.get(`/worlds/${id}/owners`).expect(200)).body).toEqual(
      [adaId, bobId].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('refuses a sole Owner leaving via the member route (409), keeping the World reachable', async () => {
    const ada = await signIn('ada@hexly.test');
    const id = await makeWorld(ada);

    // The ≥1-Owner invariant guards this path too: Ada can't orphan her own World.
    await ada.delete(`/worlds/${id}/members/${adaId}`).expect(409);
    await ada.get(`/worlds/${id}`).expect(200);
  });
});
