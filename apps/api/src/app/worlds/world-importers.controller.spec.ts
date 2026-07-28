import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { HEXLY_SOURCE_KEY, ImportProduction, Importer } from '@hexly/domain';
import { emptyRichContent, tiptapContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { compendiums, containers, entityImportSource } from '../db/schema';
import { EntitiesModule } from '../entities/entities.module';
import { ImporterRegistry } from './importer-registry';
import { WorldsModule } from './worlds.module';

const STUB_ID = 'test.importer.stub';

/** One fixture Import Record; `types` defaults to a bare Note so it lists like any Entity. */
function record(sourceId: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    sourceId,
    name,
    types: ['core.type.note'],
    document: { 'core.field.content': emptyRichContent(), ...extra },
  };
}

/**
 * The per-World Importer surface (ADR-0060), driven by a stub Importer producing fixture Records — no
 * real plugin importer yet. Exercises the generic reconcile: run/reimport/poll/remove, provenance
 * stamping, identity-preserving upsert, and the owner gate.
 */
describe('World importers', () => {
  let app: INestApplication;
  let db: Db;
  let bobId: string;

  /** The stub's next production; a test sets it before running. */
  let production: ImportProduction;
  /** When set, `produce` parks on it — so a test can hold a run mid-flight (409, poll-while-running). */
  let gate: Promise<void> | null;

  const stub: Importer = {
    id: STUB_ID,
    label: 'Stub Importer',
    produce: async () => {
      if (gate) await gate;
      return production;
    },
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

    // No bundled plugin ships an Importer yet, so the whole feature is driven by this stub.
    app.get(ImporterRegistry).register(stub);

    await seed('ada@hexly.test', 'Ada');
    bobId = await seed('bob@hexly.test', 'Bob');
    await seed('carol@hexly.test', 'Carol');
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists the Importers a World offers', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);

    const res = await ada.get(`/worlds/${world}/importers`).expect(200);
    // The bundled `draw-steel.importer.monsters` Importer is also registered at boot, so assert the stub is offered
    // rather than that it is the only entry.
    expect(res.body).toContainEqual({ id: STUB_ID, label: 'Stub Importer' });
  });

  it('runs an Importer, stamps hexly.source, populates the provenance index, and reports the summary', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin'), record('spider', 'Spider')] };

    const started = await ada
      .post(`/worlds/${world}/importers/${STUB_ID}/run`)
      .send({ visibility: 'private' })
      .expect(202);
    expect(started.body).toMatchObject({ importer: STUB_ID, status: 'running' });

    const done = await pollUntilDone(ada, world);
    // The status surfaces the pinned rev the run resolved, so the panel's last-run line can show it (#260).
    expect(done).toMatchObject({ status: 'succeeded', rev: 'rev-1', created: 2, updated: 0, deleted: 0, skipped: [] });

    const goblin = await entityByName(ada, world, 'Goblin');
    expect(goblin.detail.document[HEXLY_SOURCE_KEY]).toEqual({ importer: STUB_ID, sourceId: 'goblin', rev: 'rev-1' });

    // The derived provenance index mirrors the stamp — one row per imported Entity.
    const rows = db.select().from(entityImportSource).where(eq(entityImportSource.containerId, world)).all();
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({ entityId: goblin.id, importer: STUB_ID, sourceId: 'goblin', rev: 'rev-1' }),
    );
  });

  it('reconciles an Importer that declares no Compendium into the World, unchanged', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };

    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    await pollUntilDone(ada, world);

    // The declaration is what redirects a run (ADR-0079); without one the Entity lands in the World the
    // caller named, and no shelf is installed behind its back.
    const goblin = await entityByName(ada, world, 'Goblin');
    expect(goblin.detail.worldId).toBe(world);
    expect(db.select().from(compendiums).all()).toEqual([]);
    expect(db.select().from(containers).where(eq(containers.kind, 'compendium')).all()).toEqual([]);
  });

  it('honours the chosen visibility', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };

    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'shared' }).expect(202);
    await pollUntilDone(ada, world);

    const goblin = await entityByName(ada, world, 'Goblin');
    expect(goblin.detail.visibility).toBe('shared');
  });

  it('reimports idempotently: same ids, a vanished sourceId deleted, an inbound link still resolves', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);

    production = { rev: 'rev-1', records: [record('goblin', 'Goblin'), record('spider', 'Spider')] };
    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    await pollUntilDone(ada, world);

    const goblinBefore = (await entityByName(ada, world, 'Goblin')).id;

    // A hand-authored Note links to the imported goblin — the link must survive a reimport.
    const chronicle = await makeEntity(ada, world, 'Chronicle');
    await link(ada, chronicle, goblinBefore);

    // Reimport: goblin renamed and still present, spider vanished, an orc added.
    production = { rev: 'rev-2', records: [record('goblin', 'Hobgoblin'), record('orc', 'Orc')] };
    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    const done = await pollUntilDone(ada, world);
    expect(done).toMatchObject({ status: 'succeeded', created: 1, updated: 1, deleted: 1, skipped: [] });

    const goblinAfter = await entityByName(ada, world, 'Hobgoblin');
    // Identity-preserving: the goblin's Entity id is reused, and its stamp reflects the new rev.
    expect(goblinAfter.id).toBe(goblinBefore);
    expect(goblinAfter.detail.document[HEXLY_SOURCE_KEY]).toMatchObject({ sourceId: 'goblin', rev: 'rev-2' });
    // The vanished spider was deleted; the new orc created.
    await expectMissing(ada, world, 'Spider');
    expect((await entityByName(ada, world, 'Orc')).id).toBeDefined();

    // The pre-existing inbound link still resolves to the reused Entity.
    const refs = (await ada.get(`/entities/${goblinBefore}/references`).expect(200)).body;
    expect(refs.referencedBy).toEqual([
      expect.objectContaining({ source: expect.objectContaining({ id: chronicle, name: 'Chronicle' }) }),
    ]);
  });

  it('skips a malformed Record, tallying it without aborting the run', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    // The second Record has a blank name — ill-shaped, so it is skipped, not fatal.
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin'), record('void', '   ')] };

    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    const done = await pollUntilDone(ada, world);

    expect(done).toMatchObject({ status: 'succeeded', created: 1 });
    expect(done.skipped).toEqual([{ sourceId: 'void', reason: 'invalid-name' }]);
    await expectMissing(ada, world, '   ');
  });

  it('removes only the Importer-owned Entities, leaving hand-authored ones intact', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };
    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    await pollUntilDone(ada, world);

    const chronicle = await makeEntity(ada, world, 'Chronicle');

    await ada.delete(`/worlds/${world}/importers/${STUB_ID}`).expect(204);

    await expectMissing(ada, world, 'Goblin');
    // The hand-authored Note is untouched — the delete is keyed by the provenance index alone.
    expect((await entityByName(ada, world, 'Chronicle')).id).toBe(chronicle);
    expect(db.select().from(entityImportSource).where(eq(entityImportSource.containerId, world)).all()).toHaveLength(0);
  });

  it('surfaces the last-known imported state on the list, off the provenance index (#260)', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);

    // Before any run the Importer owns nothing, so the field is omitted.
    const before = (await ada.get(`/worlds/${world}/importers`).expect(200)).body;
    expect(before.find((e: { id: string }) => e.id === STUB_ID).lastImported).toBeUndefined();

    production = { rev: 'rev-7', records: [record('goblin', 'Goblin'), record('spider', 'Spider')] };
    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    await pollUntilDone(ada, world);

    // The panel can now show "N Entities at rev-7" without an in-process job — it survives a restart.
    const after = (await ada.get(`/worlds/${world}/importers`).expect(200)).body;
    const entry = after.find((e: { id: string }) => e.id === STUB_ID);
    expect(entry.lastImported).toMatchObject({ entityCount: 2, rev: 'rev-7' });
    expect(entry.lastImported.updatedAt).toEqual(expect.any(Number));
  });

  it('strips a forged hexly.source on create — no provenance row, no unique-index 500', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };
    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    await pollUntilDone(ada, world);
    const goblin = await entityByName(ada, world, 'Goblin');

    // A hand-authored Note forging the goblin's exact stamp would collide on the `(world, importer,
    // sourceId)` unique index and 500 — unless the reserved key is stripped on the way in.
    const created = await ada
      .post('/entities')
      .send({
        name: 'Impostor',
        types: ['core.type.note'],
        worldId: world,
        document: {
          'core.field.content': emptyRichContent(),
          [HEXLY_SOURCE_KEY]: { importer: STUB_ID, sourceId: 'goblin', rev: 'forged' },
        },
      })
      .expect(201);

    // The stamp never persisted: the Impostor carries none, and the only provenance row is the goblin's.
    const detail = (await ada.get(`/entities/${created.body.id}`).expect(200)).body;
    expect(detail.document[HEXLY_SOURCE_KEY]).toBeUndefined();
    const rows = db.select().from(entityImportSource).where(eq(entityImportSource.containerId, world)).all();
    expect(rows).toEqual([expect.objectContaining({ entityId: goblin.id, sourceId: 'goblin' })]);
  });

  it("preserves an imported Entity's stamp across a user edit and ignores a tampered one", async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };
    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    await pollUntilDone(ada, world);
    const goblin = await entityByName(ada, world, 'Goblin');

    // Ada saves the goblin back with a tampered stamp; the edit strips it and restores the stored one,
    // so provenance is neither forged nor orphaned by an author's edit (ADR-0060).
    await ada
      .put(`/entities/${goblin.id}`)
      .send({
        version: goblin.detail.version,
        tags: [],
        document: {
          ...goblin.detail.document,
          [HEXLY_SOURCE_KEY]: { importer: STUB_ID, sourceId: 'goblin', rev: 'HACKED' },
        },
      })
      .expect(200);

    const after = (await ada.get(`/entities/${goblin.id}`).expect(200)).body;
    expect(after.document[HEXLY_SOURCE_KEY]).toEqual({ importer: STUB_ID, sourceId: 'goblin', rev: 'rev-1' });
    const rows = db.select().from(entityImportSource).where(eq(entityImportSource.entityId, goblin.id)).all();
    expect(rows).toEqual([expect.objectContaining({ sourceId: 'goblin', rev: 'rev-1' })]);
  });

  it('refuses a Remove while a run is in flight (409)', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    // Park the run inside produce, so it is still in flight when the DELETE arrives.
    gate = new Promise<void>(() => undefined);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };

    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    const removed = await ada.delete(`/worlds/${world}/importers/${STUB_ID}`).expect(409);
    expect(removed.body.code).toBe('import-running');
  });

  it('refuses a second run while one is in flight (409)', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    // Park the run inside produce, so it stays running while the second request arrives.
    gate = new Promise<void>(() => undefined);
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };

    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    const second = await ada
      .post(`/worlds/${world}/importers/${STUB_ID}/run`)
      .send({ visibility: 'private' })
      .expect(409);
    expect(second.body.code).toBe('import-running');
  });

  it('is pollable throughout: running while parked, succeeded once released', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    production = { rev: 'rev-1', records: [record('goblin', 'Goblin')] };

    await ada.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(202);
    const running = await ada.get(`/worlds/${world}/import/status`).expect(200);
    expect(running.body.status).toBe('running');

    release();
    const done = await pollUntilDone(ada, world);
    expect(done).toMatchObject({ status: 'succeeded', created: 1 });
  });

  it('404s an unknown Importer', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await ada.post(`/worlds/${world}/importers/nope.missing/run`).send({ visibility: 'private' }).expect(404);
    await ada.delete(`/worlds/${world}/importers/nope.missing`).expect(404);
  });

  it('rejects a non-owner: a Contributor is 403, a stranger 404', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const carol = await signIn('carol@hexly.test');
    const world = await makeWorld(ada);
    await ada.post(`/worlds/${world}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);

    // Reachable but not an Owner → 403 across the whole surface.
    await bob.get(`/worlds/${world}/importers`).expect(403);
    await bob.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(403);
    await bob.get(`/worlds/${world}/import/status`).expect(403);
    await bob.delete(`/worlds/${world}/importers/${STUB_ID}`).expect(403);

    // A stranger cannot reach the World at all → 404 (unreachable ≡ missing).
    await carol.get(`/worlds/${world}/importers`).expect(404);
    await carol.post(`/worlds/${world}/importers/${STUB_ID}/run`).send({ visibility: 'private' }).expect(404);
    await carol.get(`/worlds/${world}/import/status`).expect(404);
    await carol.delete(`/worlds/${world}/importers/${STUB_ID}`).expect(404);
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

  async function makeEntity(owner: Agent, worldId: string, name: string): Promise<string> {
    return (
      await owner
        .post('/entities')
        .send({ name, types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id;
  }

  /** Save `id`'s RichContent as prose holding one `entityLink` to `targetId`. */
  async function link(owner: Agent, id: string, targetId: string): Promise<void> {
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    await owner
      .put(`/entities/${id}`)
      .send({
        version: current.version,
        tags: [],
        document: {
          'core.field.content': tiptapContent({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'entityLink', attrs: { entityId: targetId } }] }],
          }),
        },
      })
      .expect(200);
  }

  async function entityByName(agent: Agent, worldId: string, name: string) {
    const list = await agent.get(`/entities?worldId=${worldId}`).expect(200);
    const summary = (list.body.items as { id: string; name: string }[]).find((e) => e.name === name);
    expect(summary, `no Entity named ${name}`).toBeDefined();
    const detail = (await agent.get(`/entities/${summary?.id}`).expect(200)).body;
    return { id: summary?.id as string, detail };
  }

  async function expectMissing(agent: Agent, worldId: string, name: string): Promise<void> {
    const list = await agent.get(`/entities?worldId=${worldId}`).expect(200);
    expect((list.body.items as { name: string }[]).some((e) => e.name === name)).toBe(false);
  }

  /** Follow a running run the way the Imports panel does, until it stops. */
  async function pollUntilDone(agent: Agent, worldId: string): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const { body } = await agent.get(`/worlds/${worldId}/import/status`).expect(200);
      if (body.status !== 'running') return body;
    }
    throw new Error('the import run never left the running state');
  }
});
