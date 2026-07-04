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
 * Symmetric ownership sets (ADR-0037, #158): ownership of Worlds and Entities is a
 * set of equal Owners, guarded by a single ≥1-Owner invariant. These specs assert
 * externally observable authorization outcomes across seeded users — who can reach
 * and manage what after add/remove/resign — never the predicate internals.
 */
describe('Owner sets', () => {
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
    return app.get(AuthService).seedUser(email, 'correct horse', name);
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
        .send({ name: 'Lady Mara', type: 'note', worldId })
        .expect(201)
    ).body.id;
  }

  describe('World owner sets', () => {
    it('lets an Owner add a co-Owner, who then reaches the World', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const id = await makeWorld(ada);

      await bob.get(`/worlds/${id}`).expect(404);

      const owners = await ada.post(`/worlds/${id}/owners`).send({ userId: bobId }).expect(200);
      expect(owners.body.sort()).toEqual([adaId, bobId].sort());

      await bob.get(`/worlds/${id}`).expect(200);
      // The Detail carries the full ownership set (ADR-0037).
      expect((await bob.get(`/worlds/${id}`).expect(200)).body.owners.sort()).toEqual(
        [adaId, bobId].sort(),
      );
    });

    it('shows the Owner set to any Owner via GET /owners', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const id = await makeWorld(ada);
      await ada.post(`/worlds/${id}/owners`).send({ userId: bobId }).expect(200);

      expect((await bob.get(`/worlds/${id}/owners`).expect(200)).body.sort()).toEqual(
        [adaId, bobId].sort(),
      );
    });

    it('gives a co-Owner symmetric power — they can evict the original creator', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const id = await makeWorld(ada);
      await ada.post(`/worlds/${id}/owners`).send({ userId: bobId }).expect(200);

      // Bob, added second, evicts Ada the creator — no hidden hierarchy.
      const owners = await bob.delete(`/worlds/${id}/owners/${adaId}`).expect(200);
      expect(owners.body).toEqual([bobId]);

      await ada.get(`/worlds/${id}`).expect(404);
      await bob.get(`/worlds/${id}`).expect(200);
    });

    it('lets an Owner resign, losing reach while the others keep it', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const id = await makeWorld(ada);
      await ada.post(`/worlds/${id}/owners`).send({ userId: bobId }).expect(200);

      // Resign is DELETE self.
      await ada.delete(`/worlds/${id}/owners/${adaId}`).expect(200);

      await ada.get(`/worlds/${id}`).expect(404);
      await bob.get(`/worlds/${id}`).expect(200);
    });

    it('refuses removing or resigning the last Owner (409), leaving the set intact', async () => {
      const ada = await signIn('ada@hexly.test');
      const id = await makeWorld(ada);

      await ada.delete(`/worlds/${id}/owners/${adaId}`).expect(409);

      // The set is untouched — Ada still owns and reaches it.
      await ada.get(`/worlds/${id}`).expect(200);
      expect((await ada.get(`/worlds/${id}/owners`).expect(200)).body).toEqual([adaId]);
    });

    it('lets an Owner remove a co-Owner, who then loses reach', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const id = await makeWorld(ada);
      await ada.post(`/worlds/${id}/owners`).send({ userId: bobId }).expect(200);

      await ada.delete(`/worlds/${id}/owners/${bobId}`).expect(200);
      await bob.get(`/worlds/${id}`).expect(404);
    });

    it('rejects a non-Owner member managing owners with 403 (reachable but not an Owner)', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const id = await makeWorld(ada);
      // Bob is a plain member (contributor), reachable but not an Owner.
      db.$client
        .prepare(`INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'contributor')`)
        .run(id, bobId);

      await bob.get(`/worlds/${id}/owners`).expect(403);
      await bob.post(`/worlds/${id}/owners`).send({ userId: carolId }).expect(403);
      await bob.delete(`/worlds/${id}/owners/${adaId}`).expect(403);
    });

    it('answers 404 (never 403) when a non-member tries to manage owners', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const id = await makeWorld(ada);

      await bob.get(`/worlds/${id}/owners`).expect(404);
      await bob.post(`/worlds/${id}/owners`).send({ userId: carolId }).expect(404);
    });

    it('rejects adding a target that is not an Instance user (400)', async () => {
      const ada = await signIn('ada@hexly.test');
      const id = await makeWorld(ada);

      await ada.post(`/worlds/${id}/owners`).send({ userId: 'ghost' }).expect(400);
    });

    it('refuses every owner route without a session cookie', async () => {
      const ada = await signIn('ada@hexly.test');
      const id = await makeWorld(ada);
      const anon = request(app.getHttpServer());

      await anon.get(`/worlds/${id}/owners`).expect(401);
      await anon.post(`/worlds/${id}/owners`).send({ userId: bobId }).expect(401);
      await anon.delete(`/worlds/${id}/owners/${adaId}`).expect(401);
    });
  });

  describe('Entity owner sets', () => {
    it('lets an Owner add a co-Owner, who then reaches the Entity', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const world = await makeWorld(ada);
      const id = await makeEntity(ada, world);

      // Private and owner-only: Bob can't see it yet.
      await bob.get(`/entities/${id}`).expect(404);

      const owners = await ada.post(`/entities/${id}/owners`).send({ userId: bobId }).expect(200);
      expect(owners.body.sort()).toEqual([adaId, bobId].sort());

      await bob.get(`/entities/${id}`).expect(200);
    });

    it('shows the Owner set to any Owner via GET /owners', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const id = await makeEntity(ada, world);
      await ada.post(`/entities/${id}/owners`).send({ userId: bobId }).expect(200);

      expect((await ada.get(`/entities/${id}/owners`).expect(200)).body.sort()).toEqual(
        [adaId, bobId].sort(),
      );
    });

    it('gives a co-Owner symmetric power — they can evict the original creator', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const world = await makeWorld(ada);
      const id = await makeEntity(ada, world);
      await ada.post(`/entities/${id}/owners`).send({ userId: bobId }).expect(200);

      const owners = await bob.delete(`/entities/${id}/owners/${adaId}`).expect(200);
      expect(owners.body).toEqual([bobId]);

      await ada.get(`/entities/${id}`).expect(404);
      await bob.get(`/entities/${id}`).expect(200);
    });

    it('refuses removing or resigning the last Owner (409), leaving the set intact', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const id = await makeEntity(ada, world);

      await ada.delete(`/entities/${id}/owners/${adaId}`).expect(409);

      await ada.get(`/entities/${id}`).expect(200);
      expect((await ada.get(`/entities/${id}/owners`).expect(200)).body).toEqual([adaId]);
    });

    it('answers 404 when a non-Owner tries to manage owners (no read access this slice)', async () => {
      const ada = await signIn('ada@hexly.test');
      const bob = await signIn('bob@hexly.test');
      const world = await makeWorld(ada);
      const id = await makeEntity(ada, world);

      await bob.get(`/entities/${id}/owners`).expect(404);
      await bob.post(`/entities/${id}/owners`).send({ userId: carolId }).expect(404);
      await bob.delete(`/entities/${id}/owners/${adaId}`).expect(404);
    });

    it('rejects adding a target that is not an Instance user (400)', async () => {
      const ada = await signIn('ada@hexly.test');
      const world = await makeWorld(ada);
      const id = await makeEntity(ada, world);

      await ada.post(`/entities/${id}/owners`).send({ userId: 'ghost' }).expect(400);
    });
  });
});
