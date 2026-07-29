import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { unzipSync } from 'fflate';
import request from 'supertest';
import { EntityDocument, EntitySummary, HEXLY_SOURCE_KEY, LinkedEntity } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
import { DS_MONSTER, DS_STAT_BLOCK_KEY } from '@hexly/plugin-draw-steel';
import { createMonstersImporter, MONSTERS_IMPORTER_ID } from '@hexly/plugin-draw-steel/server';
import { fixtureFetchPort } from '@hexly/plugin-draw-steel/server/testing';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { EntitiesModule } from '../entities/entities.module';
import { compendiumByImporter } from './compendiums';
import { ImporterRegistry } from './importer-registry';
import { WorldsModule } from './worlds.module';

/**
 * **Adoption** (#403, ADR-0079): `POST /entities/:id/adopt` copies a **Compendium Entry** into a World as
 * an ordinary, editable Entity — the one way compendium content enters a world.
 *
 * Driven against the *real* Draw Steel pack, installed through the ordinary import endpoint with its
 * fetch port backed by the committed fixtures, so the entry being adopted carries a real `hexly.source`
 * stamp, a real provenance row and a real stat block. A hand-seeded Container would prove the copy has
 * no stamp by never having minted one — which is the whole condition this ticket rests on.
 *
 * Asserted at the HTTP seam throughout: what makes an adopted copy a citizen is that every ordinary read
 * a user meets returns it, and only the endpoints show that.
 */
