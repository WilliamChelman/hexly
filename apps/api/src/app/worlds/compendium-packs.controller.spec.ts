import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import {
  CompendiumPackSummary,
  HEXLY_SOURCE_KEY,
  ImportProduction,
  Importer,
  ImportRunSummary,
  INSTANCE_ROLES,
} from '@hexly/domain';
import { emptyRichContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { pinDeployment } from '../config';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { compendiums, containers, entityImportSource } from '../db/schema';
import { EntitiesModule } from '../entities/entities.module';
import { ImporterRegistry } from './importer-registry';
import { WorldsModule } from './worlds.module';

const PACK_ID = 'test.importer.pack';
const PLAIN_ID = 'test.importer.plain';

/** One fixture Import Record; `types` defaults to a bare Note so it lists like any Entity. */
function record(sourceId: string, name: string) {
  return { sourceId, name, types: ['core.type.note'], document: { 'core.field.content': emptyRichContent() } };
}

/**
 * The operator's compendium pack surface (ADR-0079, #404): install, reimport and removal of a pack,
 * in the admin area rather than in World Settings, because a Compendium is Instance-wide and managing
 * one is the operator's job. Driven by a stub **Compendium Importer** so the whole surface is
 * exercised without a network; the real Draw Steel pack runs through the same routes in
 * `draw-steel-monsters-import.controller.spec.ts`.
 */
describe('Compendium packs (operator)', () => {
  let app: INestApplication;
  let db: Db;

  /** The stub's next production; a test sets it before running. */
  let production: ImportProduction;
  /** When set, `produce` parks on it — so a test can hold a run mid-flight (409, poll-while-running). */
  let gate: Promise<void> | null;

  const pack: Importer = {
    id: PACK_ID,
    label: 'Stub Pack',
    compendium: { name: 'Stub Pack', attribution: { publisher: 'Stub Press' } },
    produce: async () => {
      if (gate) await gate;
      return production;
    },
  };

  /** A plain Importer, to pin that the two surfaces list disjoint sets. */
  const plain: Importer = {
    id: PLAIN_ID,
    label: 'Plain Importer',
    produce: async () => ({ rev: 'rev-1', records: [] }),
  };

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    production = { rev: 'rev-1', records: [] };
    gate = null;

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

    app.get(ImporterRegistry).register(pack);
    app.get(ImporterRegistry).register(plain);

    await seedOperator('ted@hexly.test', 'Ted');
    await seed('ada@hexly.test', 'Ada');
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists a pack before it is installed, and with its pinned revision after', async () => {
    const ted = await signIn('ted@hexly.test');
    production = { rev: 'rev-7', records: [record('goblin', 'Goblin'), record('spider', 'Spider')] };

    const before = await packRow(ted, PACK_ID);
    // Nothing is on the shelf yet, so there is no Container, no revision, and no run to report.
    expect(before).toEqual({ importer: PACK_ID, label: 'Stub Pack', run: expect.objectContaining({ status: 'idle' }) });

    await install(ted, PACK_ID);

    const after = await packRow(ted, PACK_ID);
    expect(after.installed).toMatchObject({ name: 'Stub Pack', rev: 'rev-7', entryCount: 2 });
    expect(after.installed?.id).toBe(db.select().from(compendiums).all()[0].id);
    expect(after.run).toMatchObject({ status: 'succeeded', rev: 'rev-7', created: 2 });
  });

  it('lists packs and World Importers as disjoint sets', async () => {
    const ted = await signIn('ted@hexly.test');
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);

    // The pack is the operator's business; it is not offered where a World Owner imports. The bundled
    // Draw Steel pack is registered at boot too, so assert membership rather than sole occupancy.
    const packs = ((await ted.get('/admin/compendiums').expect(200)).body as CompendiumPackSummary[]).map(
      (p) => p.importer,
    );
    const importers = ((await ada.get(`/worlds/${world}/importers`).expect(200)).body as { id: string }[]).map(
      (i) => i.id,
    );
    expect(packs).toContain(PACK_ID);
    expect(packs).not.toContain(PLAIN_ID);
    expect(importers).toContain(PLAIN_ID);
    expect(importers).not.toContain(PACK_ID);
    // The Draw Steel monsters Importer is a pack, so it left World Settings with the rest of them.
    expect(importers).not.toContain('draw-steel.importer.monsters');
  });

  it('lands the pack in its own Compendium, in no World at all', async () => {
    const ted = await signIn('ted@hexly.test');
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };

    await install(ted, PACK_ID);

    const packId = (await packRow(ted, PACK_ID)).installed?.id as string;
    const entries = (await ada.get(`/entities?worldId=${packId}`).expect(200)).body.items as { name: string }[];
    expect(entries.map((e) => e.name)).toEqual(['Goblin']);
    // The World the operator happens to own nothing of stays empty: a pack is installed once per
    // Instance and belongs to no World (ADR-0079).
    expect((await ada.get(`/entities?worldId=${world}`).expect(200)).body.items).toEqual([]);
  });

  it('reimports in place: same entry ids, the revision re-recorded, a vanished entry gone', async () => {
    const ted = await signIn('ted@hexly.test');
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin'), record('spider', 'Spider')] };
    await install(ted, PACK_ID);
    const packId = (await packRow(ted, PACK_ID)).installed?.id as string;
    const before = await idsByName(ted, packId);

    production = { rev: 'rev-2', records: [record('goblin', 'Hobgoblin'), record('orc', 'Orc')] };
    const again = await install(ted, PACK_ID);
    // Identity-preserving (ADR-0060): the goblin keeps its id through a rename.
    expect(again).toMatchObject({ status: 'succeeded', created: 1, updated: 1, deleted: 1 });
    const after = await idsByName(ted, packId);
    expect(after['Hobgoblin']).toBe(before['Goblin']);
    expect(after['Spider']).toBeUndefined();
    // The shelf states the revision its entries actually reflect.
    expect((await packRow(ted, PACK_ID)).installed).toMatchObject({ rev: 'rev-2', entryCount: 2 });
  });

  it('fixes a failed run by re-running it', async () => {
    const ted = await signIn('ted@hexly.test');
    const failing: Importer = {
      ...pack,
      produce: async () => {
        throw new Error('source unreachable');
      },
    };
    const restore = app.get(ImporterRegistry).register(failing);

    await ted.post(`/admin/compendiums/${PACK_ID}/run`).expect(202);
    const failed = await pollUntilDone(ted, PACK_ID);
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('source unreachable') });
    // A run that never fetched never learned a revision, so it installed nothing to misreport one.
    expect(await packRow(ted, PACK_ID)).not.toHaveProperty('installed');

    restore();
    app.get(ImporterRegistry).register(pack);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };
    expect(await install(ted, PACK_ID)).toMatchObject({ status: 'succeeded', created: 1 });
  });

  it('removes a pack, deleting its entries and leaving an adopted copy untouched', async () => {
    const ted = await signIn('ted@hexly.test');
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };
    await install(ted, PACK_ID);
    const packId = (await packRow(ted, PACK_ID)).installed?.id as string;
    const entryId = Object.values(await idsByName(ted, packId))[0];

    // Ada adopts the goblin before the operator uninstalls the shelf out from under her.
    const copy = await ada.post(`/entities/${entryId}/adopt`).send({ worldId: world }).expect(201);

    await ted.delete(`/admin/compendiums/${PACK_ID}`).expect(204);

    // Entries gone, and the install itself forgotten — not left behind empty at a revision nothing reflects.
    expect((await ada.get(`/entities?worldId=${packId}`).expect(200)).body.items).toEqual([]);
    expect(db.select().from(compendiums).all()).toEqual([]);
    expect(db.select().from(containers).where(eq(containers.id, packId)).all()).toEqual([]);
    expect(db.select().from(entityImportSource).all()).toEqual([]);
    // The adopted copy is an ordinary Entity of Ada's World; uninstalling does not gut her dungeon.
    const adopted = (await ada.get(`/entities/${copy.body.id}`).expect(200)).body;
    expect(adopted).toMatchObject({ name: 'Goblin', worldId: world });
    expect(adopted.document[HEXLY_SOURCE_KEY]).toBeUndefined();
    // Uninstalled and re-installable: the pack is offered again, with nothing on the shelf.
    expect(await packRow(ted, PACK_ID)).not.toHaveProperty('installed');
  });

  it('refuses a second run, and a removal, while one is in flight (409)', async () => {
    const ted = await signIn('ted@hexly.test');
    // Park the run inside produce, so it is still in flight when the next request arrives.
    gate = new Promise<void>(() => undefined);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };

    await ted.post(`/admin/compendiums/${PACK_ID}/run`).expect(202);
    expect((await packRow(ted, PACK_ID)).run.status).toBe('running');
    expect((await ted.post(`/admin/compendiums/${PACK_ID}/run`).expect(409)).body.code).toBe('import-running');
    expect((await ted.delete(`/admin/compendiums/${PACK_ID}`).expect(409)).body.code).toBe('import-running');
  });

  it('404s an Importer that is not a pack, and one that does not exist', async () => {
    const ted = await signIn('ted@hexly.test');
    // A plain Importer reconciles into a World and is not managed here — no route of this surface
    // may reach it, or the operator could land a World importer in nobody's World.
    await ted.post(`/admin/compendiums/${PLAIN_ID}/run`).expect(404);
    await ted.delete(`/admin/compendiums/${PLAIN_ID}`).expect(404);
    await ted.post('/admin/compendiums/nope.importer.missing/run').expect(404);
    await ted.delete('/admin/compendiums/nope.importer.missing').expect(404);
  });

  it('refuses the whole surface to a non-operator, and to a stranger', async () => {
    const ted = await signIn('ted@hexly.test');
    const ada = await signIn('ada@hexly.test');
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };
    await install(ted, PACK_ID);

    // Ada owns Worlds and may adopt from the shelf, but a Compendium is Instance-wide: stocking it is
    // the operator's, not hers (ADR-0079).
    await ada.get('/admin/compendiums').expect(403);
    await ada.post(`/admin/compendiums/${PACK_ID}/run`).expect(403);
    await ada.delete(`/admin/compendiums/${PACK_ID}`).expect(403);
    // Refused, not merely hidden: the shelf still stands.
    expect(db.select().from(compendiums).all()).toHaveLength(1);

    const stranger = request.agent(app.getHttpServer());
    await stranger.get('/admin/compendiums').expect(401);
    await stranger.post(`/admin/compendiums/${PACK_ID}/run`).expect(401);
    await stranger.delete(`/admin/compendiums/${PACK_ID}`).expect(401);
  });

  // ---- harness -------------------------------------------------------------

  async function seed(email: string, name: string): Promise<string> {
    return app.get(AuthService).seedUser(email, 'correct horse', name, { roles: ['create-worlds'] });
  }

  /** The operator's in-app self (ADR-0037, CONTEXT.md → Superadmin). */
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

  /** Install (or reimport) a pack the way the panel does, and wait for the reconcile to land. */
  async function install(operator: Agent, importerId: string): Promise<ImportRunSummary> {
    await operator.post(`/admin/compendiums/${importerId}/run`).expect(202);
    return pollUntilDone(operator, importerId);
  }

  async function packRow(operator: Agent, importerId: string): Promise<CompendiumPackSummary> {
    const packs = (await operator.get('/admin/compendiums').expect(200)).body as CompendiumPackSummary[];
    const row = packs.find((p) => p.importer === importerId);
    expect(row, `no pack row for ${importerId}`).toBeDefined();
    return row as CompendiumPackSummary;
  }

  /** Every entry in a Container as `name → id`, so a reimport can be shown to reuse each id. */
  async function idsByName(agent: Agent, containerId: string): Promise<Record<string, string>> {
    const list = await agent.get(`/entities?worldId=${containerId}`).expect(200);
    return Object.fromEntries((list.body.items as { id: string; name: string }[]).map((e) => [e.name, e.id]));
  }

  /** Follow a running run the way the pack panel does — off the list, which is the poll target. */
  async function pollUntilDone(operator: Agent, importerId: string): Promise<ImportRunSummary> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { run } = await packRow(operator, importerId);
      if (run.status !== 'running') return run;
    }
    throw new Error('the import run never left the running state');
  }
});

