import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { EntitySummary, Mount, WorldDetail } from '@hexly/domain';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { EntitiesModule } from '../entities/entities.module';
import { CompendiumWrites } from './compendium-writes';
import { WorldsModule } from './worlds.module';

/**
 * A World declares the Containers it draws from (#408, ADR-0080). Asserted at the HTTP seam
 * throughout, as the Adoption spec establishes: what makes a Mount a Mount is what a caller may
 * declare and what they are refused, and a service-shaped test would prove neither.
 *
 * Nothing reads a Mount yet — this ticket is the declaration and the surface that makes it — so the
 * last case here is the one that matters most: every reading surface answers exactly as it did before,
 * mounted or not.
 */
describe('A World’s Mounts', () => {
  let app: INestApplication;
  let db: Db;

  /** Ada owns the campaign she configures and the shelf she draws from; Bob owns his own World. */
  let adaId: string;
  let bobId: string;
  let campaign: string;
  let shelf: string;
  let bobWorld: string;
  /** One installed pack — Instance-wide, so any World Owner may mount it (ADR-0079). */
  let pack: string;

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
    // Listen for real: supertest otherwise churns an ephemeral port per request.
    await app.listen(0);

    adaId = await seed('ada@hexly.test', 'Ada');
    bobId = await seed('bob@hexly.test', 'Bob');

    const ada = await signIn('ada@hexly.test');
    campaign = await mintWorld(ada, 'Aldermoor');
    shelf = await mintWorld(ada, 'The Art Shelf');
    bobWorld = await mintWorld(await signIn('bob@hexly.test'), 'Bob’s Barrow');
    pack = app.get(CompendiumWrites).install('draw-steel.importer.monsters', { name: 'Draw Steel: Monsters' }, '1.4.0');
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists what this World draws from, in the order its Owner set, each named and kinded', async () => {
    const ada = await signIn('ada@hexly.test');
    expect(await mountsOf(ada, campaign)).toEqual([]);

    await mount(ada, campaign, shelf);
    await mount(ada, campaign, pack);

    // Each Mount names its Container and which kind it is — "my other World" and "an installed pack"
    // do not read the same to the Owner arranging them.
    expect(await mountsOf(ada, campaign)).toEqual([
      { containerId: shelf, name: 'The Art Shelf', kind: 'world' },
      { containerId: pack, name: 'Draw Steel: Monsters', kind: 'compendium' },
    ]);
  });

  it('offers every installed pack and every World the caller Owns, and never one they merely read', async () => {
    // Bob adds Ada to his World as a Viewer: she can reach it, and that is expressly not enough.
    const bob = await signIn('bob@hexly.test');
    await bob.post(`/worlds/${bobWorld}/members`).send({ userId: adaId, role: 'viewer' }).expect(200);

    const ada = await signIn('ada@hexly.test');
    expect(await candidates(ada, campaign)).toEqual([
      { containerId: pack, name: 'Draw Steel: Monsters', kind: 'compendium' },
      { containerId: shelf, name: 'The Art Shelf', kind: 'world' },
    ]);
    // Reachable is not Ownable: Bob's World is hers to read and never hers to republish (ADR-0080).
    expect((await candidates(ada, campaign)).map((c) => c.containerId)).not.toContain(bobWorld);
    // Nor is the World itself on offer — it already holds its own Entities.
    expect((await candidates(ada, campaign)).map((c) => c.containerId)).not.toContain(campaign);

    // What is already mounted drops off the offer rather than being offered twice.
    await mount(ada, campaign, shelf);
    expect(await candidates(ada, campaign)).toEqual([
      { containerId: pack, name: 'Draw Steel: Monsters', kind: 'compendium' },
    ]);
  });

  it('refuses a Container the caller does not Own, and accepts a Compendium from any World Owner', async () => {
    const bob = await signIn('bob@hexly.test');
    await bob.post(`/worlds/${bobWorld}/members`).send({ userId: adaId, role: 'viewer' }).expect(200);

    const ada = await signIn('ada@hexly.test');
    // Viewer on the mounted side: refused, and told so — she can see it exists, so hiding it would lie.
    await ada.post(`/worlds/${campaign}/mounts`).send({ containerId: bobWorld }).expect(403);
    // A World she cannot reach at all is indistinguishable from one that is not there (ADR-0004).
    const hidden = await mintWorld(bob, 'The Hidden Vale');
    await ada.post(`/worlds/${campaign}/mounts`).send({ containerId: hidden }).expect(404);
    // A World cannot mount itself.
    await ada.post(`/worlds/${campaign}/mounts`).send({ containerId: campaign }).expect(403);

    // Mounting *into* a World she does not Own is refused on the other side of the same rule.
    await ada.post(`/worlds/${bobWorld}/mounts`).send({ containerId: shelf }).expect(403);

    // A pack is Instance-wide and already readable by every signed-in caller, so mounting one grants
    // nothing new and any World Owner may (ADR-0079).
    await mount(bob, bobWorld, pack);
    expect(await mountsOf(bob, bobWorld)).toEqual([
      { containerId: pack, name: 'Draw Steel: Monsters', kind: 'compendium' },
    ]);
  });

  it('mounting what is already mounted is the same Mount, not a second one', async () => {
    const ada = await signIn('ada@hexly.test');
    await mount(ada, campaign, shelf);
    const seq = (await worldDetail(ada, campaign)).seq;

    expect(await mount(ada, campaign, shelf)).toEqual([{ containerId: shelf, name: 'The Art Shelf', kind: 'world' }]);
    // Nothing changed, so nothing was announced: a re-declared Mount does not wake the World's followers.
    expect((await worldDetail(ada, campaign)).seq).toBe(seq);
  });

  it('survives a reorder as the same Mount, and refuses a reorder that is not one', async () => {
    const ada = await signIn('ada@hexly.test');
    await mount(ada, campaign, shelf);
    await mount(ada, campaign, pack);

    expect(await reorder(ada, campaign, [pack, shelf])).toEqual([
      { containerId: pack, name: 'Draw Steel: Monsters', kind: 'compendium' },
      { containerId: shelf, name: 'The Art Shelf', kind: 'world' },
    ]);
    // Read back cold: the order is stored, not an artefact of the response.
    expect((await mountsOf(ada, campaign)).map((m) => m.containerId)).toEqual([pack, shelf]);

    // An order that is already the order changed nothing, so it announces nothing — the same restraint
    // a re-declared Mount shows.
    const seq = (await worldDetail(ada, campaign)).seq;
    await reorder(ada, campaign, [pack, shelf]);
    expect((await worldDetail(ada, campaign)).seq).toBe(seq);

    // A reorder reorders. Dropping one, or naming one that is not mounted, is refused — otherwise this
    // would be a second, ungated way to declare a Mount.
    await ada
      .patch(`/worlds/${campaign}/mounts`)
      .send({ containerIds: [pack] })
      .expect(400);
    await ada
      .patch(`/worlds/${campaign}/mounts`)
      .send({ containerIds: [pack, shelf, bobWorld] })
      .expect(400);
    expect((await mountsOf(ada, campaign)).map((m) => m.containerId)).toEqual([pack, shelf]);
  });

  it('unmounts one Container and nothing else', async () => {
    const ada = await signIn('ada@hexly.test');
    await mount(ada, campaign, shelf);
    await mount(ada, campaign, pack);

    expect((await ada.delete(`/worlds/${campaign}/mounts/${shelf}`).expect(200)).body).toEqual([
      { containerId: pack, name: 'Draw Steel: Monsters', kind: 'compendium' },
    ]);
    // The Container itself is untouched — unmounting is a declaration withdrawn, not a deletion.
    await ada.get(`/worlds/${shelf}`).expect(200);
    // Unmounting what is not mounted is a 404, never a silent success.
    await ada.delete(`/worlds/${campaign}/mounts/${shelf}`).expect(404);
  });

  it('drops the Mount with either Container', async () => {
    const ada = await signIn('ada@hexly.test');
    await mount(ada, campaign, shelf);
    await mount(ada, campaign, pack);

    // The mounted side: deleting the World, and uninstalling the pack, each take their Mount with them.
    await ada.delete(`/worlds/${shelf}`).expect(204);
    expect((await mountsOf(ada, campaign)).map((m) => m.containerId)).toEqual([pack]);
    app.get(CompendiumWrites).uninstall(pack);
    expect(await mountsOf(ada, campaign)).toEqual([]);

    // The mounting side: a World with Mounts deletes cleanly rather than tripping the foreign key, and
    // what it drew from survives it.
    const second = await mintWorld(ada, 'Second Campaign');
    const otherShelf = await mintWorld(ada, 'The Music Shelf');
    await mount(ada, second, otherShelf);
    await ada.delete(`/worlds/${second}`).expect(204);
    await ada.get(`/worlds/${otherShelf}`).expect(200);
  });

  it('offers a Compendium no Mount list of its own, and cannot be made to mount', async () => {
    const ada = await signIn('ada@hexly.test');
    // Every route resolves its mounting Container through `worlds`, so a Compendium is simply not one.
    await ada.get(`/worlds/${pack}/mounts`).expect(404);
    await ada.get(`/worlds/${pack}/mount-candidates`).expect(404);
    await ada.post(`/worlds/${pack}/mounts`).send({ containerId: shelf }).expect(404);
    await ada.patch(`/worlds/${pack}/mounts`).send({ containerIds: [] }).expect(404);
    await ada.delete(`/worlds/${pack}/mounts/${shelf}`).expect(404);
  });

  it('is the World Owner’s alone to see and to set', async () => {
    const ada = await signIn('ada@hexly.test');
    await ada.post(`/worlds/${campaign}/members`).send({ userId: bobId, role: 'viewer' });

    const bob = await signIn('bob@hexly.test');
    // Reachable but not an Owner: 403, so the refusal is honest rather than pretending it is missing.
    await bob.get(`/worlds/${campaign}/mounts`).expect(403);
    await bob.get(`/worlds/${campaign}/mount-candidates`).expect(403);
    await bob.post(`/worlds/${campaign}/mounts`).send({ containerId: pack }).expect(403);
    // Unreachable is 404 all the way down.
    const cara = await seed('cara@hexly.test', 'Cara');
    expect(cara).toBeTruthy();
    await (await signIn('cara@hexly.test')).get(`/worlds/${campaign}/mounts`).expect(404);
  });

  it('leaves every reading surface answering exactly as it did before', async () => {
    const ada = await signIn('ada@hexly.test');
    const tavern = (
      await ada
        .post('/entities')
        .send({ name: 'The Tavern', types: ['core.type.note'], worldId: campaign })
        .expect(201)
    ).body.id;
    // `shared`, so a World Viewer of the campaign has something to see and the last assertion is about
    // the Mount rather than about visibility.
    await ada.patch(`/entities/${tavern}`).send({ visibility: 'shared' }).expect(200);
    await ada
      .post('/entities')
      .send({ name: 'Sunset over Aldermoor', types: ['core.type.note'], worldId: shelf })
      .expect(201);

    const before = {
      browser: await names(ada, `worldId=${campaign}`),
      detail: await worldDetail(ada, campaign),
      graph: (await ada.get(`/worlds/${campaign}/graph`).expect(200)).body,
      facets: (await ada.get(`/entities/facets?worldId=${campaign}`).expect(200)).body,
    };

    await mount(ada, campaign, shelf);
    await mount(ada, campaign, pack);

    // A Mount widens what a World may *point at*, never what it *holds* (ADR-0080): the Entity Browser,
    // the counts, the Facets and the World Graph are all container-scoped and all say what they said.
    expect(await names(ada, `worldId=${campaign}`)).toEqual(before.browser);
    expect((await worldDetail(ada, campaign)).entityCount).toBe(before.detail.entityCount);
    expect((await ada.get(`/worlds/${campaign}/graph`).expect(200)).body).toEqual(before.graph);
    expect((await ada.get(`/entities/facets?worldId=${campaign}`).expect(200)).body).toEqual(before.facets);
    // Declaring a Mount *is* World configuration, though, so its followers are told to refetch — the
    // `seq` bump membership uses, and for the same reason `updatedAt` deliberately stays put.
    const after = await worldDetail(ada, campaign);
    expect(after.seq).toBeGreaterThan(before.detail.seq);
    expect(after.updatedAt).toBe(before.detail.updatedAt);

    // And no read cascades yet: a Viewer of the mounting World still cannot reach what it draws from.
    await ada.post(`/worlds/${campaign}/members`).send({ userId: bobId, role: 'viewer' });
    const bob = await signIn('bob@hexly.test');
    expect(await names(bob, `worldId=${campaign}`)).toEqual(['The Tavern']);
    await bob.get(`/worlds/${shelf}`).expect(404);
    expect(await names(bob, `worldId=${shelf}`)).toEqual([]);
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

  async function mintWorld(agent: Agent, name: string): Promise<string> {
    return (await agent.post('/worlds').send({ name }).expect(201)).body.id;
  }

  async function worldDetail(agent: Agent, id: string): Promise<WorldDetail> {
    return (await agent.get(`/worlds/${id}`).expect(200)).body;
  }

  async function mountsOf(agent: Agent, id: string): Promise<Mount[]> {
    return (await agent.get(`/worlds/${id}/mounts`).expect(200)).body;
  }

  async function candidates(agent: Agent, id: string): Promise<Mount[]> {
    return (await agent.get(`/worlds/${id}/mount-candidates`).expect(200)).body;
  }

  async function mount(agent: Agent, id: string, containerId: string): Promise<Mount[]> {
    return (await agent.post(`/worlds/${id}/mounts`).send({ containerId }).expect(200)).body;
  }

  async function reorder(agent: Agent, id: string, containerIds: string[]): Promise<Mount[]> {
    return (await agent.patch(`/worlds/${id}/mounts`).send({ containerIds }).expect(200)).body;
  }

  /** The Entity Browser's answer for a scope, by name — what a Mount must leave exactly as it was. */
  async function names(agent: Agent, query: string): Promise<string[]> {
    const items: EntitySummary[] = (await agent.get(`/entities?${query}`).expect(200)).body.items;
    return items.map((e) => e.name).sort();
  }
});
