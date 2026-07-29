import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { unzipSync } from 'fflate';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { CompendiumPackSummary, HEXLY_SOURCE_KEY, ImportRunSummary } from '@hexly/domain';
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
import { compendiumByImporter } from './compendiums';
import { ImporterRegistry } from './importer-registry';
import { WorldsModule } from './worlds.module';

/**
 * The real `draw-steel.importer.monsters` Importer (#257, ADR-0060/0061), driven end-to-end through the generic
 * import endpoint with its fetch port backed by the committed Ajax + Goblin fixtures — so the whole pipe
 * (produce → reconcile → provenance) runs offline, never touching GitHub. The boot-time Importer uses the
 * real codeload port; each test re-registers a fixture- or failure-backed one under the same id.
 *
 * Since #398 it is a **Compendium Importer** (ADR-0079): the bestiary lands in its own Compendium Container,
 * and the World-scoped reads are asserted through the same endpoints a user hits, since "no exclusion
 * predicate was added" is only shown by the real read staying quiet. Since #404 it is installed by the
 * **operator** from the admin area rather than by a World Owner from World Settings — a pack is
 * Instance-wide, so no World is party to stocking it. The surface's own cases live in
 * `compendium-packs.controller.spec.ts`; this is the real pack running through it.
 */
describe('Draw Steel monsters import', () => {
  let app: INestApplication;
  let db: Db;
  let tedId: string;

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
    tedId = await seedOperator('ted@hexly.test', 'Ted');
  });

  afterEach(async () => {
    await app.close();
  });

  it('is a pack the operator stocks, and is offered in no World’s Imports panel', async () => {
    const ada = await signIn('ada@hexly.test');
    const ted = await signIn('ted@hexly.test');
    const world = await makeWorld(ada);

    // The label is a transloco key the web panel resolves through the plugin catalogs, not literal copy (#260).
    const packs = (await ted.get('/admin/compendiums').expect(200)).body as { importer: string; label: string }[];
    expect(packs).toContainEqual({
      importer: MONSTERS_IMPORTER_ID,
      label: 'drawSteel.importer.monsters',
      run: expect.objectContaining({ status: 'idle' }),
    });

    // A World Owner's Imports panel offers non-compendium Importers and nothing else (#404).
    const importers = (await ada.get(`/worlds/${world}/importers`).expect(200)).body as { id: string }[];
    expect(importers.map((i) => i.id)).not.toContain(MONSTERS_IMPORTER_ID);
    await ada.post(`/worlds/${world}/importers/${MONSTERS_IMPORTER_ID}/run`).expect(404);
  });

  it('imports the fixture monsters as draw-steel.type.monster Entities with stat fields and provenance', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport();

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

  it("records the Compendium's Importer, pinned rev and attribution on install", async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport();

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

  it('leaves every World-scoped read with nothing to say about the Compendium', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    // One authored Entity, so each read is asserted to be *narrow* rather than merely empty.
    const mine = await ada
      .post('/entities')
      .send({ name: 'Goblin Warren', types: ['core.type.note'], worldId: world })
      .expect(201);
    await runImport();
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
    await ada
      .post('/entities')
      .send({ name: 'Grix the Turncoat', types: [DS_MONSTER], worldId: world })
      .expect(201);
    await runImport();

    const list = await ada.get(`/entities?worldId=${world}`).expect(200);
    expect((list.body.items as { name: string }[]).map((e) => e.name)).toEqual(['Grix the Turncoat']);
    // And it is findable by the very Type the pack uses.
    const typed = await ada.get(`/entities?worldId=${world}&type=${DS_MONSTER}`).expect(200);
    expect(typed.body.items).toHaveLength(1);
  });

  it('refuses every write to a Compendium Entry — World Owner, Contributor and operator alike', async () => {
    const bob = await seed('bob@hexly.test', 'Bob');
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await ada.post(`/worlds/${world}/members`).send({ userId: bob, role: 'contributor' }).expect(200);
    await runImport();
    const goblin = await entityByName(ada, compendium().id, 'Goblin Warrior');

    const ted = await signIn('ted@hexly.test');
    const refused = { save: 403, rename: 403, visibility: 403, grant: 403, coOwner: 403, delete: 403 };
    // Ada owns Worlds and may adopt out of the shelf; she may not edit it. The seal is not a Right.
    expect(await writeStatuses(ada, goblin.id, bob)).toEqual(refused);
    // The operator installed the pack, so the install left *them* the entry's own `owner` grant, and
    // the Superadmin bypass short-circuits every access predicate to match-all besides. Refused by the
    // very same check — no Right outranks the seal (ADR-0079).
    expect(await writeStatuses(ted, goblin.id, bob)).toEqual(refused);
    // A Contributor is refused *through the seal*, not by unreachability. Nothing in the World's
    // membership confers standing on the shelf — Collaboration is World-only (ADR-0078) — but a
    // Compendium is Instance-wide with no members, so being signed in is standing enough to read it
    // (#401). Reachable and unwritable is what a 403 says, and it is now the same answer for everyone.
    expect(await writeStatuses(await signIn('bob@hexly.test'), goblin.id, bob)).toEqual(refused);

    // Nothing landed: the entry is still exactly what the Importer produced, unshared and ungranted.
    const after = (await ada.get(`/entities/${goblin.id}`).expect(200)).body;
    expect(after).toMatchObject({ name: 'Goblin Warrior', visibility: 'private', document: goblin.detail.document });
    // Read through the operator, who holds the entry's `owner` grant — the sharing surfaces are
    // Owner-only reads, and the install is what conferred that.
    expect((await ted.get(`/entities/${goblin.id}/grants`).expect(200)).body).toEqual([]);
    expect((await ted.get(`/entities/${goblin.id}/owners`).expect(200)).body).toEqual([tedId]);
  });

  it('still lets the reconcile write and delete what no user may touch', async () => {
    const ada = await signIn('ada@hexly.test');
    await runImport();
    const packId = compendium().id;
    const goblin = await entityByName(ada, packId, 'Goblin Warrior');
    await ada.patch(`/entities/${goblin.id}`).send({ name: 'My Goblin' }).expect(403);

    // The exception that proves the rule: the reconcile is the Compendium's producer, and writes
    // through the system path — no `userId`, so it never reaches the choke point the seal sits at.
    expect(await runImport()).toMatchObject({ status: 'succeeded', updated: 2 });
    await removePack();
    expect((await ada.get(`/entities?worldId=${packId}`).expect(200)).body.items).toEqual([]);
  });

  it('leaves writes to the World’s own Entities entirely alone', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    // Carrying the pack's own Type, to pin that the seal reads location and nothing else.
    const mine = await ada
      .post('/entities')
      .send({ name: 'Grix the Turncoat', types: [DS_MONSTER], worldId: world })
      .expect(201);
    await runImport();

    await ada
      .put(`/entities/${mine.body.id}`)
      .send({ document: {}, version: 1, tags: ['mine'] })
      .expect(200);
    await ada.patch(`/entities/${mine.body.id}`).send({ name: 'Grix the Loyal' }).expect(200);
    await ada.patch(`/entities/${mine.body.id}`).send({ visibility: 'shared' }).expect(200);
    await ada.delete(`/entities/${mine.body.id}`).expect(204);
  });

  /**
   * The seal as the real pack meets it (#400, ADR-0079): the find/link line, drawn once in the list read,
   * asserted here against installed content rather than a seeded Container. The rule's own cases live in
   * `entities.controller.spec.ts`; this is the pack proving it is sealed by living where it lives.
   */
  it('lets the Palette find a pack monster that no picker will ever offer', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await ada
      .post('/entities')
      .send({ name: 'Goblin Warren', types: ['core.type.note'], worldId: world })
      .expect(201);
    await runImport();
    const names = async (query: string) =>
      ((await ada.get(`/entities?${query}`).expect(200)).body.items as { name: string }[]).map((e) => e.name);

    // Navigation, unscoped as the Command Palette is: the monster is reachable by half a name, and the
    // author's own note leads at equal relevance.
    expect(await names('q=goblin')).toEqual(['Goblin Warren', 'Goblin Warrior']);
    // Link-target, the same query: the pack's Goblin is not a thing anything may point at.
    expect(await names('q=goblin&read=link-target')).toEqual(['Goblin Warren']);
  });

  it('reimports in place, keeping each entry id and re-recording the revision', async () => {
    const ada = await signIn('ada@hexly.test');
    await runImport();
    const before = await idsByName(ada, compendium().id);

    const again = await runImport();
    // Identity-preserving upsert (ADR-0060): the second run updates, never recreates.
    expect(again).toMatchObject({ status: 'succeeded', created: 0, updated: 2, deleted: 0 });
    expect(await idsByName(ada, compendium().id)).toEqual(before);
    expect(compendium().rev).toBe(MONSTERS_REV);
  });

  it('removes the Compendium, deleting its entries and the record of its install', async () => {
    const ada = await signIn('ada@hexly.test');
    await runImport();
    const packId = compendium().id;

    await removePack();

    expect((await ada.get(`/entities?worldId=${packId}`).expect(200)).body.items).toEqual([]);
    // Uninstalled, not left behind empty at a revision nothing reflects.
    expect(db.select().from(compendiums).all()).toEqual([]);
    expect(db.select().from(containers).where(eq(containers.id, packId)).all()).toEqual([]);
  });

  it('lands a fetch failure as a failed run', async () => {
    const ted = await signIn('ted@hexly.test');
    app.get(ImporterRegistry).register(
      createMonstersImporter({
        fetchMonsters: async () => {
          throw new Error('codeload unreachable');
        },
      }),
    );

    await ted.post(`/admin/compendiums/${MONSTERS_IMPORTER_ID}/run`).expect(202);
    const done = await pollUntilDone(ted);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('codeload unreachable');
    // A run that never fetched never learned a revision, so it installed nothing to misreport one.
    expect(db.select().from(compendiums).all()).toEqual([]);

    // Re-running the failed run fixes it (ADR-0060) — the interesting half here, since the failure left
    // no Compendium at all, so the recovery run has to mint one rather than reconcile into one.
    const recovered = await runImport();
    expect(recovered).toMatchObject({ status: 'succeeded', created: 2 });
    expect(compendium().rev).toBe(MONSTERS_REV);
  });

  it('serializes on the pack itself, so a second operator session cannot interleave a run', async () => {
    const ted = await signIn('ted@hexly.test');
    const alsoTed = await signIn('ted@hexly.test');
    // A Compendium is Instance-wide, so "one reconcile at a time" means one per *pack* — the Importer's
    // own id, not a World's, is what the hold is taken on (ADR-0079).
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => (release = resolve));
    app.get(ImporterRegistry).register(
      createMonstersImporter({
        fetchMonsters: async (ctx) => {
          await held;
          return fixtureFetchPort().fetchMonsters(ctx);
        },
      }),
    );

    await ted.post(`/admin/compendiums/${MONSTERS_IMPORTER_ID}/run`).expect(202);
    await alsoTed.post(`/admin/compendiums/${MONSTERS_IMPORTER_ID}/run`).expect(409);
    // Removing it is refused for the same reason: it would drop the Container out from under the
    // insert still running.
    await alsoTed.delete(`/admin/compendiums/${MONSTERS_IMPORTER_ID}`).expect(409);

    release();
    expect(await pollUntilDone(ted)).toMatchObject({ status: 'succeeded' });
    // The hold is released however the run ends, so the pack is runnable again.
    await alsoTed.post(`/admin/compendiums/${MONSTERS_IMPORTER_ID}/run`).expect(202);
    expect(await pollUntilDone(alsoTed)).toMatchObject({ status: 'succeeded' });
  });

  // ---- harness -------------------------------------------------------------

  async function seed(email: string, name: string): Promise<string> {
    return app.get(AuthService).seedUser(email, 'correct horse', name, { roles: ['create-worlds'] });
  }

  /** The operator's in-app self (ADR-0037): the Superadmin whose bypass matches every row. */
  async function seedOperator(email: string, name: string): Promise<string> {
    return app.get(AuthService).seedUser(email, 'correct horse', name, { isSuperadmin: true });
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

  /**
   * Install the pack over the committed fixtures — no network — as the operator, and wait for the
   * reconcile to finish. Signs the operator in per call so a test that only cares about *what landed*
   * does not have to hold an agent it never uses again.
   */
  async function runImport(): Promise<ImportRunSummary> {
    // Override the boot-time codeload port with the fixture-backed one.
    app.get(ImporterRegistry).register(createMonstersImporter(fixtureFetchPort()));
    const ted = await signIn('ted@hexly.test');
    await ted.post(`/admin/compendiums/${MONSTERS_IMPORTER_ID}/run`).expect(202);
    const done = await pollUntilDone(ted);
    expect(done, `the import run did not succeed: ${JSON.stringify(done)}`).toMatchObject({ status: 'succeeded' });
    return done;
  }

  /** Uninstall the pack the way the operator's panel does. */
  async function removePack(): Promise<void> {
    const ted = await signIn('ted@hexly.test');
    await ted.delete(`/admin/compendiums/${MONSTERS_IMPORTER_ID}`).expect(204);
  }

  /** The Compendium the Importer installed — its Container identity row joined to its satellite. */
  function compendium() {
    const row = compendiumByImporter(db, MONSTERS_IMPORTER_ID);
    expect(row, 'no Compendium was installed').toBeDefined();
    return row as NonNullable<typeof row>;
  }

  /**
   * A write on each axis an Entity has, keyed by what it changes — substance twice over, then exposure,
   * sharing both ways round, and lifecycle — so a caller kind is asserted in one line and a regression
   * names the axis it broke.
   */
  async function writeStatuses(agent: Agent, id: string, grantee: string): Promise<Record<string, number>> {
    return {
      save: (await agent.put(`/entities/${id}`).send({ document: {}, version: 1, tags: [] })).status,
      rename: (await agent.patch(`/entities/${id}`).send({ name: 'My Goblin' })).status,
      visibility: (await agent.patch(`/entities/${id}`).send({ visibility: 'shared' })).status,
      grant: (await agent.post(`/entities/${id}/grants`).send({ userId: grantee, role: 'editor' })).status,
      coOwner: (await agent.post(`/entities/${id}/owners`).send({ userId: grantee })).status,
      delete: (await agent.delete(`/entities/${id}`)).status,
    };
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

  /** Follow the pack's run the way the operator's panel does — off the list, which is the poll target. */
  async function pollUntilDone(operator: Agent): Promise<ImportRunSummary> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const packs = (await operator.get('/admin/compendiums').expect(200)).body as CompendiumPackSummary[];
      const run = packs.find((p) => p.importer === MONSTERS_IMPORTER_ID)?.run;
      if (run && run.status !== 'running') return run;
    }
    throw new Error('the import run never left the running state');
  }
});
