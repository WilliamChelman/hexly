import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Agent } from 'supertest';
import { eq } from 'drizzle-orm';
import { InstanceRole, EntityDocument } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
import { DB, Db, createDb } from '../db/db';
import { assetIndex, entityEdges, entityFieldFacets } from '../db/schema';
import { ASSETS_DIR } from '../assets/assets.service';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from './admin.module';
import { WorldsModule } from '../worlds/worlds.module';
import { EntitiesModule } from '../entities/entities.module';
import { ConfigModule } from '../config/config.module';

describe('Superadmin repair surface', () => {
  let app: INestApplication;
  let db: Db;
  let assetsDir: string;

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    // A throwaway Assets root, so the upload endpoint's bytes never litter the repo.
    assetsDir = mkdtempSync(join(tmpdir(), 'hexly-admin-assets-'));
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, AdminModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .overrideProvider(ASSETS_DIR)
      .useValue(assetsDir)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    rmSync(assetsDir, { recursive: true, force: true });
  });

  const PASSWORD = 'correct horse battery';

  /** The walk outlives the request that starts it: accept the `202`, then poll until the job stops. */
  it('recomputes the edge index for every Entity, and reports how many it walked', async () => {
    await seedSuperadmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    const worldId = await makeWorld(ada, 'Aerthos');
    const ealdred = await makeEntity(ada, worldId, 'Ealdred');
    const mira = await makeEntity(ada, worldId, 'Mira');
    await link(ada, ealdred, mira);
    db.delete(entityEdges).run(); // The instance as it stood before the derivation shipped.

    const started = await ada.post('/admin/reindex').expect(202);
    expect(started.body).toMatchObject({
      status: 'running',
      total: 2,
      walked: 0,
    });

    const done = await pollUntilDone(ada);

    expect(done).toMatchObject({
      status: 'succeeded',
      walked: 2,
      reindexed: 2,
      failures: [],
    });
    expect(edgeTargets(ealdred)).toEqual([mira]);
  });

  /**
   * The `assets` table dissolved into a Reindex-rebuilt `(worldId, hash) → entity` index and its
   * harvested facets (ADR-0065): derived asset state repairs through the same walk as the edges. An
   * asset uploaded, then its index and facet rows dropped as if lost, comes back on Reindex — the
   * dedup key an upload resolves against and the `kind` the Browser rail filters on.
   */
  it('rebuilds the asset hash index and harvested facets from asset Entity Documents', async () => {
    await seedSuperadmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');
    const worldId = await makeWorld(ada, 'Aerthos');

    // A tiny valid-enough PNG; only its bytes' content-address identity matters here.
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const asset = (await ada.post(`/worlds/${worldId}/assets`).attach('file', PNG, 'Portrait.png').expect(201)).body;
    const hash = asset.document['core.field.asset'].hash;

    // The instance as it stood before the derived asset state shipped — the table dropped.
    db.delete(assetIndex).run();
    db.delete(entityFieldFacets).run();

    await ada.post('/admin/reindex').expect(202);
    const done = await pollUntilDone(ada);

    expect(done).toMatchObject({ status: 'succeeded', failures: [] });
    expect(assetHashRows()).toEqual([{ entityId: asset.id, worldId, hash }]);
    // A statless PNG still faces the Browser rail by kind (ADR-0065).
    expect(facetsOf(asset.id)).toContainEqual({ key: 'kind', value: 'image' });
  });

  /** Readable before any Reindex has ever run — the button needs to know it is free. */
  it('reports an idle job before anything has been reindexed', async () => {
    await seedSuperadmin('ada@hexly.test', 'Ada');
    const ada = await signIn('ada@hexly.test');

    const res = await ada.get('/admin/reindex').expect(200);

    expect(res.body).toMatchObject({ status: 'idle', walked: 0, failures: [] });
  });

  /** The account tier (`manage-users`) reaches no content, so neither verb is reachable from it (ADR-0047). */
  it.each([
    ['a manage-users holder', { roles: ['manage-users'] as InstanceRole[] }, 403],
    ['a plain user', {}, 403],
  ] as ReadonlyArray<readonly [string, { roles?: InstanceRole[]; isSuperadmin?: boolean }, number]>)(
    '%s is refused',
    async (_who, opts, status) => {
      await app.get(AuthService).seedUser('bob@hexly.test', PASSWORD, 'Bob', opts);
      const bob = await signIn('bob@hexly.test');

      await bob.post('/admin/reindex').expect(status);
      await bob.get('/admin/reindex').expect(status);
    },
  );

  it('an anonymous caller is refused before the tier is even consulted', async () => {
    await request(app.getHttpServer()).post('/admin/reindex').expect(401);
    await request(app.getHttpServer()).get('/admin/reindex').expect(401);
  });

  // ---- harness ----

  /** Follow a running job the way the admin page does, until it stops. */
  async function pollUntilDone(agent: Agent): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { body } = await agent.get('/admin/reindex').expect(200);
      if (body.status !== 'running') return body;
    }
    throw new Error('the reindex job never left the running state');
  }

  async function seedSuperadmin(email: string, name: string) {
    return app.get(AuthService).seedUser(email, PASSWORD, name, {
      isSuperadmin: true,
      roles: ['create-worlds'],
    });
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
    return (
      await owner
        .post('/entities')
        .send({ name, types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id;
  }

  /** Save `id`'s Content as prose holding one `entityLink` to `targetId`. */
  async function link(owner: Agent, id: string, targetId: string): Promise<void> {
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    const document: EntityDocument = {
      'core.field.content': tiptapContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'entityLink', attrs: { entityId: targetId } }],
          },
        ],
      }),
    };
    await owner.put(`/entities/${id}`).send({ document, version: current.version, tags: [] }).expect(200);
  }

  function edgeTargets(sourceEntityId: string): string[] {
    return db
      .select({ targetId: entityEdges.targetId })
      .from(entityEdges)
      .where(eq(entityEdges.sourceEntityId, sourceEntityId))
      .all()
      .map((r) => r.targetId);
  }

  /** The rebuilt `(worldId, hash) → entity` dedup rows (ADR-0065). */
  function assetHashRows() {
    return db
      .select({ entityId: assetIndex.entityId, worldId: assetIndex.worldId, hash: assetIndex.hash })
      .from(assetIndex)
      .all();
  }

  /** The harvested facet rows an Entity carries (ADR-0055/0065). */
  function facetsOf(entityId: string) {
    return db
      .select({ key: entityFieldFacets.key, value: entityFieldFacets.value })
      .from(entityFieldFacets)
      .where(eq(entityFieldFacets.entityId, entityId))
      .all();
  }
});
