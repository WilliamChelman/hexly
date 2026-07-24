import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { HEXLY_SOURCE_KEY } from '@hexly/domain';
import { DS_MONSTER, DS_STAT_BLOCK_KEY } from '@hexly/plugin-draw-steel';
import { createMonstersImporter, MONSTERS_IMPORTER_ID, MONSTERS_REV } from '@hexly/plugin-draw-steel/server';
import { fixtureFetchPort } from '@hexly/plugin-draw-steel/server/testing';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { EntitiesModule } from '../entities/entities.module';
import { ImporterRegistry } from './importer-registry';
import { WorldsModule } from './worlds.module';

/**
 * The real `draw-steel.importer.monsters` Importer (#257, ADR-0060/0061), driven end-to-end through the generic
 * import endpoint with its fetch port backed by the committed Ajax + Goblin fixtures — so the whole pipe
 * (produce → reconcile → provenance) runs offline, never touching GitHub. The boot-time Importer uses the
 * real codeload port; each test re-registers a fixture- or failure-backed one under the same id.
 */
describe('Draw Steel monsters import', () => {
  let app: INestApplication;
  let db: Db;

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

    await seed('ada@hexly.test', 'Ada');
  });

  afterEach(async () => {
    await app.close();
  });

  it('offers draw-steel.importer.monsters in the Importer list for a World', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    const res = await ada.get(`/worlds/${world}/importers`).expect(200);
    // The label is a transloco key the web panel resolves through the plugin catalogs, not literal copy (#260).
    expect(res.body).toContainEqual({ id: MONSTERS_IMPORTER_ID, label: 'drawSteel.importer.monsters' });
  });

  it('imports the fixture monsters as draw-steel.type.monster Entities with stat fields and provenance', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    // Override the boot-time codeload port with the fixture-backed one — no network.
    app.get(ImporterRegistry).register(createMonstersImporter(fixtureFetchPort()));

    await ada
      .post(`/worlds/${world}/importers/${MONSTERS_IMPORTER_ID}/run`)
      .send({ visibility: 'private' })
      .expect(202);
    const done = await pollUntilDone(ada, world);
    expect(done).toMatchObject({ status: 'succeeded', created: 2, deleted: 0, skipped: [] });

    const ajax = await entityByName(ada, world, 'Ajax the Invincible');
    expect(ajax.detail.types).toEqual([DS_MONSTER]);

    // The straight-in scalar spine landed in the stat block (#257).
    expect(ajax.detail.document[DS_STAT_BLOCK_KEY]).toMatchObject({
      might: 5,
      level: 11,
      ev: 156,
      stamina: 700,
      stability: 2,
      speed: 7,
      free_strike: 11,
      keywords: ['humanoid', 'human'],
    });

    // The full stat block lands faithfully (#258/#259): three traits and the 16 abilities.
    const ajaxBlock = ajax.detail.document[DS_STAT_BLOCK_KEY] as {
      traits: { name: string }[];
      abilities: { name: string; category?: string; powerRoll?: { t1: string } }[];
    };
    expect(ajaxBlock.traits.map((trait) => trait.name)).toEqual(['Ajax', "I'm Not Done Yet.", 'Tactical Stance']);
    expect(ajaxBlock.abilities).toHaveLength(16);
    // The signature ability's multi-tier power roll survives the round trip through produce → reconcile.
    const blade = ajaxBlock.abilities.find((ability) => ability.name === 'Blade of the Gol King');
    expect(blade?.category).toBe('signature');
    expect(blade?.powerRoll?.t1).toBe('16 damage; M < 4 the target loses 1d3 Recoveries');
    // No raw enricher token leaks into the landed document.
    expect(JSON.stringify(ajaxBlock)).not.toMatch(/\[\[|\]\]|\{\{|@chr/);

    // Provenance stamped by the reconcile — the importer id and the pinned rev.
    expect(ajax.detail.document[HEXLY_SOURCE_KEY]).toEqual({
      importer: MONSTERS_IMPORTER_ID,
      sourceId: 'DZKCzrvXRPBUjUJf',
      rev: MONSTERS_REV,
    });

    // Art is dropped — no `img` anywhere in the imported document (ADR-0061).
    expect(JSON.stringify(ajax.detail.document)).not.toContain('.webp');

    // The Goblin imports its family too, including the applied-condition tiers resolved via monster potency.
    const goblin = await entityByName(ada, world, 'Goblin Warrior');
    const goblinBlock = goblin.detail.document[DS_STAT_BLOCK_KEY] as {
      abilities: { name: string; powerRoll?: { t1: string } }[];
    };
    expect(goblinBlock.abilities).toHaveLength(5);
    const bury = goblinBlock.abilities.find((ability) => ability.name === 'Bury The Point');
    expect(bury?.powerRoll?.t1).toBe('5 damage; M < 0 bleeding (save ends)');
  });

  it('lands a fetch failure as a failed run', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    app.get(ImporterRegistry).register(
      createMonstersImporter({
        fetchMonsters: async () => {
          throw new Error('codeload unreachable');
        },
      }),
    );

    await ada
      .post(`/worlds/${world}/importers/${MONSTERS_IMPORTER_ID}/run`)
      .send({ visibility: 'private' })
      .expect(202);
    const done = await pollUntilDone(ada, world);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('codeload unreachable');
  });

  // ---- harness -------------------------------------------------------------

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

  async function entityByName(agent: Agent, worldId: string, name: string) {
    const list = await agent.get(`/entities?worldId=${worldId}`).expect(200);
    const summary = (list.body.items as { id: string; name: string }[]).find((e) => e.name === name);
    expect(summary, `no Entity named ${name}`).toBeDefined();
    const detail = (await agent.get(`/entities/${summary?.id}`).expect(200)).body;
    return { id: summary?.id as string, detail };
  }

  async function pollUntilDone(agent: Agent, worldId: string): Promise<Record<string, string>> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { body } = await agent.get(`/worlds/${worldId}/import/status`).expect(200);
      if (body.status !== 'running') return body;
    }
    throw new Error('the import run never left the running state');
  }
});
