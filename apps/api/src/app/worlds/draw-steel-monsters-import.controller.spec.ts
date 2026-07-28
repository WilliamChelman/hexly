import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { unzipSync } from 'fflate';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { HEXLY_SOURCE_KEY } from '@hexly/domain';
import { DS_MONSTER, DS_STAT_BLOCK_KEY } from '@hexly/plugin-draw-steel';
import {
  createMonstersImporter,
  MONSTERS_COMPENDIUM,
  MONSTERS_IMPORTER_ID,
  MONSTERS_REV,
} from '@hexly/plugin-draw-steel/server';
import { fixtureFetchPort } from '@hexly/plugin-draw-steel/server/testing';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { compendiums, containers } from '../db/schema';
import { EntitiesModule } from '../entities/entities.module';
import { ImporterRegistry } from './importer-registry';
import { WorldsModule } from './worlds.module';

/**
 * The real `draw-steel.importer.monsters` Importer (#257, ADR-0060/0061), driven end-to-end through the generic
 * import endpoint with its fetch port backed by the committed Ajax + Goblin fixtures — so the whole pipe
 * (produce → reconcile → provenance) runs offline, never touching GitHub. The boot-time Importer uses the
 * real codeload port; each test re-registers a fixture- or failure-backed one under the same id.
 *
 * Since #398 it is a **Compendium Importer** (ADR-0079), so this file also carries the ticket's payoff: the
 * bestiary lands in the pack's own Compendium Container, and every World-scoped read goes quiet about it
 * with no exclusion predicate added anywhere. Those assertions are deliberately made at the HTTP seam
 * against the *same* endpoints a user hits, because "the read did not change" is only credible if the read
 * is the real one.
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
    // Listen for real: supertest otherwise churns an ephemeral port per request, and a reused loopback
    // 4-tuple still in TIME_WAIT is RST as `socket hang up`.
    await app.listen(0);

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
    await runImport(ada, world);

    // The pack lands in its own Compendium, not in the World the run was asked from (ADR-0079).
    const pack = compendium();
    const ajax = await entityByName(ada, pack.id, 'Ajax the Invincible');
    expect(ajax.detail.types).toEqual([DS_MONSTER]);
    // An Entity carries its Container; a Compendium Entry's is the pack's, never a World's.
    expect(ajax.detail.worldId).toBe(pack.id);
    expect(ajax.detail.worldId).not.toBe(world);

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
    const goblin = await entityByName(ada, pack.id, 'Goblin Warrior');
    const goblinBlock = goblin.detail.document[DS_STAT_BLOCK_KEY] as {
      abilities: { name: string; powerRoll?: { t1: string } }[];
    };
    expect(goblinBlock.abilities).toHaveLength(5);
    const bury = goblinBlock.abilities.find((ability) => ability.name === 'Bury The Point');
    expect(bury?.powerRoll?.t1).toBe('5 damage; M < 0 bleeding (save ends)');
  });

  it("records the pack's importer, pinned rev and attribution on install", async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);

    const pack = compendium();
    // The Container is a Compendium, named by the Importer's declaration — not a World wearing a flag.
    expect(pack.kind).toBe('compendium');
    expect(pack.name).toBe(MONSTERS_COMPENDIUM.name);
    // Captured on install so the terms render where the content is read (#402), not only in the source tree.
    expect(pack).toMatchObject({
      importer: MONSTERS_IMPORTER_ID,
      rev: MONSTERS_REV,
      publisher: MONSTERS_COMPENDIUM.attribution?.publisher,
      license: MONSTERS_COMPENDIUM.attribution?.license,
      notice: MONSTERS_COMPENDIUM.attribution?.notice,
    });
    // One Compendium per pack — the collapse of the reconcile's match key rests on it.
    expect(db.select().from(compendiums).all()).toHaveLength(1);
  });

  it('leaves every World-scoped read with nothing to say about the pack', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    // One authored Entity, so each read is asserted to be *narrow* rather than merely empty.
    const mine = await ada
      .post('/entities')
      .send({ name: 'Goblin Warren', types: ['core.type.note'], worldId: world })
      .expect(201);
    await runImport(ada, world);
    // The pack really is installed, so a quiet World is exclusion and not a failed import.
    expect((await ada.get(`/entities?worldId=${compendium().id}`).expect(200)).body.items).toHaveLength(2);

    const names = async (query: string) =>
      ((await ada.get(`/entities?${query}`).expect(200)).body.items as { name: string }[]).map((e) => e.name);

    // 1. The Entity Browser lists what the World's authors created, and only that.
    expect(await names(`worldId=${world}`)).toEqual(['Goblin Warren']);
    // 2. In-World full-text search: "goblin" finds the author's note, never the pack's Goblins.
    expect(await names(`worldId=${world}&q=goblin`)).toEqual(['Goblin Warren']);
    // 3. The Facet rail counts the same set — no monster Type appears at all.
    const facets = (await ada.get(`/entities/facets?worldId=${world}`).expect(200)).body;
    expect(facets.type).toEqual([{ value: 'core.type.note', count: 1 }]);
    // 4. The World Graph holds one node, not three hundred disconnected ones.
    const graph = (await ada.get(`/worlds/${world}/graph`).expect(200)).body;
    expect(graph.nodes.map((n: { id: string }) => n.id)).toEqual([mine.body.id]);
    // 5. The World's Entity count reports what its author wrote.
    expect((await ada.get(`/worlds/${world}`).expect(200)).body.entityCount).toBe(1);
    // 6. The Vault export carries the World, and cannot carry what is not in it.
    const res = await ada.get(`/worlds/${world}/export`).responseType('blob').expect(200);
    const files = Object.keys(unzipSync(new Uint8Array(res.body)));
    expect(files).toContain('Goblin Warren.md');
    expect(files.filter((path) => path.includes('Goblin Warrior'))).toEqual([]);
    expect(files.filter((path) => path.includes('Ajax'))).toEqual([]);
  });

  it('still lists a hand-written NPC that happens to be a monster', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    // The original complaint: compendium-ness is location, never Entity Type, so carrying the pack's
    // Type must not exile an authored Entity from its author's own Browser (ADR-0079).
    await ada.post('/entities').send({ name: 'Grix the Turncoat', types: [DS_MONSTER], worldId: world }).expect(201);
    await runImport(ada, world);

    const list = await ada.get(`/entities?worldId=${world}`).expect(200);
    expect((list.body.items as { name: string }[]).map((e) => e.name)).toEqual(['Grix the Turncoat']);
    // And it is findable by the very Type the pack uses.
    const typed = await ada.get(`/entities?worldId=${world}&type=${DS_MONSTER}`).expect(200);
    expect(typed.body.items).toHaveLength(1);
  });

  it('reimports in place, keeping each entry id and re-recording the revision', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);
    const before = await idsByName(ada, compendium().id);

    const again = await runImport(ada, world);
    // Identity-preserving upsert (ADR-0060): the second run updates, never recreates.
    expect(again).toMatchObject({ status: 'succeeded', created: 0, updated: 2, deleted: 0 });
    expect(await idsByName(ada, compendium().id)).toEqual(before);
    expect(compendium().rev).toBe(MONSTERS_REV);
  });

  it('removes the pack, deleting its entries and uninstalling the shelf', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);
    const packId = compendium().id;

    await ada.delete(`/worlds/${world}/importers/${MONSTERS_IMPORTER_ID}`).expect(204);

    expect((await ada.get(`/entities?worldId=${packId}`).expect(200)).body.items).toEqual([]);
    // Uninstalled, not left behind empty at a revision nothing reflects.
    expect(db.select().from(compendiums).all()).toEqual([]);
    expect(db.select().from(containers).where(eq(containers.id, packId)).all()).toEqual([]);
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
    // A run that never fetched never learned a revision, so it installed no shelf to misreport one.
    expect(db.select().from(compendiums).all()).toEqual([]);
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

  /** Run the pack over the committed fixtures — no network — and wait for the reconcile to finish. */
  async function runImport(agent: Agent, worldId: string): Promise<Record<string, string>> {
    // Override the boot-time codeload port with the fixture-backed one.
    app.get(ImporterRegistry).register(createMonstersImporter(fixtureFetchPort()));
    await agent.post(`/worlds/${worldId}/importers/${MONSTERS_IMPORTER_ID}/run`).send({ visibility: 'private' }).expect(202);
    const done = await pollUntilDone(agent, worldId);
    expect(done, `the import run did not succeed: ${JSON.stringify(done)}`).toMatchObject({ status: 'succeeded' });
    return done;
  }

  /** The installed pack, as its Container identity row joined to its satellite. */
  function compendium() {
    const row = db
      .select({
        id: containers.id,
        kind: containers.kind,
        name: containers.name,
        importer: compendiums.importer,
        rev: compendiums.rev,
        publisher: compendiums.publisher,
        license: compendiums.license,
        notice: compendiums.notice,
      })
      .from(compendiums)
      .innerJoin(containers, eq(containers.id, compendiums.id))
      .get();
    expect(row, 'no Compendium was installed').toBeDefined();
    return row as NonNullable<typeof row>;
  }

  async function entityByName(agent: Agent, containerId: string, name: string) {
    const list = await agent.get(`/entities?worldId=${containerId}`).expect(200);
    const summary = (list.body.items as { id: string; name: string }[]).find((e) => e.name === name);
    expect(summary, `no Entity named ${name}`).toBeDefined();
    const detail = (await agent.get(`/entities/${summary?.id}`).expect(200)).body;
    return { id: summary?.id as string, detail };
  }

  /** Every Entity in a Container as `name → id`, so a reimport can be shown to reuse each id. */
  async function idsByName(agent: Agent, containerId: string): Promise<Record<string, string>> {
    const list = await agent.get(`/entities?worldId=${containerId}`).expect(200);
    return Object.fromEntries((list.body.items as { id: string; name: string }[]).map((e) => [e.name, e.id]));
  }

  async function pollUntilDone(agent: Agent, worldId: string): Promise<Record<string, string>> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { body } = await agent.get(`/worlds/${worldId}/import/status`).expect(200);
      if (body.status !== 'running') return body;
    }
    throw new Error('the import run never left the running state');
  }
});
