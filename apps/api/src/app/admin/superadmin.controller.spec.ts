import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Agent } from 'supertest';
import { eq } from 'drizzle-orm';
import { EntityBody, tiptapContent } from '@hexly/domain';
import { DB, Db, createDb } from '../db/db';
import { entityEdges } from '../db/schema';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from './admin.module';
import { WorldsModule } from '../worlds/worlds.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';

/**
 * The Superadmin repair surface (ADR-0046, #180): Reindex. Separate from the Instance Admin
 * surface on purpose — the Admin tier reaches no Entity, and this route reaches every one of
 * them. These specs assert what is observable at the HTTP edge: who may call it, and that a
 * derived index thrown away comes back.
 */
describe('Superadmin repair surface', () => {
  let app: INestApplication;
  let db: Db;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, AdminModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const PASSWORD = 'correct horse battery';

  /**
   * The Reindex is how an Entity that predates a derivation gains it. There is no pre-derivation
   * Entity to seed against a current build, so the spec manufactures one the only honest way:
   * save a document that expresses an edge, then throw the derived row away. Recomputing it is
   * the whole contract.
   *
   * The walk outlives the request that starts it, so the spec does what the client does: accept
   * the `202`, then poll until the job stops.
   */
  it('recomputes the edge index for every Entity, and reports how many it walked', async () => {
    await seedSuperadmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    const worldId = await makeWorld(ada, 'Aerthos');
    const ealdred = await makeEntity(ada, worldId, 'Ealdred');
    const mira = await makeEntity(ada, worldId, 'Mira');
    await link(ada, ealdred, mira);
    db.delete(entityEdges).run(); // The instance as it stood before the derivation shipped.

    const started = await ada.post('/superadmin/reindex').expect(202);
    expect(started.body).toMatchObject({ status: 'running', total: 2, walked: 0 });

    const done = await pollUntilDone(ada);

    expect(done).toMatchObject({ status: 'succeeded', walked: 2, reindexed: 2, failures: [] });
    expect(edgeTargets(ealdred)).toEqual([mira]);
  });

  /** Readable before any Reindex has ever run — the button needs to know it is free. */
  it('reports an idle job before anything has been reindexed', async () => {
    await seedSuperadmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    const res = await ada.get('/superadmin/reindex').expect(200);

    expect(res.body).toMatchObject({ status: 'idle', walked: 0, failures: [] });
  });

  /**
   * The tier boundary. An Instance Admin is the interesting row: they hold the *account*
   * surface, and the Reindex is content — so `is_admin` buys nothing here. The other two rows
   * are the floor. Both verbs are gated at the class, so neither starting a walk nor watching
   * one is reachable from the account tier.
   */
  it.each([
    ['an Instance Admin', { isAdmin: true }, 403],
    ['a plain user', {}, 403],
  ] as ReadonlyArray<readonly [string, Record<string, boolean>, number]>)(
    '%s is refused',
    async (_who, roles, status) => {
      await app.get(AuthService).seedUser('bob@hexly.test', PASSWORD, 'Bob', roles);
      const bob = await signIn('bob@hexly.test');

      await bob.post('/superadmin/reindex').expect(status);
      await bob.get('/superadmin/reindex').expect(status);
    },
  );

  it('an anonymous caller is refused before the tier is even consulted', async () => {
    await request(app.getHttpServer()).post('/superadmin/reindex').expect(401);
    await request(app.getHttpServer()).get('/superadmin/reindex').expect(401);
  });

  // ---- harness ----

  /** Follow a running job the way the admin page does, until it stops. */
  async function pollUntilDone(agent: Agent): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { body } = await agent.get('/superadmin/reindex').expect(200);
      if (body.status !== 'running') return body;
    }
    throw new Error('the reindex job never left the running state');
  }

  async function seedSuperadmin(email: string, name: string) {
    return app
      .get(AuthService)
      .seedUser(email, PASSWORD, name, { isSuperadmin: true, canCreateWorlds: true });
  }

  async function signIn(email: string): Promise<Agent> {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    return agent;
  }

  async function makeWorld(owner: Agent, name: string): Promise<string> {
    return (await owner.post('/worlds').send({ name }).expect(201)).body.id;
  }

  async function makeEntity(owner: Agent, worldId: string, name: string): Promise<string> {
    return (await owner.post('/entities').send({ name, type: 'note', worldId }).expect(201)).body.id;
  }

  /** Save `id`'s Content as prose holding one `entityLink` to `targetId`. */
  async function link(owner: Agent, id: string, targetId: string): Promise<void> {
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    const document: EntityBody = {
      type: 'note',
      content: tiptapContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'entityLink', attrs: { entityId: targetId } }],
          },
        ],
      }),
    };
    await owner
      .put(`/entities/${id}`)
      .send({ document, version: current.version, tags: [] })
      .expect(200);
  }

  function edgeTargets(sourceEntityId: string): string[] {
    return db
      .select({ targetId: entityEdges.targetId })
      .from(entityEdges)
      .where(eq(entityEdges.sourceEntityId, sourceEntityId))
      .all()
      .map((r) => r.targetId);
  }
});