/**
 * The **Sole User** Instance with **Collaboration** off (ADR-0071, ADR-0079): the shelf and the sharing
 * switch are independent, so nothing in this ticket may ride on the Collaboration layer. Its own
 * `describe`, because the deployment pin has to be set before the Nest graph composes.
 */
describe('Compendium packs with Collaboration off', () => {
  let app: INestApplication;
  let db: Db;

  const pack: Importer = {
    id: PACK_ID,
    label: 'Stub Pack',
    compendium: { name: 'Stub Pack' },
    produce: async () => ({ rev: 'rev-1', records: [record('goblin', 'Goblin')] }),
  };

  beforeEach(async () => {
    db = createDb(':memory:'); // Isolated per-test (ADR-0002).
    // The entry-point pin (ADR-0071) rather than a fabricated HEXLY_CONFIG, so ConfigModule still
    // composes the rest of the config for real.
    pinDeployment({ collaboration: false });
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule, WorldsModule, EntitiesModule],
    })
      .overrideProvider(DB)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.listen(0);
    app.get(ImporterRegistry).register(pack);
  });

  afterEach(async () => {
    pinDeployment({});
    await app.close();
  });

  it('is stocked, browsed and adopted from exactly as it is with Collaboration on', async () => {
    // The Sole User's shape (ADR-0071): Superadmin holding every Instance Role — so they are their own
    // operator, which is the whole of "a single-user Instance sees no functional difference".
    await app
      .get(AuthService)
      .seedUser('solo@hexly.test', 'correct horse', 'Solo', { isSuperadmin: true, roles: [...INSTANCE_ROLES] });
    const solo = request.agent(app.getHttpServer());
    await solo.post('/auth/login').send({ email: 'solo@hexly.test', password: 'correct horse' }).expect(200);
    const world = (await solo.post('/worlds').send({ name: 'Aldermoor' }).expect(201)).body.id;

    await solo.post(`/admin/compendiums/${PACK_ID}/run`).expect(202);
    let packs: CompendiumPackSummary[] = [];
    for (let attempt = 0; attempt < 50; attempt++) {
      packs = (await solo.get('/admin/compendiums').expect(200)).body as CompendiumPackSummary[];
      if (packs.find((p) => p.importer === PACK_ID)?.run.status !== 'running') break;
    }
    const installed = packs.find((p) => p.importer === PACK_ID)?.installed;
    expect(installed).toMatchObject({ rev: 'rev-1', entryCount: 1 });

    // Browsable, and adoptable into a World: the two things a reader does with a shelf, neither of
    // which asks the Collaboration layer anything.
    const entries = (await solo.get(`/entities?worldId=${installed?.id}`).expect(200)).body.items as { id: string }[];
    expect(entries).toHaveLength(1);
    const copy = await solo.post(`/entities/${entries[0].id}/adopt`).send({ worldId: world }).expect(201);
    expect(copy.body).toMatchObject({ name: 'Goblin', worldId: world });
    expect(copy.body.document[HEXLY_SOURCE_KEY]).toBeUndefined();
  });
});