describe('Adoption', () => {
  let app: INestApplication;
  let db: Db;
  let adaId: string;
  let bobId: string;

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

    adaId = await seed('ada@hexly.test', 'Ada');
    bobId = await seed('bob@hexly.test', 'Bob');
  });

  afterEach(async () => {
    await app.close();
  });

  it('copies the entry into the World the request names, verbatim and unstamped', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);
    const goblin = await entityByName(ada, pack(), 'Goblin Warrior');

    const copy = (await ada.post(`/entities/${goblin.id}/adopt`).send({ worldId: world }).expect(201)).body;

    // A distinct Entity in the target World, not the entry with its Container moved.
    expect(copy.id).not.toBe(goblin.id);
    expect(copy.worldId).toBe(world);
    // Same name verbatim — no `(copy)` suffix — same Types, same field values: a starting point, not a
    // form to refill. The stat block is compared whole, so a lossy copy is loud.
    expect(copy.name).toBe('Goblin Warrior');
    expect(copy.types).toEqual([DS_MONSTER]);
    expect(copy.document[DS_STAT_BLOCK_KEY]).toEqual(goblin.detail.document[DS_STAT_BLOCK_KEY]);
    // No record of origin. The correctness condition, not cosmetics: a copy keeping the stamp would read
    // as Sealed *and* be a delete candidate on the next reconcile through its colliding `sourceId`.
    expect(goblin.detail.document[HEXLY_SOURCE_KEY]).toBeDefined(); // the entry really is stamped
    expect(copy.document[HEXLY_SOURCE_KEY]).toBeUndefined();
    expect(Object.keys(copy.document).filter((key) => key.startsWith('hexly.'))).toEqual([]);
    // `private` and the adopter's, like anything else they create.
    expect(copy.visibility).toBe('private');
    expect((await ada.get(`/entities/${copy.id}/owners`).expect(200)).body).toEqual([adaId]);

    // And nothing about it is sealed: it is in a World, so it is an ordinary Entity with ordinary Rights.
    const reloaded = (await ada.get(`/entities/${copy.id}`).expect(200)).body;
    expect(reloaded.sealed).toBeUndefined();
    expect(reloaded.rights).toEqual(['read', 'edit', 'delete', 'set-visibility', 'manage']);
  });

  it('hands the adopter a full citizen of their World', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);
    const goblin = await entityByName(ada, pack(), 'Goblin Warrior');
    const copy = (await ada.post(`/entities/${goblin.id}/adopt`).send({ worldId: world }).expect(201)).body;

    // Editable — reskinning the goblin is the whole point (story 22). Substance, name and exposure all.
    await ada
      .put(`/entities/${copy.id}`)
      .send({ document: { ...copy.document, note: 'mine now' }, version: copy.version, tags: ['reskinned'] })
      .expect(200);
    await ada.patch(`/entities/${copy.id}`).send({ name: 'Grix the Turncoat' }).expect(200);
    await ada.patch(`/entities/${copy.id}`).send({ visibility: 'shared' }).expect(200);

    // In the Entity Browser, where the author's own work lives...
    expect(await names(ada, `worldId=${world}`)).toEqual(['Grix the Turncoat']);
    // ...offered by every link-target read, which is the `@` picker, the Entity Link Field picker and the
    // Board Embed picker at once (ADR-0079): the copy is in a World, so `NOT inACompendium()` passes.
    expect(await names(ada, `worldId=${world}&q=grix&read=link-target`)).toEqual(['Grix the Turncoat']);
    // ...in the World Graph...
    const graph = (await ada.get(`/worlds/${world}/graph`).expect(200)).body;
    expect((graph.nodes as LinkedEntity[]).map((node) => node.id)).toEqual([copy.id]);
    // ...in the World's Entity count...
    expect((await ada.get(`/worlds/${world}`).expect(200)).body.entityCount).toBe(1);
    // ...and in the World's Vault export, which the entry itself could never appear in.
    expect(await exportedFiles(ada, world)).toContain('Grix the Turncoat.md');
  });

  it('asks only for the right to create Entities, so a Contributor may adopt', async () => {
    const ada = await signIn('ada@hexly.test');
    const bob = await signIn('bob@hexly.test');
    const world = await makeWorld(ada);
    await ada.post(`/worlds/${world}/members`).send({ userId: bobId, role: 'contributor' }).expect(200);
    await runImport(ada, world);
    const goblin = await entityByName(ada, pack(), 'Goblin Warrior');

    const copy = (await bob.post(`/entities/${goblin.id}/adopt`).send({ worldId: world }).expect(201)).body;

    // Bob owns no World and holds nothing on the shelf; contributing is the whole of his standing.
    expect(copy.worldId).toBe(world);
    expect((await bob.get(`/entities/${copy.id}/owners`).expect(200)).body).toEqual([bobId]);
    // A Viewer may not: the create seam's own gate is what says so, with no rule of adoption's own.
    const carolId = await seed('carol@hexly.test', 'Carol');
    await ada.post(`/worlds/${world}/members`).send({ userId: carolId, role: 'viewer' }).expect(200);
    await (await signIn('carol@hexly.test')).post(`/entities/${goblin.id}/adopt`).send({ worldId: world }).expect(404);
  });

  it('adopts twice when asked twice, knowingly', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);
    const goblin = await entityByName(ada, pack(), 'Goblin Warrior');

    const first = (await ada.post(`/entities/${goblin.id}/adopt`).send({ worldId: world }).expect(201)).body;
    const second = (await ada.post(`/entities/${goblin.id}/adopt`).send({ worldId: world }).expect(201)).body;

    // Two variants of a goblin are allowed and the app does not second-guess it (ADR-0079). There is no
    // "already adopted" indicator, so nothing about the second ask differs from the first.
    expect(second.id).not.toBe(first.id);
    expect(await names(ada, `worldId=${world}`)).toEqual(['Goblin Warrior', 'Goblin Warrior']);
  });

  it('leaves the entry, and everything already pointing at it, exactly where they were', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);
    const goblin = await entityByName(ada, pack(), 'Goblin Warrior');
    // A link forged directly against a known id — ADR-0079 accepts these rather than gating a write on
    // what its prose links. It is the case an adoption must be shown not to rewrite.
    const note = await makeEntity(ada, world, 'Goblin Warren');
    await linkTo(ada, note, goblin.id);

    await ada.post(`/entities/${goblin.id}/adopt`).send({ worldId: world }).expect(201);

    // Inbound links are never repointed: nothing silently rewrites a document the user did not touch.
    const stored = (await ada.get(`/entities/${note}`).expect(200)).body;
    expect(JSON.stringify(stored.document)).toContain(goblin.id);
    // And the entry is untouched — still on the shelf, still sealed, still read-only.
    const entry = (await ada.get(`/entities/${goblin.id}`).expect(200)).body;
    expect(entry).toMatchObject({ name: 'Goblin Warrior', worldId: pack(), sealed: true });
    expect(entry.rights).toEqual(['read']);
    expect(entry.document).toEqual(goblin.detail.document);
  });

  it('survives the pack being removed, because it has nothing tying it to one', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);
    const packId = pack();
    const goblin = await entityByName(ada, packId, 'Goblin Warrior');
    const copy = (await ada.post(`/entities/${goblin.id}/adopt`).send({ worldId: world }).expect(201)).body;

    await ada.delete(`/worlds/${world}/importers/${MONSTERS_IMPORTER_ID}`).expect(204);

    // The removal works off the provenance index, and the copy carries no `hexly.source` row to be found
    // by — so uninstalling Draw Steel cannot gut a dungeon. Free, given the strip; verified, not built for.
    expect((await ada.get(`/entities?worldId=${packId}`).expect(200)).body.items).toEqual([]);
    expect((await ada.get(`/entities/${copy.id}`).expect(200)).body).toMatchObject({ name: 'Goblin Warrior' });
    expect(await names(ada, `worldId=${world}`)).toEqual(['Goblin Warrior']);
  });

  it('can only ever land in a World, and only from the shelf', async () => {
    const ada = await signIn('ada@hexly.test');
    const world = await makeWorld(ada);
    await runImport(ada, world);
    const goblin = await entityByName(ada, pack(), 'Goblin Warrior');

    // A Compendium is no one's adoption target: the create seam resolves from `worlds`, and a Compendium
    // has no World satellite — so the shelf cannot be written into by this door either.
    await ada.post(`/entities/${goblin.id}/adopt`).send({ worldId: pack() }).expect(404);
    // Nor is a World the caller cannot author in reachable as one.
    const bobsWorld = await makeWorld(await signIn('bob@hexly.test'), 'Elsewhere');
    await ada.post(`/entities/${goblin.id}/adopt`).send({ worldId: bobsWorld }).expect(404);

    // Adoption is defined on a Compendium Entry alone; an ordinary Entity is not a thing to adopt.
    const mine = await makeEntity(ada, world, 'Grix the Turncoat');
    await ada.post(`/entities/${mine}/adopt`).send({ worldId: world }).expect(400);
    // An unreachable id never leaks its existence, adoption included.
    await ada.post(`/entities/${'00000000-0000-0000-0000-000000000000'}/adopt`).send({ worldId: world }).expect(404);
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

  async function makeWorld(owner: Agent, name = 'Aldermoor'): Promise<string> {
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

  /** Run the pack over the committed fixtures — no network — and wait for the reconcile to finish. */
  async function runImport(agent: Agent, worldId: string): Promise<void> {
    app.get(ImporterRegistry).register(createMonstersImporter(fixtureFetchPort()));
    await agent
      .post(`/worlds/${worldId}/importers/${MONSTERS_IMPORTER_ID}/run`)
      .send({ visibility: 'private' })
      .expect(202);
    for (let attempt = 0; attempt < 50; attempt++) {
      const { body } = await agent.get(`/worlds/${worldId}/import/status`).expect(200);
      if (body.status !== 'running') {
        expect(body, `the import run did not succeed: ${JSON.stringify(body)}`).toMatchObject({
          status: 'succeeded',
        });
        return;
      }
    }
    throw new Error('the import run never left the running state');
  }

  /** The installed Compendium's Container id — where the entries live, and no World's. */
  function pack(): string {
    const row = compendiumByImporter(db, MONSTERS_IMPORTER_ID);
    expect(row, 'no Compendium was installed').toBeDefined();
    return (row as NonNullable<typeof row>).id;
  }

  async function entityByName(agent: Agent, containerId: string, name: string) {
    const list = await agent.get(`/entities?worldId=${containerId}`).expect(200);
    const summary = (list.body.items as EntitySummary[]).find((entity) => entity.name === name);
    expect(summary, `no Entity named ${name}`).toBeDefined();
    const id = (summary as EntitySummary).id;
    return { id, detail: (await agent.get(`/entities/${id}`).expect(200)).body };
  }

  /** Save `id`'s Content as prose holding one Entity Link at `targetId`. */
  async function linkTo(owner: Agent, id: string, targetId: string): Promise<void> {
    const current = (await owner.get(`/entities/${id}`).expect(200)).body;
    const document: EntityDocument = {
      'core.field.content': tiptapContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'entityLink', attrs: { entityId: targetId, descriptor: 'lairs in' } }],
          },
        ],
      }),
    };
    await owner.put(`/entities/${id}`).send({ document, version: current.version, tags: [] }).expect(200);
  }

  /** The result set by name, sorted here: what these tests are about is *which* Entities a read reaches. */
  async function names(agent: Agent, query: string): Promise<string[]> {
    const list = await agent.get(`/entities?${query}`).expect(200);
    return (list.body.items as EntitySummary[]).map((entity) => entity.name).sort();
  }

  async function exportedFiles(agent: Agent, worldId: string): Promise<string[]> {
    const res = await agent.get(`/worlds/${worldId}/export`).responseType('blob').expect(200);
    return Object.keys(unzipSync(new Uint8Array(res.body)));
  }
});
