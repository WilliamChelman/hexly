import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { EntityFacets, EntityReferences, EntitySummary, FacetCount } from '@hexly/domain';
import { tiptapContent } from '@hexly/plugin-content';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { ConfigModule } from '../config/config.module';
import { DB, Db, createDb } from '../db/db';
import { EntitiesModule } from '../entities/entities.module';
import { EntitiesService } from '../entities/entities.service';
import { CompendiumWrites } from '../worlds/compendium-writes';
import { WorldsModule } from '../worlds/worlds.module';

/**
 * Every link picker offers what the World **Mounts** (#411, ADR-0080). The `@` mention picker, the
 * **Entity Link** Field picker and the Board **Embed** picker ask one question — *what may this point
 * at?* — through one read, so the widening is asserted once, here, at the read they share: a link
 * target must be in the linking Container or one it Mounts.
 *
 * Driven through `GET /entities` and `GET /entities/facets` for the same reason #400's line is: the
 * scope *is* the read's behaviour, and there is no flag on a row to inspect instead.
 *
 * The cast is ADR-0080's: Ada owns the campaign, the shelf it draws from and every Mount declared
 * here; Bob plays in the campaign and is where the widening meets the cascade it rides.
 */
describe('Every link picker offers what the World Mounts', () => {
  let app: INestApplication;
  let db: Db;

  let adaId: string;
  let bobId: string;
  /** Ada's campaign, the Shelf it draws on, and one installed pack. */
  let campaign: string;
  let shelf: string;
  let pack: string;

  /** Two Goblin Kings answering to one name — the campaign's own, and the shelf's. */
  let ownGoblin: string;
  let shelfGoblin: string;
  /** The shelf's `shared` painting, and Ada's `private` sketch beside it. */
  let sunset: string;
  let sketch: string;
  /** One **Compendium Entry**, sealed by where it lives. */
  let entry: string;

  let ada: Awaited<ReturnType<typeof signIn>>;

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

    ada = await signIn('ada@hexly.test');
    campaign = await mintWorld('Aldermoor');
    shelf = await mintWorld('The Art Shelf');
    await ada.post(`/worlds/${campaign}/members`).send({ userId: bobId, role: 'viewer' }).expect(200);

    // A long note against a one-word name, so bm25 — which rewards a short document — would put the
    // shelf's Goblin King first on its own. That makes the ranking assertion about the tier, not the fixture.
    ownGoblin = await mintEntity(
      campaign,
      'Goblin King',
      'The tunnels run for miles beneath the hills, and the tribe that dug them has held the lower galleries for six generations without once coming up for air.',
    );
    await share(ownGoblin);
    shelfGoblin = await mintEntity(shelf, 'Goblin King');
    await share(shelfGoblin);
    sunset = await mintEntity(shelf, 'Sunset over Aldermoor');
    await share(sunset);
    sketch = await mintEntity(shelf, 'Rough Sketch');

    pack = app.get(CompendiumWrites).install('draw-steel.importer.monsters', { name: 'Draw Steel: Monsters' }, '1.4.0');
    entry = seedEntry('Goblin Warrior');
  });

  afterEach(async () => {
    await app.close();
  });

  it('offers a mounted shelf’s Entities beside the World’s own, and neither of them unmounted', async () => {
    // Unmounted, the shelf is not among the answers at all — the sealed model, which an empty Mount
    // set reproduces exactly (ADR-0079, ADR-0080).
    expect(await offeredIds(ada, `worldId=${campaign}`)).toEqual([ownGoblin]);

    await mount(campaign, shelf);

    // Mounted, its Entities are offered inline — not behind a scope switch, which would make the user
    // choose a haystack before searching it — and behind the World's own, whatever the shelf's recency says.
    const offers = await offeredIds(ada, `worldId=${campaign}`);
    expect(offers[0]).toBe(ownGoblin);
    expect(offers.slice(1).sort()).toEqual([shelfGoblin, sketch, sunset].sort());

    // Unmounting withdraws the offer with the declaration.
    await unmount(campaign, shelf);
    expect(await offeredIds(ada, `worldId=${campaign}`)).toEqual([ownGoblin]);
  });

  it('ranks the World’s own Entity above the mounted one at equal relevance', async () => {
    await mount(campaign, shelf);

    // Both match "goblin king" on the name field, and the shelf's is the shorter document: the tier,
    // not bm25, decides that your own goblin king comes before the shelf's.
    expect(await offeredIds(ada, `worldId=${campaign}&q=goblin king`)).toEqual([ownGoblin, shelfGoblin]);
  });

  it('offers a mounted Compendium’s entries, and never an unmounted one’s', async () => {
    // Unmounted: the seal's no-link half, exactly as #400 drew it.
    expect(await offered(ada, `worldId=${campaign}&q=goblin`)).toEqual(['Goblin King']);

    await mount(campaign, pack);

    // Mounted, a pack's entries are things this World may point at — the half of the seal that is now
    // the Mount scope, a property of the pointing World rather than of the entry (ADR-0080).
    expect(await offered(ada, `worldId=${campaign}&q=goblin`)).toEqual(['Goblin King', 'Goblin Warrior']);
    // ...and it is still sealed where sealing means *writing*: mounting unseals nothing.
    await ada.patch(`/entities/${entry}`).send({ name: 'Goblin Champion' }).expect(403);

    // A read that names no Container has no Mount set to resolve, so it stays sealed whatever is
    // mounted anywhere (#400) — the `@` picker carries a World, and the rule must not *depend* on it.
    expect(await offered(ada, `q=goblin`)).not.toContain('Goblin Warrior');
    // The navigation read is untouched throughout: half a remembered name still reaches the entry.
    expect(await names(ada, `q=goblin`)).toEqual(['Goblin King', 'Goblin King', 'Goblin Warrior']);
  });

  it('narrows to one mounted Container through the Container facet, counting what it lists', async () => {
    await mount(campaign, shelf);
    await mount(campaign, pack);

    // The facet a widened read grows: one row per Container still holding an answer, labelled with the
    // Container's own name — so the rail reads "The Art Shelf", not a uuid — the World's own first,
    // then the Mounts in the Owner's order (ADR-0080), as the Library reads them.
    expect(await containerFacet(ada, `worldId=${campaign}&q=goblin`)).toEqual([
      { value: campaign, label: 'Aldermoor', count: 1 },
      { value: shelf, label: 'The Art Shelf', count: 1 },
      { value: pack, label: 'Draw Steel: Monsters', count: 1 },
    ]);

    // Selecting one narrows the list to that Container — one pack, or one shelf — and the count it was
    // annotated with is the number of rows it narrows to, because both come off the same predicates.
    expect(await offered(ada, `worldId=${campaign}&q=goblin&container=${shelf}`)).toEqual(['Goblin King']);
    expect(await offered(ada, `worldId=${campaign}&q=goblin&container=${pack}`)).toEqual(['Goblin Warrior']);
    // A Container the scope does not reach is reachable by naming it no more than it was: both AND.
    expect(await offered(ada, `worldId=${shelf}&q=goblin&container=${pack}`)).toEqual([]);

    // A World that Mounts nothing spans one Container, so there is nothing to narrow and no category.
    expect(await containerFacet(ada, `worldId=${shelf}&q=goblin`)).toBeUndefined();
  });

  it('offers a mounted Entity to a player of the mounting World, on the terms the cascade grants', async () => {
    const bob = await signIn('bob@hexly.test');
    await mount(campaign, shelf);

    // The widening rides the read cascade (#410) rather than replacing it: Bob may point at what the
    // shelf publishes, and Ada's `private` sketch is no more offered to him than it is readable.
    const offers = await offeredIds(bob, `worldId=${campaign}`);
    expect(offers[0]).toBe(ownGoblin);
    expect(offers.slice(1).sort()).toEqual([shelfGoblin, sunset].sort());
    await bob.get(`/entities/${sketch}`).expect(404);
  });

  it('mints a working link to a mounted Entity, resolvable where it is used', async () => {
    await mount(campaign, shelf);
    const note = await mintEntity(campaign, 'The Tavern');

    // Pointing at what the picker offered: the link is minted straight against the id, and the write
    // takes it — the Mount scope is a scope on discovery, never a gate at the write (ADR-0079/0080).
    await ada
      .put(`/entities/${note}`)
      .send({
        document: {
          'core.field.content': tiptapContent({
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'entityLink', attrs: { entityId: sunset, label: 'Sunset' } }] },
            ],
          }),
        },
        version: 1,
        tags: [],
      })
      .expect(200);

    // And it renders where it is used: an id resolution is a navigation read, so the target resolves
    // to its live name across the Container boundary.
    expect(await names(ada, `ids=${sunset}`)).toEqual(['Sunset over Aldermoor']);
    // The edge is an ordinary one in both directions — and backlinks cross the boundary (ADR-0080),
    // which is the surface that answers "may I take this off the shelf?".
    const outbound: EntityReferences = (await ada.get(`/entities/${note}/references`).expect(200)).body;
    expect(outbound.references.map((r) => r.target?.name)).toEqual(['Sunset over Aldermoor']);
    const inbound: EntityReferences = (await ada.get(`/entities/${sunset}/references`).expect(200)).body;
    expect(inbound.referencedBy.map((r) => r.source.name)).toEqual(['The Tavern']);
  });

  it('widens what the World points at and nothing about what it holds', async () => {
    await mount(campaign, shelf);
    await mount(campaign, pack);

    // Every container-scoped reading is untouched (ADR-0080): the Entity Browser lists what this World
    // holds, and a Mount adds nothing to it.
    expect(await names(ada, `worldId=${campaign}`)).toEqual(['Goblin King']);
    expect((await facets(ada, `worldId=${campaign}`)).type).toEqual([{ value: 'core.type.note', count: 1 }]);
    // Nor does it move the World a mounted Entity belongs to.
    expect(
      (await summaries(ada, `worldId=${campaign}&read=link-target`)).find((e) => e.id === shelfGoblin)?.worldId,
    ).toBe(shelf);
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

  async function mintWorld(name: string): Promise<string> {
    return (await ada.post('/worlds').send({ name }).expect(201)).body.id;
  }

  /** An Entity, optionally carrying a line of prose so full-text has something to weigh. */
  async function mintEntity(worldId: string, name: string, prose?: string): Promise<string> {
    const id = (
      await ada
        .post('/entities')
        .send({ name, types: ['core.type.note'], worldId })
        .expect(201)
    ).body.id as string;
    if (prose) {
      await ada
        .put(`/entities/${id}`)
        .send({
          document: {
            'core.field.content': tiptapContent({
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: prose }] }],
            }),
          },
          version: 1,
          tags: [],
        })
        .expect(200);
    }
    return id;
  }

  async function share(id: string): Promise<void> {
    await ada.patch(`/entities/${id}`).send({ visibility: 'shared' }).expect(200);
  }

  /** One entry on the pack, landed the way a reconcile lands one: the system insert, with an owner grant. */
  function seedEntry(name: string): string {
    const id = randomUUID();
    app.get(EntitiesService).importEntity({
      ownerId: adaId,
      containerId: pack,
      id,
      name,
      types: ['core.type.note'],
      tags: [],
      document: {},
    });
    return id;
  }

  async function mount(worldId: string, containerId: string): Promise<void> {
    await ada.post(`/worlds/${worldId}/mounts`).send({ containerId }).expect(200);
  }

  async function unmount(worldId: string, containerId: string): Promise<void> {
    await ada.delete(`/worlds/${worldId}/mounts/${containerId}`).expect(200);
  }

  async function summaries(agent: Agent, query: string): Promise<EntitySummary[]> {
    return (await agent.get(`/entities?${query}`).expect(200)).body.items;
  }

  /** A navigation read's answer, by name — sorted, since a navigation read's order is not this file's subject. */
  async function names(agent: Agent, query: string): Promise<string[]> {
    return (await summaries(agent, query)).map((e) => e.name).sort();
  }

  /** What a picker would show, in the order it would show it — the whole point of a link-target read. */
  async function offered(agent: Agent, query: string): Promise<string[]> {
    return (await summaries(agent, `${query}&read=link-target`)).map((e) => e.name);
  }

  /** The same, by id — for the two Entities that answer to one name. */
  async function offeredIds(agent: Agent, query: string): Promise<string[]> {
    return (await summaries(agent, `${query}&read=link-target`)).map((e) => e.id);
  }

  async function facets(agent: Agent, query: string): Promise<EntityFacets> {
    return (await agent.get(`/entities/facets?${query}`).expect(200)).body;
  }

  /** The Container facet on a link-target read — the rail a widened picker offers to narrow by. */
  async function containerFacet(agent: Agent, query: string): Promise<FacetCount[] | undefined> {
    return (await facets(agent, `${query}&read=link-target`)).container;
  }
});
